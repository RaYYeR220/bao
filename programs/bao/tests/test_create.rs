mod common;

use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use bao::{
    error::BaoError,
    state::{Audience, SplitMode},
};
use common::*;
use solana_signer::Signer;

#[test]
fn create_moves_tokens_takes_fee_and_funds_gas() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    let src = h.fund_tokens(&mint, &sender.pubkey(), 1_000_000_000);
    let args = create_args(1, 100_000_000, 10, SplitMode::Lucky, Audience::Open, true);
    h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();

    let (packet, vault, gas) = packet_pdas(&sender.pubkey(), 1);
    let p: bao::state::Packet = h.account(&packet);
    assert_eq!((p.total_amount, p.remaining_amount, p.total_shares), (100_000_000, 100_000_000, 10));
    assert_eq!((p.reserved, p.resolved, p.open_claims), (0, 0, 0));
    assert_eq!(p.chain_root, packet);
    assert_eq!(p.chain_depth, 0);
    assert_eq!(p.parent, None);
    assert_eq!(p.message_hash, [7u8; 32]);
    assert_eq!(h.token_balance(&vault), 100_000_000);
    assert_eq!(h.token_balance(&src), 1_000_000_000 - 100_000_000 - 1_000_000);
    assert_eq!(h.token_balance(&ata(&h.admin.pubkey(), &mint)), 1_000_000);
    let gas_lamports = h.lamports(&gas);
    assert!(gas_lamports > 10 * 2_000_000, "gas tank underfunded: {gas_lamports}");
}

#[test]
fn open_packet_must_be_seeker_only() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 1_000_000);
    let args = create_args(2, 1_000, 10, SplitMode::Lucky, Audience::Open, false);
    assert_err(h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender), BaoError::OpenMustBeSeekerOnly);
}

#[test]
fn bounds_are_enforced() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 1_000_000_000);
    let open = |id, total, shares| create_args(id, total, shares, SplitMode::Equal, Audience::Open, true);
    let mut short = open(6, 1_000, 10);
    short.expires_in = 60;
    let mut long = open(7, 1_000, 10);
    long.expires_in = 8 * 86_400;
    for (args, err) in [
        (open(3, 1_000, 0), BaoError::BadShares),
        (open(4, 1_000, 201), BaoError::BadShares),
        (open(5, 9, 10), BaoError::TotalTooSmall),
        (short, BaoError::BadExpiry),
        (long, BaoError::BadExpiry),
    ] {
        assert_err(h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender), err);
    }
}

#[test]
fn hostile_token2022_mint_is_rejected() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_t22_mint_with_transfer_fee(6);
    h.fund_t22_tokens(&mint, &sender.pubkey(), 1_000_000_000);
    let args = create_args(8, 100_000, 10, SplitMode::Lucky, Audience::Open, true);
    assert_err(
        h.send(&[create_packet_ix_with(&h, &sender.pubkey(), &mint, &TOKEN_2022, args, None)], &sender),
        BaoError::UnsafeMint,
    );
}

#[test]
fn circle_packet_has_no_fee_and_may_skip_seeker_check() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    let src = h.fund_tokens(&mint, &sender.pubkey(), 1_000);
    let args = create_args(9, 1_000, 4, SplitMode::Equal, Audience::Circle { merkle_root: [9u8; 32] }, false);
    h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    assert_eq!(h.token_balance(&src), 0);
    assert_eq!(h.token_balance(&ata(&h.admin.pubkey(), &mint)), 0);
}

#[test]
fn paused_program_refuses_new_packets() {
    let mut h = Harness::ready();
    let admin = h.admin();
    let pause = Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::UpdateConfig {
            args: bao::UpdateConfigArgs {
                new_admin: None,
                sgt_group: None,
                treasury: None,
                fee_bps: None,
                crank_reward_lamports: None,
                paused: Some(true),
            },
        }
        .data(),
        bao::accounts::UpdateConfig { admin: admin.pubkey(), config: Harness::config_pda() }.to_account_metas(None),
    );
    h.send(&[pause], &admin).unwrap();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 1_000);
    let args = create_args(10, 1_000, 2, SplitMode::Equal, Audience::Open, true);
    assert_err(h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender), BaoError::Paused);
}
