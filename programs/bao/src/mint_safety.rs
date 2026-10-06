use anchor_lang::prelude::*;
use spl_token_2022_interface::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint,
};

use crate::error::BaoError;

/// Token-2022 extensions that could skim, block or claw back packet funds.
const DENIED: [ExtensionType; 7] = [
    ExtensionType::TransferFeeConfig,
    ExtensionType::TransferHook,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::NonTransferable,
    ExtensionType::PermanentDelegate,
    ExtensionType::DefaultAccountState,
    ExtensionType::Pausable,
];

pub fn assert_safe_mint(mint: &AccountInfo) -> Result<()> {
    if *mint.owner == anchor_spl::token::ID {
        return Ok(());
    }
    require_keys_eq!(*mint.owner, anchor_spl::token_2022::ID, BaoError::UnsafeMint);
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<Mint>::unpack(&data).map_err(|_| error!(BaoError::UnsafeMint))?;
    let types = state.get_extension_types().map_err(|_| error!(BaoError::UnsafeMint))?;
    require!(!types.iter().any(|t| DENIED.contains(t)), BaoError::UnsafeMint);
    Ok(())
}
