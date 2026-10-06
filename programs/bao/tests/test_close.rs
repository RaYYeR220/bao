mod common;

use anchor_lang::prelude::Pubkey;
use bao::{
    error::BaoError,
    state::{Audience, SplitMode},
};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// An Open, Seeker-only packet with id 1.
fn make_packet(h: &mut Harness, mode: SplitMode, shares: u16, total: u64) -> (Keypair, Pubkey, Pubkey) {
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), total * 2);
    let args = create_args(1, total, shares, mode, Audience::Open, true);
    h.send(&[create_packet_ix(h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), 1).0;
    (sender, mint, packet)
}

/// A fresh Seeker reserves a Lucky share; returns (grabber, genesis mint).
fn lucky_grab(h: &mut Harness, packet: &Pubkey, mint: &Pubkey) -> (Keypair, Pubkey) {
    let c = h.funded();
    let (sgt, ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    h.send(&[grab_lucky_ix(&c.pubkey(), packet, mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
    (c, sgt)
}

fn deliver(h: &mut Harness, packet: &Pubkey, mint: &Pubkey, c: &Keypair, sgt: &Pubkey, byte: u8) {
    h.send_as_vrf(&[vrf_callback_ix(packet, &claim_pda(packet, sgt), mint, &c.pubkey(), [byte; 32])]).unwrap();
}

#[test]
fn close_is_refused_while_active_pending_or_with_open_claims() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = make_packet(&mut h, SplitMode::Lucky, 2, 2_000);
    let crank = h.funded();
    let close = |h: &Harness| close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint);
    assert_err(h.send(&[close(&h)], &crank), BaoError::StillActive);

    let (c, sgt) = lucky_grab(&mut h, &packet, &mint);
    h.warp_seconds(86_401);
    assert_err(h.send(&[close(&h)], &crank), BaoError::PendingGrabs);
    assert_err(h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim_pda(&packet, &sgt)])], &crank), BaoError::PendingGrabs);

    deliver(&mut h, &packet, &mint, &c, &sgt, 3);
    assert_err(h.send(&[close(&h)], &crank), BaoError::OpenClaims);
}

#[test]
fn expired_packet_returns_tokens_and_lamports_to_the_sender_and_crowns_the_king() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = make_packet(&mut h, SplitMode::Lucky, 3, 3_000);
    let (c, sgt) = lucky_grab(&mut h, &packet, &mint);
    deliver(&mut h, &packet, &mint, &c, &sgt, 3);
    let got = h.token_balance(&ata(&c.pubkey(), &mint));
    h.warp_seconds(86_401);

    let crank = h.funded();
    let crank_before = h.lamports(&crank.pubkey());
    let lamports_before = h.lamports(&sender.pubkey());
    let tokens_before = h.token_balance(&ata(&sender.pubkey(), &mint));
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &[claim_pda(&packet, &sgt)])], &crank).unwrap();
    h.send(&[close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint)], &crank).unwrap();

    let (_, vault, gas) = packet_pdas(&sender.pubkey(), 1);
    assert!(!h.exists(&packet));
    assert!(!h.exists(&vault));
    assert!(!h.exists(&gas));
    assert!(!h.exists(&claim_pda(&packet, &sgt)));
    assert_eq!(h.token_balance(&ata(&sender.pubkey(), &mint)) - tokens_before, 3_000 - got);
    assert!(h.lamports(&sender.pubkey()) > lamports_before, "rent and unspent gas go back to the sender");
    // two transactions at 5_000 lamports each, minus the 10_000 crank reward
    assert!(h.lamports(&crank.pubkey()) + 10_000 >= crank_before, "the crank is not out of pocket");
    let crown: bao::state::Crown = h.account(&crown_pda(&packet));
    assert_eq!((crown.king, crown.amount), (c.pubkey(), got));
}

