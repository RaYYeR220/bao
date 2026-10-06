//! The devnet deployment checks a test group. This proves the same on-chain check accepts a
//! real Seeker Genesis Token mint copied byte-for-byte from mainnet, and refuses it for any
//! other group.

mod common;

use anchor_lang::prelude::Pubkey;
use bao::{
    error::BaoError,
    state::{Audience, SplitMode},
};
use common::*;
use solana_account::Account;
use solana_signer::Signer;
use spl_token_2022_interface::{
    extension::{BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut},
    state::{Account as T22Account, AccountState},
};

const GENESIS_GROUP: Pubkey = anchor_lang::pubkey!("GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te");
const REAL_GENESIS_MINT: Pubkey = anchor_lang::pubkey!("5mXbkqKz883aufhAsx3p5Z1NcvD2ppZbdTTznM6oUKLj");

fn harness_for_group(group: Pubkey) -> Harness {
    let mut h = Harness::new();
    let admin = h.admin();
    h.set_upgrade_authority(&admin.pubkey());
    h.send(&[Harness::init_config_ix(&admin.pubkey(), group, 100)], &admin).unwrap();
    // the real mainnet mint account, as fetched from mainnet
    let data = include_bytes!("fixtures/sgt_mainnet_mint.bin").to_vec();
    let lamports = h.svm.minimum_balance_for_rent_exemption(data.len());
    h.svm
        .set_account(REAL_GENESIS_MINT, Account { lamports, data, owner: TOKEN_2022, executable: false, rent_epoch: 0 })
        .unwrap();
    h
}

/// A Token-2022 account holding the real genesis mint, owned by `owner`.
fn hold_real_genesis(h: &mut Harness, owner: &Pubkey) -> Pubkey {
    let ta = Pubkey::new_unique();
    let space = ExtensionType::try_calculate_account_len::<T22Account>(&[ExtensionType::ImmutableOwner]).unwrap();
    let mut data = vec![0u8; space];
    {
        let mut s = StateWithExtensionsMut::<T22Account>::unpack_uninitialized(&mut data).unwrap();
        s.init_extension::<spl_token_2022_interface::extension::immutable_owner::ImmutableOwner>(true).unwrap();
        s.base.mint = REAL_GENESIS_MINT.to_bytes().into();
        s.base.owner = owner.to_bytes().into();
        s.base.amount = 1;
        s.base.state = AccountState::Initialized;
        s.pack_base();
        s.init_account_type().unwrap();
    }
    let lamports = h.svm.minimum_balance_for_rent_exemption(data.len());
    h.svm.set_account(ta, Account { lamports, data, owner: TOKEN_2022, executable: false, rent_epoch: 0 }).unwrap();
    ta
}

fn open_packet(h: &mut Harness) -> (Pubkey, Pubkey) {
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 10_000);
    let args = create_args(1, 1_000, 2, SplitMode::Equal, Audience::Open, true);
    h.send(&[create_packet_ix(h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    (packet_pdas(&sender.pubkey(), 1).0, mint)
}

#[test]
fn real_mainnet_genesis_token_passes_the_seeker_check() {
    let mut h = harness_for_group(GENESIS_GROUP);
    let (packet, mint) = open_packet(&mut h);
    let seeker = h.funded();
    let ta = hold_real_genesis(&mut h, &seeker.pubkey());
    h.send(
        &[grab_equal_ix(&seeker.pubkey(), &packet, &mint, grab_args(REAL_GENESIS_MINT, vec![], None), Some((REAL_GENESIS_MINT, ta)))],
        &seeker,
    )
    .unwrap();
    assert_eq!(h.token_balance(&ata(&seeker.pubkey(), &mint)), 500);
}

#[test]
fn real_mainnet_genesis_token_is_refused_for_another_group() {
    let mut h = harness_for_group(TEST_GROUP);
    let (packet, mint) = open_packet(&mut h);
    let seeker = h.funded();
    let ta = hold_real_genesis(&mut h, &seeker.pubkey());
    assert_err(
        h.send(
            &[grab_equal_ix(&seeker.pubkey(), &packet, &mint, grab_args(REAL_GENESIS_MINT, vec![], None), Some((REAL_GENESIS_MINT, ta)))],
            &seeker,
        ),
        BaoError::WrongSgtGroup,
    );
}
