mod common;

use anchor_lang::prelude::Pubkey;
use bao::{
    error::BaoError,
    state::{Audience, ClaimStatus, SplitMode},
};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// An Equal packet of 1_000_000 units with `shares` shares.
fn equal_packet(h: &mut Harness, id: u64, shares: u16, audience: Audience, seeker_only: bool) -> (Keypair, Pubkey, Pubkey) {
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 10_000_000_000);
    let args = create_args(id, 1_000_000, shares, SplitMode::Equal, audience, seeker_only);
    h.send(&[create_packet_ix(h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let packet = packet_pdas(&sender.pubkey(), id).0;
    (sender, mint, packet)
}

#[test]
fn seeker_grabs_an_equal_share_and_pays_only_the_network_fee() {
    let mut h = Harness::ready();
    let (_sender, mint, packet) = equal_packet(&mut h, 1, 4, Audience::Open, true);
    let claimer = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &claimer.pubkey());
    let before = h.lamports(&claimer.pubkey());
    h.send(
        &[grab_equal_ix(&claimer.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))],
        &claimer,
    )
    .unwrap();

    assert_eq!(h.token_balance(&ata(&claimer.pubkey(), &mint)), 250_000);
    let p: bao::state::Packet = h.account(&packet);
    assert_eq!((p.reserved, p.resolved, p.open_claims, p.remaining_amount), (1, 1, 1, 750_000));
    let record: bao::state::ClaimRecord = h.account(&claim_pda(&packet, &sgt_mint));
    assert_eq!((record.claimer, record.device_key, record.index, record.amount), (claimer.pubkey(), sgt_mint, 0, 250_000));
    assert_eq!(record.status, ClaimStatus::Paid);
    let spent = before - h.lamports(&claimer.pubkey());
    assert!(spent <= 10_000, "grabber paid more than the network fee: {spent}");
}

#[test]
fn wallet_without_genesis_token_is_refused() {
    let mut h = Harness::ready();
    let (_s, mint, packet) = equal_packet(&mut h, 1, 4, Audience::Open, true);
    let bot = h.funded();
    assert_err(
        h.send(&[grab_equal_ix(&bot.pubkey(), &packet, &mint, grab_args(bot.pubkey(), vec![], None), None)], &bot),
        BaoError::NotASeeker,
    );
}

#[test]
fn same_genesis_token_from_a_second_wallet_is_refused() {
    let mut h = Harness::ready();
    let (_s, mint, packet) = equal_packet(&mut h, 1, 4, Audience::Open, true);
    let w1 = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &w1.pubkey());
    h.send(&[grab_equal_ix(&w1.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &w1)
        .unwrap();
    // the genesis token moves to another wallet of the same person
    let w2 = h.funded();
    h.move_t22_token(&sgt_ta, &w2.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&w2.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &w2),
        BaoError::AlreadyGrabbedOnThisDevice,
    );
    assert_eq!(h.token_balance_or_zero(&ata(&w2.pubkey(), &mint)), 0);
}

#[test]
fn genesis_token_of_someone_else_is_refused() {
    let mut h = Harness::ready();
    let (_s, mint, packet) = equal_packet(&mut h, 1, 4, Audience::Open, true);
    let owner = h.funded();
    let thief = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &owner.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&thief.pubkey(), &packet, &mint, grab_args(sgt_mint, vec![], None), Some((sgt_mint, sgt_ta)))], &thief),
        BaoError::SgtNotOwned,
    );
}

#[test]
fn fake_genesis_tokens_are_refused() {
    let mut h = Harness::ready();
    let (_s, mint, packet) = equal_packet(&mut h, 1, 4, Audience::Open, true);
    let c = h.funded();
    let fake_group = Pubkey::new_unique();
    let (m, ta) = h.make_member_mint(&fake_group, &fake_group, &c.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(m, vec![], None), Some((m, ta)))], &c),
        BaoError::WrongSgtGroup,
    );
    let c2 = h.funded();
    let (m2, ta2) = h.make_member_mint(&TEST_GROUP, &Pubkey::new_unique(), &c2.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&c2.pubkey(), &packet, &mint, grab_args(m2, vec![], None), Some((m2, ta2)))], &c2),
        BaoError::WrongSgtGroup,
    );
}

#[test]
fn device_key_must_be_the_genesis_mint() {
    let mut h = Harness::ready();
    let (_s, mint, packet) = equal_packet(&mut h, 1, 4, Audience::Open, true);
    let c = h.funded();
    let (sgt_mint, sgt_ta) = h.make_sgt(&TEST_GROUP, &c.pubkey());
    assert_err(
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(c.pubkey(), vec![], None), Some((sgt_mint, sgt_ta)))], &c),
        BaoError::BadDeviceKey,
    );
}

