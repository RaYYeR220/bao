mod common;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use bao::error::BaoError;
use common::*;
use solana_signer::Signer;

#[test]
fn upgrade_authority_can_init_config() {
    let mut h = Harness::new();
    let admin = h.admin();
    h.set_upgrade_authority(&admin.pubkey());
    let group = Pubkey::new_unique();
    h.send(&[Harness::init_config_ix(&admin.pubkey(), group, 100)], &admin).unwrap();

    let cfg: bao::state::Config = h.account(&Harness::config_pda());
    assert_eq!(cfg.admin, admin.pubkey());
    assert_eq!(cfg.sgt_group, group);
    assert_eq!(cfg.fee_bps, 100);
    assert_eq!(cfg.crank_reward_lamports, 10_000);
    assert!(!cfg.paused);
}

#[test]
fn stranger_cannot_init_config() {
    let mut h = Harness::new();
    let admin = h.admin();
    h.set_upgrade_authority(&admin.pubkey());
    let stranger = h.funded();
    let res = h.send(&[Harness::init_config_ix(&stranger.pubkey(), Pubkey::new_unique(), 100)], &stranger);
    assert!(res.is_err(), "a non-upgrade-authority must not be able to claim the config");
}

#[test]
fn fee_above_max_is_rejected() {
    let mut h = Harness::new();
    let admin = h.admin();
    h.set_upgrade_authority(&admin.pubkey());
    assert_err(
        h.send(&[Harness::init_config_ix(&admin.pubkey(), Pubkey::new_unique(), 501)], &admin),
        BaoError::FeeTooHigh,
    );
}

fn update_ix(admin: &Pubkey, args: bao::UpdateConfigArgs) -> Instruction {
    Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::UpdateConfig { args }.data(),
        bao::accounts::UpdateConfig { admin: *admin, config: Harness::config_pda() }.to_account_metas(None),
    )
}

fn no_change() -> bao::UpdateConfigArgs {
    bao::UpdateConfigArgs {
        new_admin: None,
        sgt_group: None,
        treasury: None,
        fee_bps: None,
        crank_reward_lamports: None,
        paused: None,
    }
}

#[test]
fn admin_can_pause_and_stranger_cannot() {
    let mut h = Harness::new();
    let admin = h.admin();
    h.set_upgrade_authority(&admin.pubkey());
    h.send(&[Harness::init_config_ix(&admin.pubkey(), Pubkey::new_unique(), 100)], &admin).unwrap();

    let stranger = h.funded();
    let res = h.send(&[update_ix(&stranger.pubkey(), bao::UpdateConfigArgs { paused: Some(true), ..no_change() })], &stranger);
    assert!(res.is_err());

    h.send(&[update_ix(&admin.pubkey(), bao::UpdateConfigArgs { paused: Some(true), ..no_change() })], &admin).unwrap();
    let cfg: bao::state::Config = h.account(&Harness::config_pda());
    assert!(cfg.paused);

    assert_err(
        h.send(&[update_ix(&admin.pubkey(), bao::UpdateConfigArgs { fee_bps: Some(900), ..no_change() })], &admin),
        BaoError::FeeTooHigh,
    );
}
