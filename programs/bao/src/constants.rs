use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const PACKET_SEED: &[u8] = b"packet";
pub const VAULT_SEED: &[u8] = b"vault";
pub const GAS_SEED: &[u8] = b"gas";
pub const CLAIM_SEED: &[u8] = b"claim";
pub const CROWN_SEED: &[u8] = b"crown";

pub const MAX_SHARES: u16 = 200;
pub const MIN_EXPIRY_SECS: i64 = 3_600;
pub const MAX_EXPIRY_SECS: i64 = 7 * 86_400;
pub const MAX_FEE_BPS: u16 = 500;
/// Slots after which an unanswered VRF request can be cancelled.
pub const STALE_SLOTS: u64 = 300;
pub const CROWN_TTL_SECS: i64 = 7 * 86_400;

/// Upper bound for a recipient token account (Token-2022 ATA with ImmutableOwner).
pub const ATA_SPACE_BUDGET: usize = 200;
/// Lamports reserved per Lucky grab for the VRF request fee.
pub const VRF_FEE_ALLOWANCE: u64 = 1_000_000;

/// MagicBlock base-layer oracle queue (mainnet and devnet).
pub const VRF_ORACLE_QUEUE: Pubkey = pubkey!("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
