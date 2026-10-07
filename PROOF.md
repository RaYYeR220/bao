# Proof

Everything below is a public devnet transaction or account you can open in the explorer. Bao runs on
**devnet** for now: the mainnet launch follows the dApp Store release.

## Deployment

| What | Address |
|---|---|
| Program | [`DifXuyhEu3r7sgXQjgCokyikQFcYCYD2cwhjNyU7j6XR`](https://explorer.solana.com/address/DifXuyhEu3r7sgXQjgCokyikQFcYCYD2cwhjNyU7j6XR?cluster=devnet) |
| Config | [`JCtfrDrv2ha714adGaRDQMj92txd24nucXWw7bA5FWTA`](https://explorer.solana.com/address/JCtfrDrv2ha714adGaRDQMj92txd24nucXWw7bA5FWTA?cluster=devnet) |
| Test Genesis group (devnet stand-in for the Seeker Genesis collection) | [`BuRJQxYkL43H3MmgmZmRuC1GCDFc1hSkEu2t1mxiDgwK`](https://explorer.solana.com/address/BuRJQxYkL43H3MmgmZmRuC1GCDFc1hSkEu2t1mxiDgwK?cluster=devnet) |
| tSKR (devnet stand-in for SKR, 6 decimals) | [`aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr`](https://explorer.solana.com/address/aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr?cluster=devnet) |
| MagicBlock VRF program | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`, base-layer queue `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` |

## One packet, end to end

From `scripts/devnet/src/smoke.ts` (run it yourself: `pnpm --filter @bao/devnet-scripts smoke`).
Recorded in [`scripts/devnet/out/smoke-2026-10-06T20-14-40-518Z.json`](scripts/devnet/out/smoke-2026-10-06T20-14-40-518Z.json).

| Step | Transaction |
|---|---|
| A sender drops a Lucky, Seeker-only packet of 10 tSKR | [create_packet](https://explorer.solana.com/tx/3KL3pjvmZPt2NveZyQxNCVtTf72dbqMdK3wdcEvfry6pZAgeDCtDCmGKponA4DwviPjmi9BjuifShrhXUEN6fnoZ?cluster=devnet) |
| A wallet holding a Genesis token grabs: its place is reserved and randomness requested | [grab_lucky](https://explorer.solana.com/tx/i2wFEXCet8MNG6GLxpShLTkPXjEpPoNhUpxo4aVQETmvS7Vwm1ckrwC64X1Y49si7c6yiUQs28U21MaoZYAnfyA?cluster=devnet) |
| 2.3 s later the VRF oracle delivers a proven random value; the program assigns 4.391318 tSKR | [vrf_callback](https://explorer.solana.com/tx/4ZoxoK1p88Q42Uh98JXNXs4mkTJXXhGcXdz8j4m6qLqsrErTP3AQQB5poB9jjh7zg3fVPAHhr4SJA8yXBeCCQ3wb?cluster=devnet) |
| The share is paid out to the grabber | [payout](https://explorer.solana.com/tx/QJ2rPwPYnQLog9ypjnigzSMAN3YNvRdys6icuEurRRDfSjk7yEVDsfPKK3RfjLfQJod8WTc2cKEPxHcYNfcAPNS?cluster=devnet) |

## From the app

The same flow, driven from the Android app on an emulator with a Mobile Wallet Adapter wallet, against the live
API at https://getbao.vercel.app. A Lucky, Seeker-only public packet of 88 tSKR
([`7TX5gMks…TkkQs`](https://explorer.solana.com/address/7TX5gMks2Mb6fCLWCYqo1QbXXNXU5Qx9XH5E2k4TkkQs?cluster=devnet)):

| Step | Transaction |
|---|---|
| Sealed in the Send flow with one wallet signature | [create_packet](https://explorer.solana.com/tx/2hUTQuzqY9zDseKuaBAp2MMfVRirpDxUaczD6gUhtB5ik4etNKJMxoqDXCJE4bhaKso3np5wN1i7b2hSEroUQDxQ?cluster=devnet) |
| Three shakes, then one signature | [grab_lucky](https://explorer.solana.com/tx/3GdtBKYNSvU8juqGCTJ5Q9W79xc5Hn8tT4E1GwMKzbkMuqa9ENew6Jc5Yod9QMzeTYtTNNsPoMXfNnSWFrDaZ58K?cluster=devnet) |
| The randomness proof lands and the share is drawn | [vrf_callback](https://explorer.solana.com/tx/3bwUMeRdFdrDGgdiSwpTU3RG771wRQceZezGfsB4gNM8QxVFxc2QYa3zoWB4CXJaTqtasCbS2b6hp9xSASByp2mG?cluster=devnet) |
| The crank pays 48.78 tSKR; the grabber is Luck King so far | [payout](https://explorer.solana.com/tx/33izjfFWSC1W2dUe59wNYwiJAD1G9mtePbs6VDaZKYgrwv7xsWBH5K5rFxrCcjBPPa2Jjw3E2mdDQGDmppfvKpM?cluster=devnet) |
| A Luck King sends the next packet in the chain ([`F35rWsgt…Ag1U6`](https://explorer.solana.com/address/F35rWsgtqxEzkLiDq8GnjHrdMwP8gdE7ytT4oRqAg1U6?cluster=devnet), chain depth 1) | [create_packet with crown](https://explorer.solana.com/tx/4eyHPPvEGH1CNe44hEbAyniVUGhgA2QEXuVsLaau42sQm5NALdPRPFZ4EJJtWWGSDXeVZLFz6nArrFCSBSQtur1v?cluster=devnet) |

The app simulates every grab before it opens the wallet, so a grab the program would refuse (wrong code word,
no Genesis Token, second wallet on the same phone) is stopped with the program's own error code and never costs
a fee. The on-chain refusals below were sent on purpose by the smoke script to show the program enforces it.

## Refusals (the part bots meet)

| Attempt | Result |
|---|---|
| A wallet with no Seeker Genesis Token tries to grab | [refused on-chain](https://explorer.solana.com/tx/5p1KGbsMX1FJoqRhcoNoocq3aspt9PfpM8ttuDGs6uemNj9HWusJLsdqEBzFHjXgK2cvvPAJs8qpBgPTotaoKEr5?cluster=devnet) with `NotASeeker` (error 6013) |
| The same Genesis token is [moved to a second wallet](https://explorer.solana.com/tx/2L5BJpxTgA5aRXpZDmiiwfuUML5A9i4336vpJGvXKwDs4vmkmQzSG2yG8Jur9LHTBikeiRbmeEXrCoCJT8SRyKSr?cluster=devnet), which tries again | [refused on-chain](https://explorer.solana.com/tx/4zd1bxFH6k9LAsLo2mtTp7aHMAnv614WNPMs7cbHQcDyt5zfpfZsFutTRHWZX2rNyY5MUYyrXi5BrdxJWpe7z9hk?cluster=devnet) with `AlreadyGrabbedOnThisDevice` (error 6016) |

## Real Seeker Genesis Tokens

The devnet program checks a test group so anyone can try Bao without a Seeker. The check itself is proven
against real mainnet data: `programs/bao/tests/test_mainnet_genesis.rs` loads the account of a real Seeker
Genesis Token mint ([`5mXbkqKz…6oUKLj`](https://explorer.solana.com/address/5mXbkqKz883aufhAsx3p5Z1NcvD2ppZbdTTznM6oUKLj),
member of the Seeker Genesis group `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te`) byte for byte, and shows that
a packet configured for the real group accepts it while a packet configured for any other group refuses it.

## Tests

`cargo test -p bao` runs 76 tests against the compiled program in LiteSVM:

| Suite | Tests | Covers |
|---|---|---|
| unit (`src/`) | 17 | share math (property tests: every split sums exactly to the deposit, no share is ever 0), Genesis token verification (7 forgeries), Merkle and code-word checks |
| `test_config` | 4 | only the upgrade authority can initialize; fee ceiling; pause |
| `test_create` | 6 | deposits, protocol fee, bounds, hostile mints, pause |
| `test_grab` | 12 | device binding (same token from a second wallet, someone else's token, fake group, wrong metadata pointer), circles, code words, sold out, expiry |
| `test_lucky` | 13 | VRF reservation, callbacks out of order, forged callbacks, stale requests, payout |
| `test_close` | 6 | refunds, crank reward, Luck-King crowns and chains |
| `test_mainnet_genesis` | 2 | a real mainnet Seeker Genesis Token mint passes for the real group and fails for another |
| `test_hardening` | 16 | pre-funded PDA griefing, self-sabotaged payouts, config changes that must not reach live packets, every denied Token-2022 extension, a full Token-2022 life cycle, scheduled rains |

`pnpm --filter @bao/sdk test` runs the TypeScript SDK tests, including a vector pinned on both sides so the
app computes exactly the same shares as the program.
