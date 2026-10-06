use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use ephemeral_rollups_sdk::anchor::vrf_callback;

use crate::{constants::*, error::BaoError, events::*, gas, math, state::*};

/// Delivered by the MagicBlock VRF program once the randomness for a Lucky grab is proven.
/// Account order matches the metas `grab_lucky` registered with the request.
#[vrf_callback]
#[derive(Accounts)]
pub struct VrfCallback<'info> {
    #[account(
        mut,
        seeds = [PACKET_SEED, packet.sender.as_ref(), &packet.id.to_le_bytes()],
        bump = packet.bump
    )]
    pub packet: Box<Account<'info, Packet>>,
    #[account(
        mut,
        has_one = packet @ BaoError::WrongPacket,
        seeds = [CLAIM_SEED, packet.key().as_ref(), claim.device_key.as_ref()],
        bump = claim.bump
    )]
    pub claim: Box<Account<'info, ClaimRecord>>,
    #[account(mut, seeds = [VAULT_SEED, packet.key().as_ref()], bump = packet.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = packet.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
    /// CHECK: must be the claimer recorded on the claim.
    #[account(address = claim.claimer @ BaoError::WrongPacket)]
    pub claimer: UncheckedAccount<'info>,
    /// CHECK: claimer ATA, created idempotently for (claimer, mint).
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &claim.claimer, &packet.mint, &packet.token_program
        )
    )]
    pub claimer_token: UncheckedAccount<'info>,
    /// CHECK: crown PDA, created when the packet is fully resolved.
    #[account(mut, seeds = [CROWN_SEED, packet.key().as_ref()], bump)]
    pub crown: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(address = packet.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_vrf_callback(ctx: Context<VrfCallback>, randomness: [u8; 32]) -> Result<()> {
    require!(ctx.accounts.claim.status == ClaimStatus::Pending, BaoError::NotPending);
    let packet_key = ctx.accounts.packet.key();
    let gas_bump = [ctx.accounts.packet.gas_bump];
    let gas_seeds: &[&[u8]] = &[GAS_SEED, packet_key.as_ref(), &gas_bump];
    let gas_tank = ctx.accounts.gas_tank.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();

    let packet = &mut ctx.accounts.packet;
    // Order-independent: every callback draws from what is left, so the sum stays exact.
    let amount = math::lucky_share(packet.remaining_amount, packet.total_shares - packet.resolved, &randomness);

    gas::create_ata_idempotent(
        &gas_tank,
        gas_seeds,
        &ctx.accounts.claimer_token.to_account_info(),
        &ctx.accounts.claimer.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &system,
    )?;

    let id = packet.id.to_le_bytes();
    let bump = [packet.bump];
    let packet_seeds: &[&[u8]] = &[PACKET_SEED, packet.sender.as_ref(), &id, &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.claimer_token.to_account_info(),
                authority: packet.to_account_info(),
            },
            &[packet_seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    packet.remaining_amount -= amount;
    packet.resolved += 1;
    let claim = &mut ctx.accounts.claim;
    claim.amount = amount;
    claim.status = ClaimStatus::Paid;
    // ties keep the earlier grab as king
    if packet.luck_king.is_none() || amount > packet.luck_king_amount {
        packet.luck_king = Some(claim.claimer);
        packet.luck_king_amount = amount;
    }
    emit!(Grabbed {
        packet: packet_key,
        claimer: claim.claimer,
        device_key: claim.device_key,
        index: claim.index,
        amount,
        remaining: packet.remaining_amount,
        randomness,
    });

    if packet.is_finished() && !packet.crowned {
        crown_packet(packet, &packet_key, &ctx.accounts.crown.to_account_info(), ctx.bumps.crown, &gas_tank, gas_seeds, &system)?;
    }
    Ok(())
}

/// Creates the Crown for the packet's Luck King, paid by the GasTank.
pub(crate) fn crown_packet<'info>(
    packet: &mut Packet,
    packet_key: &Pubkey,
    crown: &AccountInfo<'info>,
    crown_bump: u8,
    gas_tank: &AccountInfo<'info>,
    gas_seeds: &[&[u8]],
    system: &AccountInfo<'info>,
) -> Result<()> {
    let Some(king) = packet.luck_king else {
        return Ok(());
    };
    let crown_seeds: &[&[u8]] = &[CROWN_SEED, packet_key.as_ref(), &[crown_bump]];
    gas::create_pda_account(gas_tank, gas_seeds, crown, crown_seeds, 8 + Crown::INIT_SPACE, &crate::ID, system)?;
    let record = Crown {
        packet: *packet_key,
        king,
        amount: packet.luck_king_amount,
        chain_root: packet.chain_root,
        chain_depth: packet.chain_depth,
        refund_to: packet.sender,
        expires_at: Clock::get()?.unix_timestamp + CROWN_TTL_SECS,
        bump: crown_bump,
    };
    let mut data = crown.try_borrow_mut_data()?;
    record.try_serialize(&mut &mut data[..])?;
    packet.crowned = true;
    emit!(LuckKingCrowned {
        packet: *packet_key,
        king,
        amount: record.amount,
        chain_root: record.chain_root,
        chain_depth: record.chain_depth,
    });
    Ok(())
}
