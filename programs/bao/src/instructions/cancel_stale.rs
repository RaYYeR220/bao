use anchor_lang::prelude::*;

use crate::{constants::*, error::BaoError, events::StaleCancelled, state::*};

/// Frees a share whose randomness never arrived. No proof, no payout: the grab is
/// dropped, its rent returns to the GasTank, and the device may grab again.
#[derive(Accounts)]
pub struct CancelStale<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [PACKET_SEED, packet.sender.as_ref(), &packet.id.to_le_bytes()],
        bump = packet.bump
    )]
    pub packet: Box<Account<'info, Packet>>,
    #[account(
        mut,
        close = gas_tank,
        has_one = packet @ BaoError::WrongPacket,
        seeds = [CLAIM_SEED, packet.key().as_ref(), claim.device_key.as_ref()],
        bump = claim.bump
    )]
    pub claim: Box<Account<'info, ClaimRecord>>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
}

pub fn handle_cancel_stale(ctx: Context<CancelStale>) -> Result<()> {
    let claim = &ctx.accounts.claim;
    require!(claim.status == ClaimStatus::Pending, BaoError::NotPending);
    require!(Clock::get()?.slot > claim.requested_slot + STALE_SLOTS, BaoError::NotStale);
    let packet = &mut ctx.accounts.packet;
    packet.reserved -= 1;
    packet.open_claims -= 1;
    emit!(StaleCancelled { packet: packet.key(), device_key: claim.device_key, index: claim.index });
    Ok(())
}
