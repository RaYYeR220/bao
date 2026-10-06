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