#[test]
fn circle_member_grabs_and_stranger_is_refused() {
    let mut h = Harness::ready();
    let members: Vec<Keypair> = (0..3).map(|_| h.funded()).collect();
    let (root, proofs) = merkle_tree(&members.iter().map(|k| k.pubkey()).collect::<Vec<_>>());
    let (_s, mint, packet) = equal_packet(&mut h, 1, 3, Audience::Circle { merkle_root: root }, false);
    let m0 = &members[0];
    h.send(&[grab_equal_ix(&m0.pubkey(), &packet, &mint, grab_args(m0.pubkey(), proofs[0].clone(), None), None)], m0)
        .unwrap();
    assert_eq!(h.token_balance(&ata(&m0.pubkey(), &mint)), 333_333);
    let stranger = h.funded();
    assert_err(
        h.send(&[grab_equal_ix(&stranger.pubkey(), &packet, &mint, grab_args(stranger.pubkey(), proofs[1].clone(), None), None)], &stranger),
        BaoError::NotInCircle,
    );
}

#[test]
fn circle_member_cannot_grab_twice() {
    let mut h = Harness::ready();
    let members: Vec<Keypair> = (0..2).map(|_| h.funded()).collect();
    let (root, proofs) = merkle_tree(&members.iter().map(|k| k.pubkey()).collect::<Vec<_>>());
    let (_s, mint, packet) = equal_packet(&mut h, 1, 2, Audience::Circle { merkle_root: root }, false);
    let m = &members[1];
    let ix = || grab_equal_ix(&m.pubkey(), &packet, &mint, grab_args(m.pubkey(), proofs[1].clone(), None), None);
    h.send(&[ix()], m).unwrap();
    assert_err(h.send(&[ix()], m), BaoError::AlreadyGrabbedOnThisDevice);
}

#[test]
fn code_word_packet_needs_the_right_word() {
    let mut h = Harness::ready();
    let sender = h.funded();
    let mint = h.make_spl_mint(6);
    h.fund_tokens(&mint, &sender.pubkey(), 10_000_000);
    let packet = packet_pdas(&sender.pubkey(), 9).0;
    let code_hash = bao::audience::code_hash(b"gongxi facai", &packet);
    let args = create_args(9, 1_000, 2, SplitMode::Equal, Audience::Code { code_hash }, false);
    h.send(&[create_packet_ix(&h, &sender.pubkey(), &mint, args, None)], &sender).unwrap();
    let c = h.funded();
    assert_err(
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(c.pubkey(), vec![], Some(b"wrong".to_vec())), None)], &c),
        BaoError::WrongCode,
    );
    assert_err(
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(c.pubkey(), vec![], None), None)], &c),
        BaoError::WrongCode,
    );
    h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(c.pubkey(), vec![], Some(b"gongxi facai".to_vec())), None)], &c)
        .unwrap();
}

#[test]
fn sold_out_packet_is_refused() {
    let mut h = Harness::ready();
    let a = h.funded();
    let b = h.funded();
    let (root, proofs) = merkle_tree(&[a.pubkey(), b.pubkey()]);
    let (_s, mint, packet) = equal_packet(&mut h, 1, 1, Audience::Circle { merkle_root: root }, false);
    h.send(&[grab_equal_ix(&a.pubkey(), &packet, &mint, grab_args(a.pubkey(), proofs[0].clone(), None), None)], &a).unwrap();
    assert_eq!(h.token_balance(&ata(&a.pubkey(), &mint)), 1_000_000);
    assert_err(
        h.send(&[grab_equal_ix(&b.pubkey(), &packet, &mint, grab_args(b.pubkey(), proofs[1].clone(), None), None)], &b),
        BaoError::SoldOut,
    );
}

#[test]
fn expired_packet_is_refused() {
    let mut h = Harness::ready();
    let c = h.funded();
    let (root, proofs) = merkle_tree(&[c.pubkey()]);
    let (_s, mint, packet) = equal_packet(&mut h, 1, 2, Audience::Circle { merkle_root: root }, false);
    h.warp_seconds(86_401);
    assert_err(
        h.send(&[grab_equal_ix(&c.pubkey(), &packet, &mint, grab_args(c.pubkey(), proofs[0].clone(), None), None)], &c),
        BaoError::Expired,
    );
}

#[test]
fn last_equal_share_takes_the_remainder() {
    let mut h = Harness::ready();
    let members: Vec<Keypair> = (0..3).map(|_| h.funded()).collect();
    let (root, proofs) = merkle_tree(&members.iter().map(|k| k.pubkey()).collect::<Vec<_>>());
    let (_s, mint, packet) = equal_packet(&mut h, 1, 3, Audience::Circle { merkle_root: root }, false);
    for (i, m) in members.iter().enumerate() {
        h.send(&[grab_equal_ix(&m.pubkey(), &packet, &mint, grab_args(m.pubkey(), proofs[i].clone(), None), None)], m)
            .unwrap();
    }
    let got: Vec<u64> = members.iter().map(|m| h.token_balance(&ata(&m.pubkey(), &mint))).collect();
    assert_eq!(got, vec![333_333, 333_333, 333_334]);
    let p: bao::state::Packet = h.account(&packet);
    assert!(p.is_finished());
    assert_eq!(p.remaining_amount, 0);
}
