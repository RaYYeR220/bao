#![allow(dead_code)]

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
    ToAccountMetas,
};
use litesvm::{types::TransactionResult, LiteSVM};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const SYSTEM_PROGRAM: Pubkey = anchor_lang::system_program::ID;
pub const UPGRADEABLE_LOADER: Pubkey =
    anchor_lang::pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

pub fn program_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/bao.so"))
}

pub fn noop_bytes() -> &'static [u8] {
    include_bytes!("../fixtures/noop.so")
}

pub struct Harness {
    pub svm: LiteSVM,
    pub admin: Keypair,
}

impl Harness {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new().with_sigverify(false);
        svm.add_program(bao::ID, program_bytes()).unwrap();
        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
        Self { svm, admin }
    }

    pub fn admin(&self) -> Keypair {
        self.admin.insecure_clone()
    }

    pub fn funded(&mut self) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        k
    }

    /// Sends `ixs` with `payer` as fee payer. Extra signer keys may be listed in
    /// `extra_signers`; with sigverify off their signatures are not checked, which
    /// lets tests act as PDAs such as the VRF identity.
    pub fn send_with(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TransactionResult {
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair) -> TransactionResult {
        self.send_with(ixs, payer, &[])
    }

    pub fn account<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).expect("account missing");
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn exists(&self, key: &Pubkey) -> bool {
        self.svm.get_account(key).map(|a| a.lamports > 0).unwrap_or(false)
    }

    pub fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn config_pda() -> Pubkey {
        Pubkey::find_program_address(&[bao::constants::CONFIG_SEED], &bao::ID).0
    }

    pub fn program_data() -> Pubkey {
        Pubkey::find_program_address(&[bao::ID.as_ref()], &UPGRADEABLE_LOADER).0
    }

    /// Rewrites the ProgramData header so `authority` is the upgrade authority.
    pub fn set_upgrade_authority(&mut self, authority: &Pubkey) {
        let key = Self::program_data();
        let mut acc: Account = self.svm.get_account(&key).unwrap();
        // UpgradeableLoaderState::ProgramData = tag u32 (3) | slot u64 | Option<Pubkey>
        acc.data[0..4].copy_from_slice(&3u32.to_le_bytes());
        acc.data[12] = 1;
        acc.data[13..45].copy_from_slice(authority.as_ref());
        self.svm.set_account(key, acc).unwrap();
    }

    pub fn init_config_ix(admin: &Pubkey, sgt_group: Pubkey, fee_bps: u16) -> Instruction {
        Instruction::new_with_bytes(
            bao::ID,
            &bao::instruction::InitConfig {
                args: bao::InitConfigArgs {
                    sgt_group,
                    treasury: *admin,
                    fee_bps,
                    crank_reward_lamports: 10_000,
                },
            }
            .data(),
            bao::accounts::InitConfig {
                admin: *admin,
                config: Self::config_pda(),
                program: bao::ID,
                program_data: Self::program_data(),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
        )
    }
}

// ---------------------------------------------------------------------------
// Tokens and packets
// ---------------------------------------------------------------------------

use bao::state::{Audience, SplitMode};
use spl_pod::optional_keys::OptionalNonZeroPubkey;
use spl_token_2022_interface::extension::{
    metadata_pointer::MetadataPointer,
    transfer_fee::{TransferFeeAmount, TransferFeeConfig},
    BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
};
use spl_token_2022_interface::state::{Account as T22Account, AccountState, Mint as T22Mint};
use spl_token_group_interface::state::TokenGroupMember;

pub const TOKEN: Pubkey = anchor_spl::token::ID;
pub const TOKEN_2022: Pubkey = anchor_spl::token_2022::ID;
pub const ATA_PROGRAM: Pubkey = anchor_spl::associated_token::ID;
pub const TEST_GROUP: Pubkey = Pubkey::new_from_array([42u8; 32]);

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address_with_program_id(owner, mint, &TOKEN)
}

pub fn ata_with(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address_with_program_id(owner, mint, token_program)
}

