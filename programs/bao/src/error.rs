use anchor_lang::prelude::*;

#[error_code]
pub enum BaoError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Shares must be between 1 and 200")]
    BadShares,
    #[msg("Total must be at least one unit per share")]
    TotalTooSmall,
    #[msg("Expiry must be between 1 hour and 7 days")]
    BadExpiry,
    #[msg("Fee above the maximum")]
    FeeTooHigh,
    #[msg("Open packets must be Seeker-only")]
    OpenMustBeSeekerOnly,
    #[msg("Mint has an unsupported Token-2022 extension")]
    UnsafeMint,
    #[msg("Treasury token account missing or wrong")]
    BadTreasury,
    #[msg("Only the Luck King of the parent packet can continue the chain")]
    NotLuckKing,
    #[msg("Packet expired")]
    Expired,
    #[msg("No shares left")]
    SoldOut,
    #[msg("Not in this circle")]
    NotInCircle,
    #[msg("Wrong code word")]
    WrongCode,
    #[msg("Not a Seeker: no Seeker Genesis Token")]
    NotASeeker,
    #[msg("Seeker Genesis Token is not owned by the grabber")]
    SgtNotOwned,
    #[msg("Token is not a member of the Seeker Genesis group")]
    WrongSgtGroup,
    #[msg("This device already grabbed this packet")]
    AlreadyGrabbedOnThisDevice,
    #[msg("Device key does not match the grab")]
    BadDeviceKey,
    #[msg("Wrong split mode for this instruction")]
    WrongMode,
    #[msg("Claim is not pending")]
    NotPending,
    #[msg("Claim is not stale yet")]
    NotStale,
    #[msg("Packet still active")]
    StillActive,
    #[msg("Pending grabs must resolve or be cancelled first")]
    PendingGrabs,
    #[msg("Claim records must be closed first")]
    OpenClaims,
    #[msg("Account does not belong to this packet")]
    WrongPacket,
    #[msg("Crown not expired")]
    CrownActive,
    #[msg("Math overflow")]
    Overflow,
    #[msg("Protocol fee is above the limit the sender accepted")]
    FeeAboveLimit,
    #[msg("Claim has no unpaid win")]
    NotWon,
    #[msg("Won share is not paid yet and the packet has not expired")]
    WinNotPaid,
    #[msg("Randomness answers a different request")]
    WrongRequest,
    #[msg("Address is held by another program")]
    AddressInUse,
    #[msg("Packet has not started yet")]
    NotStarted,
    #[msg("Start must be within the next 7 days")]
    BadStart,
}
