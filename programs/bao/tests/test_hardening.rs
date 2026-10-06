//! Regression tests for attacks found in review: pre-funded PDAs, self-sabotaged payouts,
//! admin reach into live packets, and hostile or exotic mints.

mod common;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use bao::{
    error::BaoError,
    state::{Audience, ClaimStatus, SplitMode},
};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_2022_interface::extension::ExtensionType;

const RENT_EXEMPT_ZERO: u64 = 890_880;

fn lucky_packet(h: &mut Harness, id: u64, shares: u16, total: u64) -> (Keypair, Pubkey, Pubkey) {
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), total * 2);
    let args = create_args(id, total, shares, SplitMode::Lucky, Audience::Open, true);
    h.send(&[create_packet_ix(h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), id).0;
    (sender, mint, packet)
}

fn seeker(h: &mut Harness) -> (Keypair, Pubkey, Pubkey) {
    let c = h.funded();
    let (sgt, ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    (c, sgt, ta)
}

fn update_config(h: &mut Harness, f: impl FnOnce(&mut bao::UpdateConfigArgs)) {
    let admin = h.admin();
    let mut args = bao::UpdateConfigArgs {
        new_admin: None,
        sgt_group: None,
        treasury: None,
        fee_bps: None,
        crank_reward_lamports: None,
        paused: None,
    };
    f(&mut args);
    let ix = Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::UpdateConfig { args }.data(),
        bao::accounts::UpdateConfig { admin: admin.pubkey(), config: Harness::config_pda() }.to_account_metas(None),
    );
    h.send(&[ix], &admin).unwrap();
}

// --- C1: a pre-funded crown address must not lock a Lucky packet ----------------------------

#[test]
fn prefunded_crown_does_not_block_the_last_share() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 1, 1, 1_000);
    h.prefund(&crown_pda(&packet), RENT_EXEMPT_ZERO);
    let (c, sgt, ta) = seeker(&mut h);
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    h.settle(&packet, &claim_pda(&packet, &sgt), &c.pubkey(), &mint, [4; 32]);
    assert_eq!(h.token_balance(&ata(&c.pubkey(), &mint)), 1_000);
    let crown: bao::state::Crown = h.account(&crown_pda(&packet));
    assert_eq!(crown.king, c.pubkey());
}

#[test]
fn prefunded_crown_does_not_block_closing_an_expired_packet() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = lucky_packet(&mut h, 1, 3, 3_000);
    let (c, sgt, ta) = seeker(&mut h);
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    h.settle(&packet, &claim_pda(&packet, &sgt), &c.pubkey(), &mint, [4; 32]);
    h.prefund(&crown_pda(&packet), RENT_EXEMPT_ZERO);
    h.warp_seconds(86_401);
    let crank = h.funded();
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim_pda(&packet, &sgt)])], &crank).unwrap();
    h.send(&[close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint)], &crank).unwrap();
    assert!(!h.exists(&packet));
    let crown: bao::state::Crown = h.account(&crown_pda(&packet));
    assert_eq!(crown.king, c.pubkey());
}

// --- I1: a pre-funded claim address must not block a device ---------------------------------

#[test]
fn prefunded_claim_address_does_not_block_a_device() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 1, 2, 2_000);
    let (c, sgt, ta) = seeker(&mut h);
    h.prefund(&claim_pda(&packet, &sgt), RENT_EXEMPT_ZERO);
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    let r: bao::state::ClaimRecord = h.account(&claim_pda(&packet, &sgt));
    assert_eq!(r.status, ClaimStatus::Pending);
}

// --- I2: a grabber cannot make the callback fail or loop the gas tank -------------------------

#[test]
fn sabotaged_token_account_cannot_break_the_callback_or_drain_the_tank() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = lucky_packet(&mut h, 1, 2, 2_000);
    let gas = packet_pdas(&sender.pubkey(), 1).2;
    let (c, sgt, ta) = seeker(&mut h);
    let claimer_ata = h.fund_tokens(&mint, &c.pubkey(), 0);
    h.reassign_token_owner(&claimer_ata, &Pubkey::new_unique());
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    let claim = claim_pda(&packet, &sgt);

    // the callback only assigns the share, so it cannot be made to fail
    h.callback(&packet, &claim, [8; 32]).unwrap();
    let r: bao::state::ClaimRecord = h.account(&claim);
    assert_eq!(r.status, ClaimStatus::Won);
    assert!(r.amount >= 1);
    // the sabotage only hurts the saboteur
    assert!(h.payout(&packet, &claim, &c.pubkey(), &mint).is_err());
    // and the grab can no longer be cancelled and re-requested at the sender's expense
    let tank = h.lamports(&gas);
    h.warp_slots(301);
    let crank = h.funded();
    assert_err(h.send(&[cancel_stale_ix(&crank.pubkey(), &packet, &claim)], &crank), BaoError::NotPending);
    assert_eq!(h.lamports(&gas), tank);
}

