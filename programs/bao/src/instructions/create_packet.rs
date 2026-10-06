use anchor_lang::{prelude::*, system_program, AccountsClose};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::BaoError, events::PacketCreated, gas, mint_safety, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePacketArgs {
    pub id: u64,
    pub total: u64,
    pub shares: u16,
    pub mode: SplitMode,
    pub audience: Audience,
    pub seeker_only: bool,
    pub expires_in: i64,
    pub message_hash: [u8; 32],
    /// Highest protocol fee the sender accepts; protects against a fee change racing the transaction.
    pub max_fee_bps: u16,
}

#[derive(Accounts)]
#[instruction(args: CreatePacketArgs)]
pub struct CreatePacket<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = sender,
        space = 8 + Packet::INIT_SPACE,
        seeds = [PACKET_SEED, sender.key().as_ref(), &args.id.to_le_bytes()],
        bump
    )]
    pub packet: Box<Account<'info, Packet>>,
    #[account(
        mint::token_program = token_program,
        constraint = mint_safety::is_safe_mint(&mint.to_account_info()) @ BaoError::UnsafeMint
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = sender, token::token_program = token_program)]
    pub sender_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = sender,
        seeds = [VAULT_SEED, packet.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = packet,
        token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [GAS_SEED, packet.key().as_ref()], bump)]
    pub gas_tank: SystemAccount<'info>,
    /// Fee destination, owned by `config.treasury`; required when an Open packet pays a fee.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub treasury_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// Crown of the parent packet when the sender continues a Luck-King chain.
    #[account(mut)]
    pub parent_crown: Option<Box<Account<'info, Crown>>>,
    /// CHECK: rent destination of the consumed crown; checked against `crown.refund_to`.
    #[account(mut)]
    pub parent_crown_refund: Option<UncheckedAccount<'info>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

fn pay_from_sender<'info>(accounts: &CreatePacket<'info>, to: AccountInfo<'info>, amount: u64) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            accounts.token_program.key(),
            TransferChecked {
                from: accounts.sender_token.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to,
                authority: accounts.sender.to_account_info(),
            },
        ),
        amount,
        accounts.mint.decimals,
    )
}

pub fn handle_create_packet(ctx: Context<CreatePacket>, args: CreatePacketArgs) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, BaoError::Paused);
    require!(args.shares >= 1 && args.shares <= MAX_SHARES, BaoError::BadShares);
    require!(args.total >= args.shares as u64, BaoError::TotalTooSmall);
    require!(
        args.expires_in >= MIN_EXPIRY_SECS && args.expires_in <= MAX_EXPIRY_SECS,
        BaoError::BadExpiry
    );
    if args.audience == Audience::Open {
        require!(args.seeker_only, BaoError::OpenMustBeSeekerOnly);
    }

    let token_program = ctx.accounts.token_program.key();

    // Open packets reach every verified Seeker and pay the protocol fee on top of the deposit.
    if args.audience == Audience::Open {
        require!(config.fee_bps <= args.max_fee_bps, BaoError::FeeAboveLimit);
    }
    if args.audience == Audience::Open && config.fee_bps > 0 {
        let fee = (args.total as u128 * config.fee_bps as u128 / 10_000) as u64;
        if fee > 0 {
            let treasury = ctx.accounts.treasury_token.as_ref().ok_or(error!(BaoError::BadTreasury))?;
            require_keys_eq!(treasury.owner, config.treasury, BaoError::BadTreasury);
            pay_from_sender(&ctx.accounts, treasury.to_account_info(), fee)?;
        }
    }
    pay_from_sender(&ctx.accounts, ctx.accounts.vault.to_account_info(), args.total)?;

    let budget = gas::gas_budget(&Rent::get()?, args.shares, args.mode, config.crank_reward_lamports);
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.gas_tank.to_account_info(),
            },
        ),
        budget,
    )?;

    let packet_key = ctx.accounts.packet.key();
    let (parent, chain_root, chain_depth) = match ctx.accounts.parent_crown.as_ref() {
        Some(crown) => {
            require_keys_eq!(crown.king, ctx.accounts.sender.key(), BaoError::NotLuckKing);
            let refund = ctx.accounts.parent_crown_refund.as_ref().ok_or(error!(BaoError::WrongPacket))?;
            require_keys_eq!(refund.key(), crown.refund_to, BaoError::WrongPacket);
            let depth = crown.chain_depth.checked_add(1).ok_or(error!(BaoError::Overflow))?;
            let link = (Some(crown.packet), crown.chain_root, depth);
            // each crown continues the chain exactly once
            crown.close(refund.to_account_info())?;
            link
        }
        None => (None, packet_key, 0),
    };

    let now = Clock::get()?.unix_timestamp;
    let packet = &mut ctx.accounts.packet;
    packet.sender = ctx.accounts.sender.key();
    packet.id = args.id;
    packet.mint = ctx.accounts.mint.key();
    packet.token_program = token_program;
    packet.total_amount = args.total;
    packet.remaining_amount = args.total;
    packet.total_shares = args.shares;
    packet.reserved = 0;
    packet.resolved = 0;
    packet.open_claims = 0;
    packet.mode = args.mode;
    packet.audience = args.audience;
    packet.seeker_only = args.seeker_only;
    packet.sgt_group = config.sgt_group;
    packet.crank_reward = config.crank_reward_lamports;
    packet.created_at = now;
    packet.expires_at = now + args.expires_in;
    packet.message_hash = args.message_hash;
    packet.parent = parent;
    packet.chain_root = chain_root;
    packet.chain_depth = chain_depth;
    packet.luck_king = None;
    packet.luck_king_amount = 0;
    packet.crowned = false;
    packet.bump = ctx.bumps.packet;
    packet.vault_bump = ctx.bumps.vault;
    packet.gas_bump = ctx.bumps.gas_tank;

    emit!(PacketCreated {
        packet: packet_key,
        sender: packet.sender,
        mint: packet.mint,
        total: packet.total_amount,
        shares: packet.total_shares,
        mode: packet.mode,
        audience: packet.audience,
        seeker_only: packet.seeker_only,
        expires_at: packet.expires_at,
        chain_root,
        chain_depth,
    });
    Ok(())
}