#[test]
fn finished_equal_packet_closes_before_expiry_without_a_crown() {
    let mut h = Harness::ready();
    let (sender, mint, packet) = make_packet(&mut h, SplitMode::Equal, 2, 2_000);
    let mut claims = vec![];
    for _ in 0..2 {
        let c = h.funded();
        let (sgt, ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
        claims.push(claim_pda(&packet, &sgt));
    }
    let crank = h.funded();
    h.send(&[close_claims_ix(&crank.pubkey(), &packet, &claims)], &crank).unwrap();
    h.send(&[close_packet_ix(&crank.pubkey(), &packet, &sender.pubkey(), &mint)], &crank).unwrap();
    assert!(!h.exists(&packet));
    assert!(!h.exists(&crown_pda(&packet)));
}

#[test]
fn close_claims_rejects_records_of_another_packet() {
    let mut h = Harness::ready();
    let (_s1, mint1, p1) = make_packet(&mut h, SplitMode::Equal, 1, 1_000);
    let (_s2, mint2, p2) = make_packet(&mut h, SplitMode::Equal, 1, 1_000);
    let grab = |h: &mut Harness, packet: &Pubkey, mint: &Pubkey| {
        let c = h.funded();
        let (sgt, ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
        h.send(&[grab_equal_ix(&c.pubkey(), packet, mint, grab_args(sgt, vec![], None), Some((sgt, ta)))], &c).unwrap();
        claim_pda(packet, &sgt)
    };
    let _c1 = grab(&mut h, &p1, &mint1);
    let c2 = grab(&mut h, &p2, &mint2);
    let crank = h.funded();
    assert_err(h.send(&[close_claims_ix(&crank.pubkey(), &p1, &[c2])], &crank), BaoError::WrongPacket);
}

#[test]
fn only_the_luck_king_continues_the_chain_and_only_once() {
    let mut h = Harness::ready().with_vrf_stub();
    let (_sender, mint, packet) = make_packet(&mut h, SplitMode::Lucky, 1, 1_000);
    let (king, sgt) = lucky_grab(&mut h, &packet, &mint);
    deliver(&mut h, &packet, &mint, &king, &sgt, 1);
    let crown = crown_pda(&packet);
    let next = |id| create_args(id, 1_000, 2, SplitMode::Lucky, Audience::Open, true);

    let stranger = h.funded();
    h.fund_tokens(&mint, &stranger.pubkey(), 10_000);
    assert_err(
        h.send(&[create_packet_ix(&h, &stranger.pubkey(), &mint, next(1), Some(crown))], &stranger),
        BaoError::NotLuckKing,
    );

    h.fund_tokens(&mint, &king.pubkey(), 10_000);
    h.send(&[create_packet_ix(&h, &king.pubkey(), &mint, next(1), Some(crown))], &king).unwrap();
    let child: bao::state::Packet = h.account(&packet_pdas(&king.pubkey(), 1).0);
    assert_eq!((child.parent, child.chain_root, child.chain_depth), (Some(packet), packet, 1));
    assert!(!h.exists(&crown));
    assert!(h.send(&[create_packet_ix(&h, &king.pubkey(), &mint, next(2), Some(crown))], &king).is_err());
}

#[test]
fn crown_can_only_be_closed_after_it_expires() {
    let mut h = Harness::ready().with_vrf_stub();
    let (sender, mint, packet) = make_packet(&mut h, SplitMode::Lucky, 1, 1_000);
    let (k, sgt) = lucky_grab(&mut h, &packet, &mint);
    deliver(&mut h, &packet, &mint, &k, &sgt, 1);
    let crank = h.funded();
    assert_err(h.send(&[close_crown_ix(&crank.pubkey(), &packet, &sender.pubkey())], &crank), BaoError::CrownActive);
    h.warp_seconds(7 * 86_400 + 1);
    let before = h.lamports(&sender.pubkey());
    h.send(&[close_crown_ix(&crank.pubkey(), &packet, &sender.pubkey())], &crank).unwrap();
    assert!(!h.exists(&crown_pda(&packet)));
    assert!(h.lamports(&sender.pubkey()) > before);
}