#[test]
fn unpaid_win_is_forfeited_to_the_sender_only_after_expiry() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = lucky_packet(&mut h, 1, 1, 1_000);
    let (c, sgt, ta) = seeker(&mut h);
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    let claim = claim_pda(&packet, &sgt);
    h.callback(&packet, &claim, [8; 32]).unwrap();
    let crank = h.funded();
    // finished but not expired: a won share cannot be swept from its winner
    assert_err(h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim])], &crank), BaoError::WinNotPaid);
    h.warp_seconds(86_401);
    let before = h.token_balance(&ata(&sender.pubkey(), &mint));
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim])], &crank).unwrap();
    h.send(&[close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint)], &crank).unwrap();
    assert_eq!(h.token_balance(&ata(&sender.pubkey(), &mint)) - before, 1_000);
    assert_eq!(h.token_balance_or_zero(&ata(&c.pubkey(), &mint)), 0);
}

#[test]
fn callback_for_an_older_request_is_refused() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 1, 2, 2_000);
    let (c, sgt, ta) = seeker(&mut h);
    let grab = || grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)));
    h.send(&[grab()], &c).unwrap();
    let claim = claim_pda(&packet, &sgt);
    let first_slot = h.account::<bao::state::ClaimRecord>(&claim).requested_slot;
    h.warp_slots(301);
    let crank = h.funded();
    h.send(&[cancel_stale_ix(&crank.pubkey(), &packet, &claim)], &crank).unwrap();
    h.send(&[grab()], &c).unwrap();
    // the late answer to the first request must not settle the second one
    assert_err(h.send_as_vrf(&[vrf_callback_ix(&packet, &claim, [1; 32], first_slot)]), BaoError::WrongRequest);
    h.callback(&packet, &claim, [2; 32]).unwrap();
}

// --- I3: config changes cannot reach live packets ---------------------------------------------

#[test]
fn raising_the_crank_reward_later_does_not_drain_a_live_packet() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 10_000);
    let args = create_args(1, 1_000, 1, SplitMode::Equal, Audience::Open, true);
    h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), 1).0;
    let (c, sgt, ta) = seeker(&mut h);
    h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();

    update_config(&mut h, |a| a.crank_reward_lamports = Some(u64::MAX));
    let crank = h.funded();
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim_pda(&packet, &sgt)])], &crank).unwrap();
    let before = h.lamports(&crank.pubkey());
    h.send(&[close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint)], &crank).unwrap();
    assert_eq!(h.lamports(&crank.pubkey()), before - 5_000 + 10_000, "reward fixed at creation");
}

#[test]
fn switching_the_genesis_group_does_not_open_live_packets_to_other_tokens() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 10_000);
    let args = create_args(1, 2_000, 2, SplitMode::Equal, Audience::Open, true);
    h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), 1).0;

    let fake_group = Pubkey::new_unique();
    update_config(&mut h, |a| a.sgt_group = Some(fake_group));
    let attacker = h.funded();
    let (fm, fta) = h.make_sgt(&fake_group, &attacker.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&attacker.pubkey(), &packet, &mint, grab_args(fm, vec![], None), Some((fm, fta)))], &attacker),
        BaoError::WrongSgtGroup,
    );
    let (c, sgt, ta) = seeker(&mut h);
    h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
}

#[test]
fn sender_fee_ceiling_is_enforced() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 10_000);
    let mut args = create_args(1, 1_000, 2, SplitMode::Equal, Audience::Open, true);
    args.max_fee_bps = 50; // config charges 100
    assert_err(h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender), BaoError::FeeAboveLimit);
}

// --- I4: hostile and exotic mints ----------------------------------------------------------

#[test]
fn every_denied_token2022_extension_is_rejected() {
    for ext in [
        ExtensionType::TransferFeeConfig,
        ExtensionType::TransferHook,
        ExtensionType::PermanentDelegate,
        ExtensionType::DefaultAccountState,
        ExtensionType::Pausable,
        ExtensionType::NonTransferable,
        ExtensionType::ConfidentialTransferMint,
    ] {
        let mut h = Harness::ready();
        let sender = h.funded();
        let mint = h.make_t22_mint(6, Some(ext));
        h.fund_t22_plain(&mint, &sender.pubkey(), 1_000_000);
        let args = create_args(1, 1_000, 2, SplitMode::Equal, Audience::Open, true);
        let res = h.send(&[create_packet_ix_with(&h, &sender.pubkey(), &mint, &TOKEN_2022, args, None)], &sender);
        assert_err(res, BaoError::UnsafeMint);
    }
}

fn grab_equal_t22_ix(claimer: &Pubkey, packet: &Pubkey, mint: &Pubkey, args: bao::GrabArgs, sgt: (Pubkey, Pubkey)) -> Instruction {
    let mut ix = grab_equal_ix(claimer, packet, mint, args, Some(sgt));
    // claimer_token and token_program for Token-2022
    ix.accounts[7].pubkey = ata_with(claimer, mint, &TOKEN_2022);
    ix.accounts[10].pubkey = TOKEN_2022;
    ix
}

