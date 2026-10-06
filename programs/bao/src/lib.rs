pub mod constants;
pub mod error;
pub mod events;
pub mod gas;
pub mod instructions;
pub mod audience;
pub mod math;
pub mod mint_safety;
pub mod sgt;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("DifXuyhEu3r7sgXQjgCokyikQFcYCYD2cwhjNyU7j6XR");

#[program]
pub mod bao {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: InitConfigArgs) -> Result<()> {
        instructions::config::handle_init_config(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::config::handle_update_config(ctx, args)
    }

    pub fn create_packet(ctx: Context<CreatePacket>, args: CreatePacketArgs) -> Result<()> {
        instructions::create_packet::handle_create_packet(ctx, args)
    }

    pub fn grab_equal(ctx: Context<GrabEqual>, args: GrabArgs) -> Result<()> {
        instructions::grab::handle_grab_equal(ctx, args)
    }

    pub fn grab_lucky(ctx: Context<GrabLucky>, args: GrabArgs) -> Result<()> {
        instructions::grab::handle_grab_lucky(ctx, args)
    }

    pub fn vrf_callback(ctx: Context<VrfCallback>, randomness: [u8; 32], requested_slot: u64) -> Result<()> {
        instructions::vrf_callback::handle_vrf_callback(ctx, randomness, requested_slot)
    }

    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        instructions::payout::handle_payout(ctx)
    }

    pub fn cancel_stale(ctx: Context<CancelStale>) -> Result<()> {
        instructions::cancel_stale::handle_cancel_stale(ctx)
    }

    pub fn close_claims<'info>(ctx: Context<'info, CloseClaims<'info>>) -> Result<()> {
        instructions::close::handle_close_claims(ctx)
    }

    pub fn close_packet(ctx: Context<ClosePacket>) -> Result<()> {
        instructions::close::handle_close_packet(ctx)
    }

    pub fn close_crown(ctx: Context<CloseCrown>) -> Result<()> {
        instructions::close::handle_close_crown(ctx)
    }
}
