use anchor_lang::prelude::*;

use crate::{constants::*, error::BaoError, program::Bao, state::Config};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitConfigArgs {
    pub sgt_group: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub crank_reward_lamports: u64,
}

/// Only the program's upgrade authority can create the config, so nobody can
/// front-run initialization after deploy.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Bao>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()))]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
    require!(args.fee_bps <= MAX_FEE_BPS, BaoError::FeeTooHigh);
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.sgt_group = args.sgt_group;
    config.treasury = args.treasury;
    config.fee_bps = args.fee_bps;
    config.crank_reward_lamports = args.crank_reward_lamports;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigArgs {
    pub new_admin: Option<Pubkey>,
    pub sgt_group: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub crank_reward_lamports: Option<u64>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

pub fn handle_update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(fee_bps) = args.fee_bps {
        require!(fee_bps <= MAX_FEE_BPS, BaoError::FeeTooHigh);
        config.fee_bps = fee_bps;
    }
    if let Some(admin) = args.new_admin {
        config.admin = admin;
    }
    if let Some(group) = args.sgt_group {
        config.sgt_group = group;
    }
    if let Some(treasury) = args.treasury {
        config.treasury = treasury;
    }
    if let Some(reward) = args.crank_reward_lamports {
        config.crank_reward_lamports = reward;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    Ok(())
}