pub fn packet_pdas(sender: &Pubkey, id: u64) -> (Pubkey, Pubkey, Pubkey) {
    let packet = Pubkey::find_program_address(&[bao::PACKET_SEED, sender.as_ref(), &id.to_le_bytes()], &bao::ID).0;
    let vault = Pubkey::find_program_address(&[bao::VAULT_SEED, packet.as_ref()], &bao::ID).0;
    let gas = Pubkey::find_program_address(&[bao::GAS_SEED, packet.as_ref()], &bao::ID).0;
    (packet, vault, gas)
}

pub fn claim_pda(packet: &Pubkey, device_key: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[bao::CLAIM_SEED, packet.as_ref(), device_key.as_ref()], &bao::ID).0
}

pub fn crown_pda(packet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[bao::CROWN_SEED, packet.as_ref()], &bao::ID).0
}

/// Classic SPL mint (82 bytes) laid out by hand.
fn spl_mint_bytes(authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[44] = decimals;
    d[45] = 1;
    d
}

/// Classic SPL token account (165 bytes) laid out by hand.
fn spl_account_bytes(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

impl Harness {
    /// Config initialized by the upgrade authority: test genesis group, 1% fee, 10_000 lamport crank reward.
    pub fn ready() -> Self {
        let mut h = Self::new();
        let admin = h.admin();
        h.set_upgrade_authority(&admin.pubkey());
        h.send(&[Self::init_config_ix(&admin.pubkey(), TEST_GROUP, 100)], &admin).unwrap();
        h
    }

    fn put(&mut self, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(key, Account { lamports, data, owner, executable: false, rent_epoch: 0 })
            .unwrap();
    }

    /// Classic SPL mint; also creates the admin (treasury) ATA so fees have a destination.
    pub fn make_spl_mint(&mut self, decimals: u8) -> Pubkey {
        let mint = Pubkey::new_unique();
        let authority = self.admin.pubkey();
        self.put(mint, TOKEN, spl_mint_bytes(&authority, decimals));
        self.fund_tokens(&mint, &authority, 0);
        mint
    }

    /// Sets the owner ATA balance to `amount`, creating the ATA if needed.
    pub fn fund_tokens(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Pubkey {
        let a = ata(owner, mint);
        self.put(a, TOKEN, spl_account_bytes(mint, owner, amount));
        a
    }

    /// Token-2022 mint carrying a transfer fee: the program must refuse it.
    pub fn make_t22_mint_with_transfer_fee(&mut self, decimals: u8) -> Pubkey {
        let mint = Pubkey::new_unique();
        let space = ExtensionType::try_calculate_account_len::<T22Mint>(&[ExtensionType::TransferFeeConfig]).unwrap();
        let mut data = vec![0u8; space];
        {
            let mut s = StateWithExtensionsMut::<T22Mint>::unpack_uninitialized(&mut data).unwrap();
            let fee = s.init_extension::<TransferFeeConfig>(true).unwrap();
            fee.newer_transfer_fee.transfer_fee_basis_points = 100u16.into();
            s.base.decimals = decimals;
            s.base.is_initialized = true;
            s.pack_base();
            s.init_account_type().unwrap();
        }
        self.put(mint, TOKEN_2022, data);
        let treasury = self.admin.pubkey();
        self.fund_t22_tokens(&mint, &treasury, 0);
        mint
    }

    pub fn fund_t22_tokens(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Pubkey {
        let a = ata_with(owner, mint, &TOKEN_2022);
        let space = ExtensionType::try_calculate_account_len::<T22Account>(&[ExtensionType::TransferFeeAmount]).unwrap();
        let mut data = vec![0u8; space];
        {
            let mut s = StateWithExtensionsMut::<T22Account>::unpack_uninitialized(&mut data).unwrap();
            s.init_extension::<TransferFeeAmount>(true).unwrap();
            s.base.mint = mint.to_bytes().into();
            s.base.owner = owner.to_bytes().into();
            s.base.amount = amount;
            s.base.state = AccountState::Initialized;
            s.pack_base();
            s.init_account_type().unwrap();
        }
        self.put(a, TOKEN_2022, data);
        a
    }

    /// Token amount of a token account of either program (offset 64).
    pub fn token_balance(&self, key: &Pubkey) -> u64 {
        let acc = self.svm.get_account(key).expect("token account missing");
        u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
    }

    pub fn token_balance_or_zero(&self, key: &Pubkey) -> u64 {
        match self.svm.get_account(key) {
            Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
            _ => 0,
        }
    }

    /// A mint shaped like a Seeker Genesis Token (member of `group`, metadata pointer = `metadata`)
    /// held by `owner` in a Token-2022 account.
    pub fn make_member_mint(&mut self, group: &Pubkey, metadata: &Pubkey, owner: &Pubkey) -> (Pubkey, Pubkey) {
        let mint = Pubkey::new_unique();
        let space = ExtensionType::try_calculate_account_len::<T22Mint>(&[
            ExtensionType::MetadataPointer,
            ExtensionType::TokenGroupMember,
        ])
        .unwrap();
        let mut data = vec![0u8; space];
        {
            let mut s = StateWithExtensionsMut::<T22Mint>::unpack_uninitialized(&mut data).unwrap();
            let mp = s.init_extension::<MetadataPointer>(true).unwrap();
            mp.metadata_address = OptionalNonZeroPubkey::try_from(Some(metadata.to_bytes().into())).unwrap();
            let m = s.init_extension::<TokenGroupMember>(true).unwrap();
            m.mint = mint.to_bytes().into();
            m.group = group.to_bytes().into();
            m.member_number = 1u64.into();
            s.base.decimals = 0;
            s.base.supply = 1;
            s.base.is_initialized = true;
            s.pack_base();
            s.init_account_type().unwrap();
        }
        self.put(mint, TOKEN_2022, data);
        let ta = Pubkey::new_unique();
        let tspace = ExtensionType::try_calculate_account_len::<T22Account>(&[]).unwrap();
        let mut tdata = vec![0u8; tspace];
        {
            let mut s = StateWithExtensionsMut::<T22Account>::unpack_uninitialized(&mut tdata).unwrap();
            s.base.mint = mint.to_bytes().into();
            s.base.owner = owner.to_bytes().into();
            s.base.amount = 1;
            s.base.state = AccountState::Initialized;
            s.pack_base();
            s.init_account_type().unwrap();
        }
        self.put(ta, TOKEN_2022, tdata);
        (mint, ta)
    }

    pub fn make_sgt(&mut self, group: &Pubkey, owner: &Pubkey) -> (Pubkey, Pubkey) {
        self.make_member_mint(group, group, owner)
    }

    /// Moves a Token-2022 token account to a new owner, as when the genesis token moves between wallets of one person.
    pub fn move_t22_token(&mut self, token_account: &Pubkey, new_owner: &Pubkey) {
        let mut acc: Account = self.svm.get_account(token_account).unwrap();
        acc.data[32..64].copy_from_slice(new_owner.as_ref());
        self.svm.set_account(*token_account, acc).unwrap();
    }

    pub fn warp_seconds(&mut self, secs: i64) {
        let mut clock: anchor_lang::prelude::Clock = self.svm.get_sysvar();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    pub fn warp_slots(&mut self, slots: u64) {
        let clock: anchor_lang::prelude::Clock = self.svm.get_sysvar();
        self.svm.warp_to_slot(clock.slot + slots);
    }
}

pub fn create_args(id: u64, total: u64, shares: u16, mode: SplitMode, audience: Audience, seeker_only: bool) -> bao::CreatePacketArgs {
    bao::CreatePacketArgs { id, total, shares, mode, audience, seeker_only, expires_in: 86_400, message_hash: [7u8; 32] }
}

/// `create_packet` for a classic SPL mint. `parent_crown` continues a Luck-King chain.
pub fn create_packet_ix(h: &Harness, sender: &Pubkey, mint: &Pubkey, args: bao::CreatePacketArgs, parent_crown: Option<Pubkey>) -> Instruction {
    create_packet_ix_with(h, sender, mint, &TOKEN, args, parent_crown)
}

pub fn create_packet_ix_with(
    h: &Harness,
    sender: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
    args: bao::CreatePacketArgs,
    parent_crown: Option<Pubkey>,
) -> Instruction {
    let (packet, vault, gas) = packet_pdas(sender, args.id);
    let crown_refund = parent_crown.and_then(|c| {
        h.svm.get_account(&c).filter(|a| a.lamports > 0).map(|_| {
            let crown: bao::state::Crown = h.account(&c);
            crown.refund_to
        })
    });
    Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::CreatePacket { args }.data(),
        bao::accounts::CreatePacket {
            sender: *sender,
            config: Harness::config_pda(),
            packet,
            mint: *mint,
            sender_token: ata_with(sender, mint, token_program),
            vault,
            gas_tank: gas,
            treasury_token: Some(ata_with(&h.admin.pubkey(), mint, token_program)),
            parent_crown,
            parent_crown_refund: crown_refund.or(parent_crown.map(|_| *sender)),
            token_program: *token_program,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
    )
}

// ---------------------------------------------------------------------------
// Grabs
// ---------------------------------------------------------------------------

/// Circle snapshot: Merkle root and one proof per member, same algorithm as the program.
pub fn merkle_tree(members: &[Pubkey]) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
    let mut level: Vec<[u8; 32]> = members.iter().map(bao::audience::merkle_leaf).collect();
    let mut proofs: Vec<Vec<[u8; 32]>> = vec![vec![]; members.len()];
    let mut pos: Vec<usize> = (0..members.len()).collect();
    while level.len() > 1 {
        let next: Vec<[u8; 32]> = level
            .chunks(2)
            .map(|p| if p.len() == 2 { bao::audience::hash_pair(&p[0], &p[1]) } else { p[0] })
            .collect();
        for (i, p) in pos.iter_mut().enumerate() {
            let sib = *p ^ 1;
            if sib < level.len() {
                proofs[i].push(level[sib]);
            }
            *p /= 2;
        }
        level = next;
    }
    (level[0], proofs)
}

pub fn grab_args(device_key: Pubkey, proof: Vec<[u8; 32]>, code: Option<Vec<u8>>) -> bao::GrabArgs {
    bao::GrabArgs { device_key, proof, code }
}

/// `grab_equal` for a classic SPL packet. `sgt` = (genesis mint, genesis token account).
pub fn grab_equal_ix(
    claimer: &Pubkey,
    packet: &Pubkey,
    mint: &Pubkey,
    args: bao::GrabArgs,
    sgt: Option<(Pubkey, Pubkey)>,
) -> Instruction {
    let vault = Pubkey::find_program_address(&[bao::VAULT_SEED, packet.as_ref()], &bao::ID).0;
    let gas = Pubkey::find_program_address(&[bao::GAS_SEED, packet.as_ref()], &bao::ID).0;
    Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::GrabEqual { args: args.clone() }.data(),
        bao::accounts::GrabEqual {
            claimer: *claimer,
            config: Harness::config_pda(),
            packet: *packet,
            mint: *mint,
            vault,
            gas_tank: gas,
            claim: claim_pda(packet, &args.device_key),
            claimer_token: ata(claimer, mint),
            sgt_mint: sgt.map(|s| s.0),
            sgt_token: sgt.map(|s| s.1),
            token_program: TOKEN,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
    )
}

pub const VRF_PROGRAM: Pubkey = anchor_lang::pubkey!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
pub const SLOT_HASHES: Pubkey = anchor_lang::pubkey!("SysvarS1otHashes111111111111111111111111111");

pub fn program_identity() -> Pubkey {
    Pubkey::find_program_address(&[b"identity"], &bao::ID).0
}

/// Scoped identity the VRF program signs callbacks with: PDA([identity, bao], vrf).
pub fn vrf_identity() -> Pubkey {
    Pubkey::find_program_address(&[b"identity", bao::ID.as_ref()], &VRF_PROGRAM).0
}

impl Harness {
    /// Maps a no-op program at the VRF program id and creates the oracle queue account,
    /// so `grab_lucky` request CPIs succeed; tests then deliver callbacks themselves.
    pub fn with_vrf_stub(mut self) -> Self {
        self.svm.add_program(VRF_PROGRAM, noop_bytes()).unwrap();
        self.put(bao::VRF_ORACLE_QUEUE, VRF_PROGRAM, vec![0u8; 64]);
        self
    }

    /// Sends instructions signed by the VRF identity (signature unchecked: sigverify is off).
    pub fn send_as_vrf(&mut self, ixs: &[Instruction]) -> TransactionResult {
        let payer = self.funded();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
        let mut sigs = vec![solana_signature::Signature::default(); msg.header.num_required_signatures as usize];
        sigs[0] = payer.sign_message(&msg.serialize());
        let tx = VersionedTransaction { signatures: sigs, message: VersionedMessage::Legacy(msg) };
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }
}

/// `grab_lucky` for a classic SPL packet.
pub fn grab_lucky_ix(claimer: &Pubkey, packet: &Pubkey, mint: &Pubkey, args: bao::GrabArgs, sgt: Option<(Pubkey, Pubkey)>) -> Instruction {
    let vault = Pubkey::find_program_address(&[bao::VAULT_SEED, packet.as_ref()], &bao::ID).0;
    let gas = Pubkey::find_program_address(&[bao::GAS_SEED, packet.as_ref()], &bao::ID).0;
    Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::GrabLucky { args: args.clone() }.data(),
        bao::accounts::GrabLucky {
            claimer: *claimer,
            config: Harness::config_pda(),
            packet: *packet,
            mint: *mint,
            vault,
            gas_tank: gas,
            claim: claim_pda(packet, &args.device_key),
            claimer_token: ata(claimer, mint),
            crown: crown_pda(packet),
            sgt_mint: sgt.map(|s| s.0),
            sgt_token: sgt.map(|s| s.1),
            token_program: TOKEN,
            associated_token_program: ATA_PROGRAM,
            oracle_queue: bao::VRF_ORACLE_QUEUE,
            program_identity: program_identity(),
            vrf_program: VRF_PROGRAM,
            slot_hashes: SLOT_HASHES,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
    )
}

/// The callback the VRF oracle delivers for one claim.
pub fn vrf_callback_ix(packet: &Pubkey, claim: &Pubkey, mint: &Pubkey, claimer: &Pubkey, randomness: [u8; 32]) -> Instruction {
    let vault = Pubkey::find_program_address(&[bao::VAULT_SEED, packet.as_ref()], &bao::ID).0;
    let gas = Pubkey::find_program_address(&[bao::GAS_SEED, packet.as_ref()], &bao::ID).0;
    Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::VrfCallback { randomness }.data(),
        bao::accounts::VrfCallback {
            vrf_program_identity: vrf_identity(),
            packet: *packet,
            claim: *claim,
            vault,
            mint: *mint,
            gas_tank: gas,
            claimer: *claimer,
            claimer_token: ata(claimer, mint),
            crown: crown_pda(packet),
            config: Harness::config_pda(),
            token_program: TOKEN,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
    )
}

pub fn cancel_stale_ix(caller: &Pubkey, packet: &Pubkey, claim: &Pubkey) -> Instruction {
    let gas = Pubkey::find_program_address(&[bao::GAS_SEED, packet.as_ref()], &bao::ID).0;
    Instruction::new_with_bytes(
        bao::ID,
        &bao::instruction::CancelStale {}.data(),
        bao::accounts::CancelStale { caller: *caller, packet: *packet, claim: *claim, gas_tank: gas }.to_account_metas(None),
    )
}

/// Asserts that the transaction failed with the given program error.
pub fn assert_err(res: TransactionResult, code: bao::error::BaoError) {
    let failed = match res {
        Ok(meta) => panic!("expected {:?}, but the transaction succeeded\n{}", code, meta.pretty_logs()),
        Err(e) => e,
    };
    let want = 6000 + code as u32;
    let rendered = format!("{:?}", failed.err);
    assert!(
        rendered.contains(&format!("Custom({want})")),
        "expected {:?} (Custom({want})), got {rendered}\n{}",
        code,
        failed.meta.pretty_logs()
    );
}
