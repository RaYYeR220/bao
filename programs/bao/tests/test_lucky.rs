mod common;

use anchor_lang::prelude::Pubkey;
use bao::{
    error::BaoError,
    state::{Audience, ClaimStatus, SplitMode},
};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// A Lucky, Open, Seeker-only packet.
fn lucky_packet(h: &mut Harness, shares: u16, total: u64) -> (Keypair, Pubkey, Pubkey) {
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), total * 2);
    let args = create_args(1, total, shares, SplitMode::Lucky, Audience::Open, true);
    h.send(&[create_packet_ix(h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), 1).0;
    (sender, mint, packet)
}

/// A fresh Seeker grabs the packet; returns (grabber, genesis mint).
fn seeker_grab(h: &mut Harness, packet: &Pubkey, mint: &Pubkey) -> (Keypair, Pubkey) {
    let c = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    h.send(&[grab_lucky_ix(&c.pubkey(), packet, mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &c)
        .unwrap();
    (c, sgt_mint)
}

#[test]
fn lucky_grab_reserves_a_pending_slot_paid_by_the_gas_tank() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = lucky_packet(&mut h, 3, 3_000_000);
    let gas = packet_pdas(&sender.pubkey(), 1).2;
    let gas_before = h.lamports(&gas);
    let c = h.funded();
    let before = h.lamports(&c.pubkey());
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &c)
        .unwrap();

    let p: bao::state::Packet = h.account(&packet);
    assert_eq!((p.reserved, p.resolved, p.open_claims, p.remaining_amount), (1, 0, 1, 3_000_000));
    let record: bao::state::ClaimRecord = h.account(&claim_pda(&packet, &sgt_mint));
    assert_eq!(record.status, ClaimStatus::Pending);
    assert_eq!((record.index, record.amount, record.claimer), (0, 0, c.pubkey()));
    assert!(h.lamports(&gas) < gas_before, "claim record rent must come from the gas tank");
    assert!(before - h.lamports(&c.pubkey()) <= 10_000, "grabber paid more than the network fee");
    assert_eq!(h.token_balance_or_zero(&ata(&c.pubkey(), &mint)), 0, "no payout before randomness arrives");
}

#[test]
fn second_lucky_grab_from_the_same_device_is_refused() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 3, 3_000_000);
    let c = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    let ix = || grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)));
    h.send(&[ix()], &c).unwrap();
    assert_err(h.send(&[ix()], &c), BaoError::AlreadyGrabbedOnThisDevice);
}

#[test]
fn lucky_packet_cannot_be_grabbed_with_the_equal_instruction() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 3, 3_000_000);
    let c = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &c),
        BaoError::WrongMode,
    );
}

#[test]
fn lucky_packet_still_refuses_non_seekers() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 3, 3_000_000);
    let bot = h.funded();
    assert_err(
        h.send(&[grab_lucky_ix(&bot.pubkey(), &packet, &mint, grab_args(bot.pubkey(), vec![], None), None)], &bot),
        BaoError::NotASeeker,
    );
}

#[test]
fn reservations_stop_at_total_shares() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 2, 2_000);
    seeker_grab(&mut h, &packet, &mint);
    seeker_grab(&mut h, &packet, &mint);
    let c = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    assert_err(
        h.send(&[grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &c),
        BaoError::SoldOut,
    );
}

#[test]
fn callback_discriminator_matches_the_pinned_constant() {
    use anchor_lang::Discriminator;
    assert_eq!(bao::instruction::VrfCallback::DISCRIMINATOR, &bao::VRF_CALLBACK_DISCRIMINATOR[..]);
}

#[test]
fn callbacks_pay_every_share_and_crown_the_biggest_grab() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 3, 3_000_000);
    let grabs: Vec<(Keypair, Pubkey)> = (0..3).map(|_| seeker_grab(&mut h, &packet, &mint)).collect();
    let mut paid = vec![];
    for (i, (c, sgt)) in grabs.iter().enumerate() {
        let ix = vrf_callback_ix(&packet, &claim_pda(&packet, sgt), &mint, &c.pubkey(), [i as u8 * 50 + 11; 32]);
        h.send_as_vrf(&[ix]).unwrap();
        paid.push(h.token_balance(&ata(&c.pubkey(), &mint)));
    }
    assert_eq!(paid.iter().sum::<u64>(), 3_000_000);
    assert!(paid.iter().all(|a| *a >= 1));

    let p: bao::state::Packet = h.account(&packet);
    assert!(p.crowned);
    assert_eq!((p.resolved, p.remaining_amount), (3, 0));
    let king = paid.iter().enumerate().max_by_key(|(i, a)| (**a, std::cmp::Reverse(*i))).unwrap().0;
    let crown: bao::state::Crown = h.account(&crown_pda(&packet));
    assert_eq!(crown.king, grabs[king].0.pubkey());
    assert_eq!(crown.amount, paid[king]);
    assert_eq!((crown.chain_root, crown.chain_depth), (packet, 0));
    for (c, sgt) in &grabs {
        let r: bao::state::ClaimRecord = h.account(&claim_pda(&packet, sgt));
        assert_eq!(r.status, ClaimStatus::Paid);
        assert_eq!(r.amount, h.token_balance(&ata(&c.pubkey(), &mint)));
    }
}

