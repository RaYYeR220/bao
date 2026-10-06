use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use anchor_lang::solana_program::program::invoke_signed;
use ephemeral_rollups_sdk::anchor::vrf;
use ephemeral_rollups_sdk::vrf::{
    consts::IDENTITY,
    instructions::{create_request_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_sha256_hasher::hashv;

use crate::{audience, constants::*, error::BaoError, events::*, gas, math, sgt, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GrabArgs {
    /// Seeker Genesis Token mint for Seeker-only packets, otherwise the claimer wallet.
    pub device_key: Pubkey,
    /// Merkle proof for circle packets.
    pub proof: Vec<[u8; 32]>,
    /// Code word for code packets.
    pub code: Option<Vec<u8>>,
}

/// Checks shared by both grab instructions; reserves the next share and returns its index.
#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_and_reserve(
    packet: &mut Packet,
    packet_key: &Pubkey,
    config: &Config,
    claimer: &Pubkey,
    args: &GrabArgs,
    sgt_mint: Option<&AccountInfo>,
    sgt_token: Option<&AccountInfo>,
    now: i64,
) -> Result<u16> {
    require!(!config.paused, BaoError::Paused);
    require!(!packet.is_expired(now), BaoError::Expired);
    require!(packet.reserved < packet.total_shares, BaoError::SoldOut);
    match packet.audience {
        Audience::Open => {}
        Audience::Circle { merkle_root } => require!(
            audience::verify_merkle(&args.proof, &merkle_root, audience::merkle_leaf(claimer)),
            BaoError::NotInCircle
        ),
        Audience::Code { code_hash } => {
            let code = args.code.as_ref().ok_or(error!(BaoError::WrongCode))?;
            require!(audience::code_hash(code, packet_key) == code_hash, BaoError::WrongCode);
        }
    }
    if packet.seeker_only {
        let mint = sgt_mint.ok_or(error!(BaoError::NotASeeker))?;
        let token = sgt_token.ok_or(error!(BaoError::NotASeeker))?;
        sgt::verify_sgt(claimer, &packet.sgt_group, mint, token)?;
        require_keys_eq!(args.device_key, mint.key(), BaoError::BadDeviceKey);
    } else {
        require_keys_eq!(args.device_key, *claimer, BaoError::BadDeviceKey);
    }
    let index = packet.reserved;
    packet.reserved += 1;
    packet.open_claims += 1;
    Ok(index)
}

/// Creates the claim record PDA, paid by the GasTank. The address is keyed by the device,
/// so a second grab from the same device finds a record owned by this program and is refused.
/// Lamports sent to the address by someone else do not count as a grab.
pub(crate) fn write_claim_record<'info>(
    claim: &AccountInfo<'info>,
    claim_bump: u8,
    gas_tank: &AccountInfo<'info>,
    gas_seeds: &[&[u8]],
    system: &AccountInfo<'info>,
    record: &ClaimRecord,
) -> Result<()> {
    require!(*claim.owner != crate::ID, BaoError::AlreadyGrabbedOnThisDevice);
    let claim_seeds: &[&[u8]] = &[CLAIM_SEED, record.packet.as_ref(), record.device_key.as_ref(), &[claim_bump]];
    gas::create_pda_account(gas_tank, gas_seeds, claim, claim_seeds, 8 + ClaimRecord::INIT_SPACE, &crate::ID, system)?;
    let mut data = claim.try_borrow_mut_data()?;
    record.try_serialize(&mut &mut data[..])?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: GrabArgs)]
pub struct GrabEqual<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [PACKET_SEED, packet.sender.as_ref(), &packet.id.to_le_bytes()],
        bump = packet.bump,
        constraint = packet.mode == SplitMode::Equal @ BaoError::WrongMode
    )]
    pub packet: Box<Account<'info, Packet>>,
    #[account(address = packet.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, packet.key().as_ref()], bump = packet.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
    /// CHECK: created in this instruction; address pinned by seeds.
    #[account(mut, seeds = [CLAIM_SEED, packet.key().as_ref(), args.device_key.as_ref()], bump)]
    pub claim: UncheckedAccount<'info>,
    /// CHECK: claimer ATA; created idempotently by the associated token program, which checks the address.
    #[account(mut)]
    pub claimer_token: UncheckedAccount<'info>,
    /// CHECK: verified by `sgt::verify_sgt`.
    pub sgt_mint: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by `sgt::verify_sgt`.
    pub sgt_token: Option<UncheckedAccount<'info>>,
    #[account(address = packet.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_grab_equal(ctx: Context<GrabEqual>, args: GrabArgs) -> Result<()> {
    let clock = Clock::get()?;
    let packet_key = ctx.accounts.packet.key();
    let claimer = ctx.accounts.claimer.key();
    let sgt_mint = ctx.accounts.sgt_mint.as_ref().map(|a| a.to_account_info());
    let sgt_token = ctx.accounts.sgt_token.as_ref().map(|a| a.to_account_info());
    let index = validate_and_reserve(
        &mut ctx.accounts.packet,
        &packet_key,
        &ctx.accounts.config,
        &claimer,
        &args,
        sgt_mint.as_ref(),
        sgt_token.as_ref(),
        clock.unix_timestamp,
    )?;

    let packet = &mut ctx.accounts.packet;
    let amount = math::equal_share(packet.remaining_amount, packet.total_shares - packet.resolved);
    let gas_bump = [packet.gas_bump];
    let gas_seeds: &[&[u8]] = &[GAS_SEED, packet_key.as_ref(), &gas_bump];
    let gas_tank = ctx.accounts.gas_tank.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();

    write_claim_record(
        &ctx.accounts.claim.to_account_info(),
        ctx.bumps.claim,
        &gas_tank,
        gas_seeds,
        &system,
        &ClaimRecord {
            packet: packet_key,
            claimer,
            device_key: args.device_key,
            index,
            amount,
            status: ClaimStatus::Paid,
            requested_slot: clock.slot,
            bump: ctx.bumps.claim,
        },
    )?;

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
    emit!(Grabbed {
        packet: packet_key,
        claimer,
        device_key: args.device_key,
        index,
        amount,
        remaining: packet.remaining_amount,
        randomness: [0u8; 32],
    });
    Ok(())
}

