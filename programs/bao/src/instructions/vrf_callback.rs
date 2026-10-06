use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::vrf_callback;

use crate::{constants::*, error::BaoError, events::*, gas, math, state::*};

/// Delivered by the MagicBlock VRF program once the randomness for a Lucky grab is proven.
/// It only assigns the share: nothing here depends on accounts the claimer controls, so a
/// claimer cannot make it fail. Tokens move later in `payout`.
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
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
    /// CHECK: crown PDA, created when the packet is fully resolved.
    #[account(mut, seeds = [CROWN_SEED, packet.key().as_ref()], bump)]
    pub crown: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_vrf_callback(ctx: Context<VrfCallback>, randomness: [u8; 32], requested_slot: u64) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    require!(claim.status == ClaimStatus::Pending, BaoError::NotPending);
    // after a cancel and re-grab, a late answer to the old request must not settle the new one
    require!(claim.requested_slot == requested_slot, BaoError::WrongRequest);

    let packet_key = ctx.accounts.packet.key();
    let packet = &mut ctx.accounts.packet;
    // Order-independent: every callback draws from what is left, so the sum stays exact.
    let amount = math::lucky_share(packet.remaining_amount, packet.total_shares - packet.resolved, &randomness);
    packet.remaining_amount -= amount;
    packet.resolved += 1;
    claim.amount = amount;
    claim.status = ClaimStatus::Won;
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
        let gas_bump = [packet.gas_bump];
        let gas_seeds: &[&[u8]] = &[GAS_SEED, packet_key.as_ref(), &gas_bump];
        crown_packet(
            packet,
            &packet_key,
            &ctx.accounts.crown.to_account_info(),
            ctx.bumps.crown,
            &ctx.accounts.gas_tank.to_account_info(),
            gas_seeds,
            &ctx.accounts.system_program.to_account_info(),
        )?;
    }
    Ok(())
}

/// Creates the Crown for the packet's Luck King, paid by the GasTank. A crown still alive at
/// this address (left by an earlier packet with the same sender and id) is kept as is.
pub(crate) fn crown_packet<'info>(
    packet: &mut Packet,
    packet_key: &Pubkey,
    crown: &AccountInfo<'info>,
    crown_bump: u8,
    gas_tank: &AccountInfo<'info>,
    gas_seeds: &[&[u8]],
    system: &AccountInfo<'info>,
) -> Result<()> {
    packet.crowned = true;
    let Some(king) = packet.luck_king else {
        return Ok(());
    };
    if *crown.owner == crate::ID {
        return Ok(());
    }
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
    emit!(LuckKingCrowned {
        packet: *packet_key,
        king,
        amount: record.amount,
        chain_root: record.chain_root,
        chain_depth: record.chain_depth,
    });
    Ok(())
}
