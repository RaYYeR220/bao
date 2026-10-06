use anchor_lang::prelude::*;

use crate::state::{Audience, SplitMode};

#[event]
pub struct PacketCreated {
    pub packet: Pubkey,
    pub sender: Pubkey,
    pub mint: Pubkey,
    pub total: u64,
    pub shares: u16,
    pub mode: SplitMode,
    pub audience: Audience,
    pub seeker_only: bool,
    pub expires_at: i64,
    pub chain_root: Pubkey,
    pub chain_depth: u16,
}

#[event]
pub struct GrabReserved {
    pub packet: Pubkey,
    pub claimer: Pubkey,
    pub device_key: Pubkey,
    pub index: u16,
}

#[event]
pub struct Grabbed {
    pub packet: Pubkey,
    pub claimer: Pubkey,
    pub device_key: Pubkey,
    pub index: u16,
    pub amount: u64,
    pub remaining: u64,
    pub randomness: [u8; 32],
}

#[event]
pub struct PaidOut {
    pub packet: Pubkey,
    pub claimer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ClaimForfeited {
    pub packet: Pubkey,
    pub claimer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LuckKingCrowned {
    pub packet: Pubkey,
    pub king: Pubkey,
    pub amount: u64,
    pub chain_root: Pubkey,
    pub chain_depth: u16,
}

#[event]
pub struct StaleCancelled {
    pub packet: Pubkey,
    pub device_key: Pubkey,
    pub index: u16,
}

#[event]
pub struct PacketClosed {
    pub packet: Pubkey,
    pub refunded: u64,
    pub luck_king: Option<Pubkey>,
}
