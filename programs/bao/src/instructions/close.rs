use anchor_lang::{prelude::*, AccountsClose};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    constants::*,
    error::BaoError,
    events::{ClaimForfeited, PacketClosed},
    gas,
    instructions::vrf_callback::crown_packet,
    state::*,
};

/// A packet can wind down once it is expired or fully paid, and no grab awaits randomness.
fn require_closable(packet: &Packet, now: i64) -> Result<()> {
    require!(packet.is_expired(now) || packet.is_finished(), BaoError::StillActive);
    require!(packet.reserved == packet.resolved, BaoError::PendingGrabs);
    Ok(())
}

#[derive(Accounts)]
pub struct CloseClaims<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [PACKET_SEED, packet.sender.as_ref(), &packet.id.to_le_bytes()],
        bump = packet.bump
    )]
    pub packet: Box<Account<'info, Packet>>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
}

/// Closes claim records passed as remaining accounts; their rent goes back to the GasTank.
/// A won share that was never paid out is forfeited to the sender, but only once the packet
/// has expired, so a crank cannot sweep a share from its winner.
pub fn handle_close_claims<'info>(ctx: Context<'info, CloseClaims<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_closable(&ctx.accounts.packet, now)?;
    let packet_key = ctx.accounts.packet.key();
    for info in ctx.remaining_accounts.iter() {
        require_keys_eq!(*info.owner, crate::ID, BaoError::WrongPacket);
        let record = Account::<ClaimRecord>::try_from(info)?;
        require_keys_eq!(record.packet, packet_key, BaoError::WrongPacket);
        if record.status == ClaimStatus::Won {
            require!(ctx.accounts.packet.is_expired(now), BaoError::WinNotPaid);
            emit!(ClaimForfeited { packet: packet_key, claimer: record.claimer, amount: record.amount });
        }
        record.close(ctx.accounts.gas_tank.to_account_info())?;
        ctx.accounts.packet.open_claims -= 1;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePacket<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        close = sender,
        seeds = [PACKET_SEED, packet.sender.as_ref(), &packet.id.to_le_bytes()],
        bump = packet.bump
    )]
    pub packet: Box<Account<'info, Packet>>,
    /// CHECK: refund destination, pinned to the packet sender.
    #[account(mut, address = packet.sender)]
    pub sender: UncheckedAccount<'info>,
    #[account(address = packet.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, packet.key().as_ref()], bump = packet.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: sender ATA, created idempotently when tokens are left to return.
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &packet.sender, &packet.mint, &packet.token_program
        )
    )]
    pub sender_token: UncheckedAccount<'info>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
    /// CHECK: crown PDA; created here when a Lucky packet expires with a king but no crown yet.
    #[account(mut, seeds = [CROWN_SEED, packet.key().as_ref()], bump)]
    pub crown: UncheckedAccount<'info>,
    #[account(address = packet.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close_packet(ctx: Context<ClosePacket>) -> Result<()> {
    require_closable(&ctx.accounts.packet, Clock::get()?.unix_timestamp)?;
    require!(ctx.accounts.packet.open_claims == 0, BaoError::OpenClaims);

    let packet_key = ctx.accounts.packet.key();
    let gas_bump = [ctx.accounts.packet.gas_bump];
    let gas_seeds: &[&[u8]] = &[GAS_SEED, packet_key.as_ref(), &gas_bump];
    let gas_tank = ctx.accounts.gas_tank.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();

    if ctx.accounts.packet.mode == SplitMode::Lucky && !ctx.accounts.packet.crowned {
        crown_packet(&mut ctx.accounts.packet, &packet_key, &ctx.accounts.crown.to_account_info(), ctx.bumps.crown, &gas_tank, gas_seeds, &system)?;
    }

    let packet = &ctx.accounts.packet;
    let refunded = ctx.accounts.vault.amount;
    let id = packet.id.to_le_bytes();
    let bump = [packet.bump];
    let packet_seeds: &[&[u8]] = &[PACKET_SEED, packet.sender.as_ref(), &id, &bump];
    let token_program = ctx.accounts.token_program.key();
    if refunded > 0 {
        gas::create_ata_idempotent(
            &gas_tank,
            gas_seeds,
            &ctx.accounts.sender_token.to_account_info(),
            &ctx.accounts.sender.to_account_info(),
            &ctx.accounts.mint.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.associated_token_program.to_account_info(),
            &system,
        )?;
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                token_program,
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.sender_token.to_account_info(),
                    authority: packet.to_account_info(),
                },
                &[packet_seeds],
            ),
            refunded,
            ctx.accounts.mint.decimals,
        )?;
    }
    token_interface::close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.sender.to_account_info(),
            authority: packet.to_account_info(),
        },
        &[packet_seeds],
    ))?;

    // pay the crank, then sweep whatever the grabs did not use back to the sender
    let reward = packet.crank_reward.min(gas_tank.lamports());
    gas::transfer_from_gas(&gas_tank, gas_seeds, &ctx.accounts.caller.to_account_info(), reward, &system)?;
    let rest = gas_tank.lamports();
    gas::transfer_from_gas(&gas_tank, gas_seeds, &ctx.accounts.sender.to_account_info(), rest, &system)?;

    emit!(PacketClosed { packet: packet_key, refunded, luck_king: packet.luck_king });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseCrown<'info> {
    pub caller: Signer<'info>,
    #[account(mut, close = refund_to, seeds = [CROWN_SEED, crown.packet.as_ref()], bump = crown.bump)]
    pub crown: Box<Account<'info, Crown>>,
    /// CHECK: pinned to the crown refund address.
    #[account(mut, address = crown.refund_to)]
    pub refund_to: UncheckedAccount<'info>,
}

/// An unused crown lapses after its TTL so its rent is not stranded.
pub fn handle_close_crown(ctx: Context<CloseCrown>) -> Result<()> {
    require!(Clock::get()?.unix_timestamp >= ctx.accounts.crown.expires_at, BaoError::CrownActive);
    Ok(())
}
