# Reviewing Bao in five minutes

The three-minute demo: https://youtu.be/N1hNVH_5Gmo

## 1. Install (1 minute)

Download [`bao-1.0.0.apk`](https://github.com/RaYYeR220/bao/releases/download/v1.0.0/bao-1.0.0.apk) and install it on
any Android phone or emulator that has a Mobile Wallet Adapter wallet (on a Seeker, the built-in Seed Vault wallet).
The app runs on **Solana devnet**.

- Onboarding ends with **Get test tokens**: the Playground faucet sends test SOL, tSKR (the devnet stand-in for SKR)
  and a test Genesis Token, so you can grab and drop without a Seeker.
- Skip it, and every Seeker-only packet refuses you: that is the point.

## 2. Try the three things that matter (3 minutes)

| Try | What you should see |
|---|---|
| Open a packet in the feed and shake three times (or tap the seal) | one wallet signature, then about two seconds later a share drawn by MagicBlock VRF, with links to the grab, the randomness proof and the payout |
| Try the same packet again, or from a second wallet holding the same Genesis Token | refused by the program: `AlreadyGrabbedOnThisDevice` (6016) |
| Send a packet: amount, Lucky or Equal, circle / public / code word, seal | one signature; a link, a QR code and (on a phone with NFC) a tag to hand it out |

Push notifications, the home-screen widget (long-press the home screen, Widgets, Bao) and circles with invite codes
are there too.

## 3. Check that it is real (1 minute)

- [PROOF.md](PROOF.md): every devnet transaction, from the app and from the smoke test, including the on-chain
  refusals (`NotASeeker` 6013, `AlreadyGrabbedOnThisDevice` 6016) and a real mainnet Seeker Genesis Token accepted
  by the same check in a fixture test.
- [THREAT_MODEL.md](THREAT_MODEL.md): device binding, randomness, the griefing attacks closed (each with its test),
  the dependency scan, and what Bao does not claim.
- Tests, from a clone:

  ```bash
  cargo test -p bao                  # 76 program tests in LiteSVM
  pnpm install && pnpm --filter @bao/sdk test && pnpm --filter web test   # 21 + 146
  ```

## Where things live

| Path | What |
|---|---|
| `programs/bao/src/instructions/grab.rs` | the Genesis Token check and the device-bound claim record |
| `programs/bao/src/instructions/vrf_callback.rs` | the share drawn from the VRF proof, the Luck King crown |
| `programs/bao/src/sgt.rs` | Token-2022 group membership verification (seven forgeries tested) |
| `apps/mobile/src/features/bao/data-access/send-with-wallet.ts` | the Mobile Wallet Adapter session: devnet only, signer must be the authorized account |
| `apps/web/src/lib/crank.ts` | payouts, stale-request cancels and refunds, every minute |
