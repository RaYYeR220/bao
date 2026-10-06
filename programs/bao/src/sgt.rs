use anchor_lang::prelude::*;
use spl_token_2022_interface::{
    extension::{metadata_pointer::MetadataPointer, BaseStateWithExtensions, StateWithExtensions},
    state::{Account as Token2022Account, Mint as Token2022Mint},
};
use spl_token_group_interface::state::TokenGroupMember;

use crate::error::BaoError;

/// On-chain Seeker check. A Seeker Genesis Token is a Token-2022 NFT whose mint is a
/// member of the Seeker Genesis group and whose metadata pointer is the group address.
pub fn verify_sgt(claimer: &Pubkey, sgt_group: &Pubkey, sgt_mint: &AccountInfo, sgt_token: &AccountInfo) -> Result<()> {
    let token_2022 = anchor_spl::token_2022::ID;
    require_keys_eq!(*sgt_token.owner, token_2022, BaoError::NotASeeker);
    require_keys_eq!(*sgt_mint.owner, token_2022, BaoError::NotASeeker);

    let token_data = sgt_token.try_borrow_data()?;
    let token = StateWithExtensions::<Token2022Account>::unpack(&token_data).map_err(|_| error!(BaoError::NotASeeker))?;
    require!(token.base.mint.to_bytes() == sgt_mint.key().to_bytes(), BaoError::NotASeeker);
    require!(token.base.amount == 1, BaoError::NotASeeker);
    require!(token.base.owner.to_bytes() == claimer.to_bytes(), BaoError::SgtNotOwned);

    let mint_data = sgt_mint.try_borrow_data()?;
    let mint = StateWithExtensions::<Token2022Mint>::unpack(&mint_data).map_err(|_| error!(BaoError::NotASeeker))?;
    require!(mint.base.decimals == 0 && mint.base.supply == 1, BaoError::NotASeeker);

    let member = mint.get_extension::<TokenGroupMember>().map_err(|_| error!(BaoError::WrongSgtGroup))?;
    require!(member.group.to_bytes() == sgt_group.to_bytes(), BaoError::WrongSgtGroup);
    require!(member.mint.to_bytes() == sgt_mint.key().to_bytes(), BaoError::WrongSgtGroup);

    let pointer = mint.get_extension::<MetadataPointer>().map_err(|_| error!(BaoError::WrongSgtGroup))?;
    let metadata = Option::<_>::from(pointer.metadata_address).map(|k: spl_pod::solana_pubkey::Pubkey| k.to_bytes());
    require!(metadata == Some(sgt_group.to_bytes()), BaoError::WrongSgtGroup);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use spl_pod::optional_keys::OptionalNonZeroPubkey;
    use spl_token_2022_interface::{
        extension::{
            metadata_pointer::MetadataPointer, BaseStateWithExtensionsMut, ExtensionType,
            StateWithExtensionsMut,
        },
        state::{Account as T22Account, AccountState, Mint as T22Mint},
    };
    use spl_token_group_interface::state::TokenGroupMember;

    const T22: Pubkey = anchor_spl::token_2022::ID;

    struct Fixture {
        mint_key: Pubkey,
        mint_data: Vec<u8>,
        ta_key: Pubkey,
        ta_data: Vec<u8>,
        ta_owner: Pubkey,
    }

    fn fixture(group: Pubkey, metadata: Pubkey, holder: Pubkey, amount: u64, decimals: u8, supply: u64) -> Fixture {
        let mint_key = Pubkey::new_unique();
        let space = ExtensionType::try_calculate_account_len::<T22Mint>(&[
            ExtensionType::MetadataPointer,
            ExtensionType::TokenGroupMember,
        ])
        .unwrap();
        let mut mint_data = vec![0u8; space];
        {
            let mut s = StateWithExtensionsMut::<T22Mint>::unpack_uninitialized(&mut mint_data).unwrap();
            let mp = s.init_extension::<MetadataPointer>(true).unwrap();
            mp.metadata_address = OptionalNonZeroPubkey::try_from(Some(metadata.to_bytes().into())).unwrap();
            let m = s.init_extension::<TokenGroupMember>(true).unwrap();
            m.mint = mint_key.to_bytes().into();
            m.group = group.to_bytes().into();
            m.member_number = 7u64.into();
            s.base.decimals = decimals;
            s.base.supply = supply;
            s.base.is_initialized = true;
            s.pack_base();
            s.init_account_type().unwrap();
        }
        let ta_key = Pubkey::new_unique();
        let tspace = ExtensionType::try_calculate_account_len::<T22Account>(&[]).unwrap();
        let mut ta_data = vec![0u8; tspace];
        {
            let mut s = StateWithExtensionsMut::<T22Account>::unpack_uninitialized(&mut ta_data).unwrap();
            s.base.mint = mint_key.to_bytes().into();
            s.base.owner = holder.to_bytes().into();
            s.base.amount = amount;
            s.base.state = AccountState::Initialized;
            s.pack_base();
            s.init_account_type().unwrap();
        }
        Fixture { mint_key, mint_data, ta_key, ta_data, ta_owner: T22 }
    }

    fn check(f: &mut Fixture, claimer: &Pubkey, group: &Pubkey) -> Result<()> {
        let (mut l1, mut l2) = (1u64, 1u64);
        let mint = AccountInfo::new(&f.mint_key, false, false, &mut l1, &mut f.mint_data, &T22, false);
        let ta = AccountInfo::new(&f.ta_key, false, false, &mut l2, &mut f.ta_data, &f.ta_owner, false);
        verify_sgt(claimer, group, &mint, &ta)
    }

    fn code(r: Result<()>) -> u32 {
        match r.unwrap_err() {
            Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    fn want(e: BaoError) -> u32 {
        6000 + e as u32
    }

    #[test]
    fn genuine_genesis_token_passes() {
        let (group, holder) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(group, group, holder, 1, 0, 1);
        check(&mut f, &holder, &group).unwrap();
    }

    #[test]
    fn token_held_by_someone_else_is_refused() {
        let (group, holder) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(group, group, holder, 1, 0, 1);
        assert_eq!(code(check(&mut f, &Pubkey::new_unique(), &group)), want(BaoError::SgtNotOwned));
    }

    #[test]
    fn member_of_another_group_is_refused() {
        let (group, fake, holder) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(fake, fake, holder, 1, 0, 1);
        assert_eq!(code(check(&mut f, &holder, &group)), want(BaoError::WrongSgtGroup));
    }

    #[test]
    fn metadata_pointer_must_point_at_the_group() {
        let (group, holder) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(group, Pubkey::new_unique(), holder, 1, 0, 1);
        assert_eq!(code(check(&mut f, &holder, &group)), want(BaoError::WrongSgtGroup));
    }

    #[test]
    fn empty_account_or_fungible_mint_is_refused() {
        let (group, holder) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(group, group, holder, 0, 0, 1);
        assert_eq!(code(check(&mut f, &holder, &group)), want(BaoError::NotASeeker));
        let mut f = fixture(group, group, holder, 1, 6, 1_000_000);
        assert_eq!(code(check(&mut f, &holder, &group)), want(BaoError::NotASeeker));
    }

    #[test]
    fn classic_spl_owned_account_is_refused() {
        let (group, holder) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(group, group, holder, 1, 0, 1);
        f.ta_owner = anchor_spl::token::ID;
        assert_eq!(code(check(&mut f, &holder, &group)), want(BaoError::NotASeeker));
    }

    #[test]
    fn token_account_for_a_different_mint_is_refused() {
        let (group, holder) = (Pubkey::new_unique(), Pubkey::new_unique());
        let mut f = fixture(group, group, holder, 1, 0, 1);
        let other = fixture(group, group, holder, 1, 0, 1);
        f.mint_key = other.mint_key;
        f.mint_data = other.mint_data;
        assert_eq!(code(check(&mut f, &holder, &group)), want(BaoError::NotASeeker));
    }
}
