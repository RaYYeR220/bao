//! The GasTank is a system-owned PDA per packet. The sender pre-funds it, and it pays
//! every rent and fee a grab needs, so grabbers only pay the network signature fee.

use anchor_lang::{prelude::*, system_program};

use crate::{constants::*, error::BaoError, state::*};

/// Lamports a packet pre-funds into its GasTank. Unspent lamports go back to the sender on close.
pub fn gas_budget(rent: &Rent, shares: u16, mode: SplitMode, crank_reward: u64) -> u64 {
    let claim_rent = rent.minimum_balance(8 + ClaimRecord::INIT_SPACE);
    let ata_rent = rent.minimum_balance(ATA_SPACE_BUDGET);
    let vrf = if mode == SplitMode::Lucky { VRF_FEE_ALLOWANCE } else { 0 };
    let crown = if mode == SplitMode::Lucky { rent.minimum_balance(8 + Crown::INIT_SPACE) } else { 0 };
    // keep the tank itself rent-exempt until the final sweep
    let reserve = rent.minimum_balance(0);
    (claim_rent + ata_rent + vrf) * shares as u64 + crown + crank_reward + reserve
}

/// Creates a program-owned PDA account, paid by the GasTank.
///
/// Anyone can send lamports to a PDA address before it exists, which would make a plain
/// `create_account` fail forever. Like Anchor's `init`, a pre-funded address is topped up to
/// rent-exempt, then allocated and assigned with the PDA's own seeds.
pub fn create_pda_account<'info>(
    gas_tank: &AccountInfo<'info>,
    gas_seeds: &[&[u8]],
    new_account: &AccountInfo<'info>,
    new_seeds: &[&[u8]],
    space: usize,
    owner: &Pubkey,
    system: &AccountInfo<'info>,
) -> Result<()> {
    let rent_exempt = Rent::get()?.minimum_balance(space);
    let current = new_account.lamports();
    if current == 0 {
        return system_program::create_account(
            CpiContext::new_with_signer(
                system.key(),
                system_program::CreateAccount { from: gas_tank.clone(), to: new_account.clone() },
                &[gas_seeds, new_seeds],
            ),
            rent_exempt,
            space as u64,
            owner,
        );
    }
    require_keys_eq!(*new_account.owner, system_program::ID, BaoError::AddressInUse);
    if rent_exempt > current {
        transfer_from_gas(gas_tank, gas_seeds, new_account, rent_exempt - current, system)?;
    }
    system_program::allocate(
        CpiContext::new_with_signer(
            system.key(),
            system_program::Allocate { account_to_allocate: new_account.clone() },
            &[new_seeds],
        ),
        space as u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(
            system.key(),
            system_program::Assign { account_to_assign: new_account.clone() },
            &[new_seeds],
        ),
        owner,
    )
}

pub fn transfer_from_gas<'info>(
    gas_tank: &AccountInfo<'info>,
    gas_seeds: &[&[u8]],
    to: &AccountInfo<'info>,
    lamports: u64,
    system: &AccountInfo<'info>,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new_with_signer(
            system.key(),
            system_program::Transfer { from: gas_tank.clone(), to: to.clone() },
            &[gas_seeds],
        ),
        lamports,
    )
}

/// Creates `wallet`'s associated token account if it does not exist yet, paid by the GasTank.
#[allow(clippy::too_many_arguments)]
pub fn create_ata_idempotent<'info>(
    gas_tank: &AccountInfo<'info>,
    gas_seeds: &[&[u8]],
    ata: &AccountInfo<'info>,
    wallet: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    ata_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> Result<()> {
    anchor_spl::associated_token::create_idempotent(CpiContext::new_with_signer(
        ata_program.key(),
        anchor_spl::associated_token::Create {
            payer: gas_tank.clone(),
            associated_token: ata.clone(),
            authority: wallet.clone(),
            mint: mint.clone(),
            system_program: system.clone(),
            token_program: token_program.clone(),
        },
        &[gas_seeds],
    ))
}
