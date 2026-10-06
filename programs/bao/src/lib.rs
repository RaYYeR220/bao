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
}
