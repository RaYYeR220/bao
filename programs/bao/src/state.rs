use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub sgt_group: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub crank_reward_lamports: u64,
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum SplitMode {
    Lucky,
    Equal,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Audience {
    Open,
    Circle { merkle_root: [u8; 32] },
    Code { code_hash: [u8; 32] },
}

#[account]
#[derive(InitSpace)]
pub struct Packet {
    pub sender: Pubkey,
    pub id: u64,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub total_amount: u64,
    pub remaining_amount: u64,
    pub total_shares: u16,
    /// Shares handed out (assigned or awaiting randomness).
    pub reserved: u16,
    /// Shares whose amount is assigned.
    pub resolved: u16,
    /// Claim records not yet closed.
    pub open_claims: u16,
    pub mode: SplitMode,
    pub audience: Audience,
    pub seeker_only: bool,
    /// Genesis group snapshotted from the config at creation; later config changes do not apply.
    pub sgt_group: Pubkey,
    /// Crank reward snapshotted from the config at creation; it is pre-funded in the GasTank.
    pub crank_reward: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub message_hash: [u8; 32],
    pub parent: Option<Pubkey>,
    pub chain_root: Pubkey,
    pub chain_depth: u16,
    pub luck_king: Option<Pubkey>,
    pub luck_king_amount: u64,
    pub crowned: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub gas_bump: u8,
}

impl Packet {
    pub fn is_finished(&self) -> bool {
        self.resolved == self.total_shares
    }

    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.expires_at
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ClaimStatus {
    /// Lucky grab waiting for its randomness.
    Pending,
    /// Share assigned by the VRF callback, not paid out yet.
    Won,
    Paid,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub packet: Pubkey,
    pub claimer: Pubkey,
    /// Seeker Genesis Token mint for Seeker-only packets, otherwise the claimer wallet.
    pub device_key: Pubkey,
    pub index: u16,
    pub amount: u64,
    pub status: ClaimStatus,
    pub requested_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Crown {
    pub packet: Pubkey,
    pub king: Pubkey,
    pub amount: u64,
    pub chain_root: Pubkey,
    pub chain_depth: u16,
    pub refund_to: Pubkey,
    pub expires_at: i64,
    pub bump: u8,
}
