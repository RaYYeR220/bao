use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{constants::*, error::BaoError, events::PaidOut, gas, state::*};

/// Pays a won Lucky share to its claimer. Permissionless: the app sends it right after the
/// callback and the crank retries it, so a claimer who breaks their own token account only
/// delays their own payout.
#[derive(Accounts)]
pub struct Payout<'info> {
    pub payer: Signer<'info>,
    #[account(
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
    #[account(address = packet.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_payout(ctx: Context<Payout>) -> Result<()> {
    require!(ctx.accounts.claim.status == ClaimStatus::Won, BaoError::NotWon);
    let packet = &ctx.accounts.packet;
    let packet_key = packet.key();
    let gas_bump = [packet.gas_bump];
    let gas_seeds: &[&[u8]] = &[GAS_SEED, packet_key.as_ref(), &gas_bump];

    gas::create_ata_idempotent(
        &ctx.accounts.gas_tank.to_account_info(),
        gas_seeds,
        &ctx.accounts.claimer_token.to_account_info(),
        &ctx.accounts.claimer.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let amount = ctx.accounts.claim.amount;
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

    let claim = &mut ctx.accounts.claim;
    claim.status = ClaimStatus::Paid;
    emit!(PaidOut { packet: packet_key, claimer: claim.claimer, amount });
    Ok(())
}