#[vrf]
#[derive(Accounts)]
#[instruction(args: GrabArgs)]
pub struct GrabLucky<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [PACKET_SEED, packet.sender.as_ref(), &packet.id.to_le_bytes()],
        bump = packet.bump,
        constraint = packet.mode == SplitMode::Lucky @ BaoError::WrongMode
    )]
    pub packet: Box<Account<'info, Packet>>,
    #[account(address = packet.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, packet.key().as_ref()], bump = packet.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump = packet.gas_bump)]
    pub gas_tank: SystemAccount<'info>,
    /// CHECK: created in this instruction; address pinned by seeds.
    #[account(mut, seeds = [CLAIM_SEED, packet.key().as_ref(), args.device_key.as_ref()], bump)]
    pub claim: UncheckedAccount<'info>,
    /// CHECK: claimer ATA, passed through to the VRF callback.
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &claimer.key(), &packet.mint, &packet.token_program
        )
    )]
    pub claimer_token: UncheckedAccount<'info>,
    /// CHECK: crown PDA, passed through to the VRF callback.
    #[account(mut, seeds = [CROWN_SEED, packet.key().as_ref()], bump)]
    pub crown: UncheckedAccount<'info>,
    /// CHECK: verified by `sgt::verify_sgt`.
    pub sgt_mint: Option<UncheckedAccount<'info>>,
    /// CHECK: verified by `sgt::verify_sgt`.
    pub sgt_token: Option<UncheckedAccount<'info>>,
    #[account(address = packet.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: MagicBlock base-layer oracle queue.
    #[account(mut, address = VRF_ORACLE_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

pub fn handle_grab_lucky(ctx: Context<GrabLucky>, args: GrabArgs) -> Result<()> {
    let clock = Clock::get()?;
    let packet_key = ctx.accounts.packet.key();
    let claimer = ctx.accounts.claimer.key();
    let sgt_mint = ctx.accounts.sgt_mint.as_ref().map(|a| a.to_account_info());
    let sgt_token = ctx.accounts.sgt_token.as_ref().map(|a| a.to_account_info());
    let index = validate_and_reserve(
        &mut ctx.accounts.packet,
        &packet_key,
        &ctx.accounts.config,
        &claimer,
        &args,
        sgt_mint.as_ref(),
        sgt_token.as_ref(),
        clock.unix_timestamp,
    )?;

    let gas_bump = [ctx.accounts.packet.gas_bump];
    let gas_seeds: &[&[u8]] = &[GAS_SEED, packet_key.as_ref(), &gas_bump];
    let a = &ctx.accounts;
    write_claim_record(
        &a.claim.to_account_info(),
        ctx.bumps.claim,
        &a.gas_tank.to_account_info(),
        gas_seeds,
        &a.system_program.to_account_info(),
        &ClaimRecord {
            packet: packet_key,
            claimer,
            device_key: args.device_key,
            index,
            amount: 0,
            status: ClaimStatus::Pending,
            requested_slot: clock.slot,
            bump: ctx.bumps.claim,
        },
    )?;

    // The seed is program-derived, so grabbers cannot grind it.
    let caller_seed = hashv(&[
        packet_key.as_ref(),
        &index.to_le_bytes(),
        args.device_key.as_ref(),
        &clock.slot.to_le_bytes(),
    ])
    .to_bytes();
    let meta = |pubkey: Pubkey, is_writable: bool| SerializableAccountMeta { pubkey, is_signer: false, is_writable };
    // Order must match `VrfCallback` (after the injected VRF identity). The callback only
    // assigns the share, so nothing the claimer controls is passed to it.
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: a.gas_tank.key(),
        oracle_queue: a.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: VRF_CALLBACK_DISCRIMINATOR.to_vec(),
        caller_seed,
        accounts_metas: Some(vec![
            meta(packet_key, true),
            meta(a.claim.key(), true),
            meta(a.gas_tank.key(), true),
            meta(a.crown.key(), true),
            meta(a.system_program.key(), false),
        ]),
        // echoed back so the callback can tell this request from an older one
        callback_args: Some(clock.slot.to_le_bytes().to_vec()),
    });
    let identity_bump = [ctx.bumps.program_identity];
    // The GasTank pays the request fee, so the grabber only pays the network fee.
    invoke_signed(
        &ix,
        &[
            a.gas_tank.to_account_info(),
            a.program_identity.to_account_info(),
            a.oracle_queue.to_account_info(),
            a.system_program.to_account_info(),
            a.slot_hashes.to_account_info(),
        ],
        &[&[IDENTITY, &identity_bump], gas_seeds],
    )?;

    emit!(GrabReserved { packet: packet_key, claimer, device_key: args.device_key, index });
    Ok(())
}
