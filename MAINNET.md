# From devnet to mainnet

Bao as submitted runs on Solana devnet. This page says what changes for mainnet, what does not, and in which order.

## What does not change

- **The program.** It has no devnet-specific code. The Genesis group, the protocol fee, the treasury and the crank
  reward live in the `Config` account, written once by the upgrade authority with `init_config`. Packets copy the
  group and the reward when they are created, so a later config change cannot reach a live packet.
- **The Genesis check.** `programs/bao/tests/test_mainnet_genesis.rs` loads a real mainnet Seeker Genesis Token mint
  byte for byte and shows a packet configured for the real group
  (`GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te`) accepts it, and a packet configured for any other group refuses it.
- **The SDK, the API and the app code paths.** They take the program id, the group and the mint from configuration.

## What changes

| | Devnet (submitted) | Mainnet |
|---|---|---|
| Genesis group in `Config` | a test group anyone can join through the faucet | the real Seeker Genesis group `GT22s89n…f99Te` |
| Packet token | tSKR, a stand-in mint with 6 decimals | SKR `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` |
| Playground faucet | test SOL, tSKR, test Genesis Token | removed |
| House rain | the faucet key mints tSKR and drops packets | funded from the treasury's fee income, or switched off |
| Randomness | MagicBlock VRF devnet queue | MagicBlock VRF mainnet queue |
| Upgrade authority | one key | a multisig, then frozen |
| RPC | devnet through the Bao proxy, public endpoint as fallback | mainnet through the same proxy |

## Order of work

1. **Review.** An external audit of `programs/bao` before real value moves. The threat model and the 76 tests
   (16 of them adversarial) are the starting point, not a substitute.
2. **Seeker hardware pass.** Run the release APK on a Seeker: Seed Vault signing through Mobile Wallet Adapter,
   the Genesis lookup against the real group, shake, widget, push, and writing a packet to an NFC tag. None of this
   has been tried on a Seeker yet; the build was tested on a Samsung Galaxy A52 with Phantom and on an emulator.
3. **Deploy.** A verifiable build of the program, deployed to mainnet (about 3.4 SOL of rent for the current
   binary), then `init_config` with the real Genesis group, a fee of 100 bps, the treasury and the crank reward.
4. **Hand over the upgrade authority** to a multisig. Freeze the program once the first weeks pass without a fix.
5. **Point the stack at mainnet.** API environment (RPC, program id, crank key with a small SOL balance, no faucet
   keys), app configuration (cluster `solana:mainnet`, SKR mint, real group), and the App Links fingerprint stays
   the one the release key already has.
6. **Publish to the Solana dApp Store** with the same signed APK lineage (`app.getbao`, the certificate in
   `/.well-known/assetlinks.json`).
7. **Open it to Seeker owners in stages**: one circle of testers with small SKR amounts first, public rains after.

## What is still unknown

- How Seed Vault behaves with Bao's sign-in and one-signature flows on a real Seeker. Wallets on the older adapter
  protocol needed a fallback for sign-in (found and fixed with Phantom); a Seeker may surface something similar.
- Oracle cost and latency on mainnet. On devnet a proof lands in 2.2 to 2.7 seconds and each request is paid from
  the packet's own gas tank.
- Whether people keep sending packets when the tokens are real. Every number in this repository so far comes from
  the builder's own test runs.