#[test]
fn out_of_order_callbacks_still_sum_exactly() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 4, 1_000_003);
    let grabs: Vec<(Keypair, Pubkey)> = (0..4).map(|_| seeker_grab(&mut h, &packet, &mint)).collect();
    for i in [2usize, 0, 3, 1] {
        let (c, sgt) = &grabs[i];
        h.send_as_vrf(&[vrf_callback_ix(&packet, &claim_pda(&packet, sgt), &mint, &c.pubkey(), [i as u8 * 37 + 1; 32])])
            .unwrap();
    }
    let total: u64 = grabs.iter().map(|(c, _)| h.token_balance(&ata(&c.pubkey(), &mint))).sum();
    assert_eq!(total, 1_000_003);
}

#[test]
fn callback_not_signed_by_the_vrf_identity_is_refused() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 2, 2_000);
    let (c, sgt) = seeker_grab(&mut h, &packet, &mint);
    let attacker = h.funded();
    let mut ix = vrf_callback_ix(&packet, &claim_pda(&packet, &sgt), &mint, &c.pubkey(), [9; 32]);
    ix.accounts[0] = anchor_lang::solana_program::instruction::AccountMeta::new_readonly(attacker.pubkey(), true);
    assert!(h.send(&[ix], &attacker).is_err());
    assert_eq!(h.token_balance_or_zero(&ata(&c.pubkey(), &mint)), 0);
}

#[test]
fn second_callback_for_the_same_claim_is_refused() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 2, 2_000);
    let (c, sgt) = seeker_grab(&mut h, &packet, &mint);
    let ix = vrf_callback_ix(&packet, &claim_pda(&packet, &sgt), &mint, &c.pubkey(), [5; 32]);
    h.send_as_vrf(&[ix.clone()]).unwrap();
    assert_err(h.send_as_vrf(&[ix]), BaoError::NotPending);
}

#[test]
fn callback_for_a_different_claimer_is_refused() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 2, 2_000);
    let (_c, sgt) = seeker_grab(&mut h, &packet, &mint);
    let other = h.funded();
    let ix = vrf_callback_ix(&packet, &claim_pda(&packet, &sgt), &mint, &other.pubkey(), [5; 32]);
    assert!(h.send_as_vrf(&[ix]).is_err());
}

#[test]
fn stale_grab_can_be_cancelled_then_a_late_callback_pays_nothing_and_the_device_may_grab_again() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 2, 2_000);
    let c = h.funded();
    let (sgt, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    let grab = || grab_lucky_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, sgt_ta)));
    h.send(&[grab()], &c).unwrap();
    let claim = claim_pda(&packet, &sgt);
    let crank = h.funded();
    assert_err(h.send(&[cancel_stale_ix(&crank.pubkey(), &packet, &claim)], &crank), BaoError::NotStale);

    h.warp_slots(301);
    h.send(&[cancel_stale_ix(&crank.pubkey(), &packet, &claim)], &crank).unwrap();
    let p: bao::state::Packet = h.account(&packet);
    assert_eq!((p.reserved, p.open_claims), (0, 0));
    assert!(!h.exists(&claim));

    let late = vrf_callback_ix(&packet, &claim, &mint, &c.pubkey(), [1; 32]);
    assert!(h.send_as_vrf(&[late]).is_err());
    assert_eq!(h.token_balance_or_zero(&ata(&c.pubkey(), &mint)), 0);

    h.send(&[grab()], &c).unwrap();
    let p: bao::state::Packet = h.account(&packet);
    assert_eq!(p.reserved, 1);
}

#[test]
fn paid_claims_cannot_be_cancelled() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_s, mint, packet) = lucky_packet(&mut h, 2, 2_000);
    let (c, sgt) = seeker_grab(&mut h, &packet, &mint);
    let claim = claim_pda(&packet, &sgt);
    h.send_as_vrf(&[vrf_callback_ix(&packet, &claim, &mint, &c.pubkey(), [3; 32])]).unwrap();
    h.warp_slots(301);
    let crank = h.funded();
    assert_err(h.send(&[cancel_stale_ix(&crank.pubkey(), &packet, &claim)], &crank), BaoError::NotPending);
}
