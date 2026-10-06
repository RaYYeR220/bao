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