#[test]
fn token2022_packet_full_life_cycle() {
    let mut h = Harness::ready().with_vrf_stub();
    let sender = h.funded();
    let mint = h.make_t22_mint(6, Some(ExtensionType::MetadataPointer));
    h.fund_t22_plain(&mint, &sender.pubkey(), 1_000_000);
    let args = create_args(1, 9_000, 2, SplitMode::Equal, Audience::Open, true);
    h.send(&[create_packet_ix_with(&h, &sender.pubkey(), &mint, &TOKEN_2022, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), 1).0;
    let mut claims = vec![];
    for _ in 0..2 {
        let (c, sgt, ta) = seeker(&mut h);
        h.send(&[grab_equal_t22_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), (sgt, ta))], &c).unwrap();
        assert_eq!(h.token_balance(&ata_with(&c.pubkey(), &mint, &TOKEN_2022)), 4_500);
        claims.push(claim_pda(&packet, &sgt));
    }
    let crank = h.funded();
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &claims)], &crank).unwrap();
    let mut close = close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint);
    close.accounts[5].pubkey = ata_with(&sender.pubkey(), &mint, &TOKEN_2022);
    close.accounts[8].pubkey = TOKEN_2022;
    h.send(&[close], &crank).unwrap();
    assert!(!h.exists(&packet));
}

#[test]
fn token2022_lucky_payout() {
    let mut h = Harness::ready().with_vrf_stub();
    let sender = h.funded();
    let mint = h.make_t22_mint(6, None);
    h.fund_t22_plain(&mint, &sender.pubkey(), 1_000_000);
    let args = create_args(1, 5_000, 1, SplitMode::Lucky, Audience::Open, true);
    h.send(&[create_packet_ix_with(&h, &sender.pubkey(), &mint, &TOKEN_2022, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), 1).0;
    let (c, sgt, ta) = seeker(&mut h);
    let mut grab = grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)));
    grab.accounts[7].pubkey = ata_with(&c.pubkey(), &mint, &TOKEN_2022);
    grab.accounts[11].pubkey = TOKEN_2022;
    h.send(&[grab], &c).unwrap();
    let claim = claim_pda(&packet, &sgt);
    h.callback(&packet, &claim, [3; 32]).unwrap();
    h.payout_with(&packet, &claim, &c.pubkey(), &mint, &TOKEN_2022).unwrap();
    assert_eq!(h.token_balance(&ata_with(&c.pubkey(), &mint, &TOKEN_2022)), 5_000);
}

// --- I4: pause and account substitution ----------------------------------------------------

#[test]
fn pause_blocks_grabs_but_never_settlement_or_closing() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = lucky_packet(&mut h, 1, 2, 2_000);
    let (c, sgt, ta) = seeker(&mut h);
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    update_config(&mut h, |a| a.paused = Some(true));

    let (c2, sgt2, ta2) = seeker(&mut h);
    assert_err(
        h.send(&[grab_lucky_ix(&c2.pubkey(), &packet, &mint, grab_args(sgt2, vec![], None), Some((sgt2, ta2)))], &c2),
        BaoError::Paused,
    );
    h.settle(&packet, &claim_pda(&packet, &sgt), &c.pubkey(), &mint, [7; 32]);
    h.warp_seconds(86_401);
    let crank = h.funded();
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim_pda(&packet, &sgt)])], &crank).unwrap();
    h.send(&[close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint)], &crank).unwrap();
}

#[test]
fn another_packets_vault_or_the_wrong_token_program_is_refused() {
    let mut h = Harness::ready();
    let s1 = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &s1.pubkey(), 10_000);
    h.send(&[create_packet_ix(&h, &s1.pubkey(), &mint, create_args(1, 1_000, 2, SplitMode::Equal, Audience::Open, true), None)], &s1)
        .unwrap();
    h.send(&[create_packet_ix(&h, &s1.pubkey(), &mint, create_args(2, 1_000, 2, SplitMode::Equal, Audience::Open, true), None)], &s1)
        .unwrap();
    let (p1, _, _) = packet_pdas(&s1.pubkey(), 1);
    let (_, v2, _) = packet_pdas(&s1.pubkey(), 2);
    let (c, sgt, ta) = seeker(&mut h);

    let mut swapped_vault = grab_equal_ix(&c.pubkey(), &p1, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)));
    swapped_vault.accounts[4].pubkey = v2;
    assert!(h.send(&[swapped_vault], &c).is_err());

    let mut wrong_program = grab_equal_ix(&c.pubkey(), &p1, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)));
    wrong_program.accounts[10].pubkey = TOKEN_2022;
    assert!(h.send(&[wrong_program], &c).is_err());

    // the untouched instruction still works, so the failures above came from the substitutions
    h.send(&[grab_equal_ix(&c.pubkey(), &p1, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
}
