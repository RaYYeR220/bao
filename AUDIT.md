# The automated audit, finding by finding

The hackathon's security audit ran on commit `dc2d4cc` and reported 94 findings: 13 high, 56 medium, 21 low and
4 informational. Every one is marked "needs review" by the tool, most with low confidence. This page goes through
each class and says what the code actually does at the reported lines. No finding led to a change in the program;
the reasons are below, with the line or the test that settles it.

## High

| Finding | Reported at | What the code does |
|---|---|---|
| Account data matching: a mint is unpacked "without verifying authorization" | `mint_safety.rs:31` | The owner is checked on the lines just above: a classic SPL mint returns early, anything else must be owned by Token-2022 (`require_keys_eq!(*mint.owner, token_2022::ID)`), and only then is the extension list read. Covered by `every_denied_token2022_extension_is_rejected`. |
| Writable `UncheckedAccount` with no constraint (six places) | `grab.rs:233`, `grab.rs:251`, `close.rs:75`, `payout.rs:36` | These four do carry an `address =` constraint; it is written on several lines and the tool did not read it. `claimer_token` and `sender_token` are pinned to the associated token address of the claimer or sender, and `oracle_queue` is pinned to the MagicBlock queue constant. |
| | `grab.rs:111` | `claimer_token` in `grab_equal` is handed to the Associated Token program's idempotent create for (claimer, mint), which fails unless the address is that exact associated token account. Tokens are transferred only after that call. |
| | `create_packet.rs:62` | `parent_crown_refund` is compared in the handler with `crown.refund_to`, the address stored when the crown was created (`require_keys_eq!`), before the crown is closed to it. |
| Random authority generation (seven places) | `audience.rs:54`, `sgt.rs:61`, five test files | All seven are `Pubkey::new_unique()` inside `#[cfg(test)]` modules and the LiteSVM test harness. No program instruction creates a key. |
| Type cosplay: an account deserialized without a discriminator | `sgt.rs:17`, `mint_safety.rs:30` | These read SPL Token-2022 accounts, which have no Anchor discriminator by design. Both check the owner program first, then the mint, the amount, the group member and the metadata pointer. Seven forgeries are tested in `src/sgt.rs`, and `test_mainnet_genesis.rs` runs the check on a real mainnet token. |
| | `grab.rs:83`, `vrf_callback.rs:109` | These lines write, not read: they serialize a `ClaimRecord` or a `Crown` (with its Anchor discriminator) into a PDA the program has just created at seeds it derived. |
| PDA sharing | `gas.rs:79` | The gas tank is one PDA per packet (`["gas", packet]`) and signs only system transfers out of itself. Nothing else is derived from those seeds. |

## Medium

| Finding | What the code does |
|---|---|
| Unchecked arithmetic (35 places, 13 of them in tests) | The workspace builds with `overflow-checks = true` in the release profile (`Cargo.toml`), so an overflow aborts the transaction and never wraps. Share math is done in `u128` and is property-tested: every split sums exactly to the deposit and no share is zero. |
| Stale data after a CPI (`grab.rs:195`, `payout.rs:88`) | The CPI is a token transfer. The token program cannot write to the `Packet` account, which this program owns, so there is nothing to reload. |
| Token-2022 transfer with no post-transfer balance read; close with no withheld-fee handling | A mint with the transfer-fee extension is refused before a packet can be created, together with transfer hooks, permanent delegates, default-frozen, pausable, non-transferable and confidential mints (`mint_safety.rs`). The amount that arrives is the amount sent. |
| A hardcoded `http://` endpoint (three places) | All three are the SVG namespace string `http://www.w3.org/2000/svg`. Nothing is fetched from it. |
| Preflight switched off on send (`send-with-wallet.ts:212`) | Deliberate. The app runs the identical instructions through `simulateTransaction` a moment earlier and shows the program's refusal if there is one; the wallet's own preflight reads older state and rejected transactions that depended on accounts created seconds before. The other place is a devnet script. |
| A deep link handler that does not check the link (`bootstrap.tsx:29`) | The link goes through `parseBaoLink` first (`features/bao/links.ts`): Bao scheme or Bao host only, a base58 address that decodes to 32 bytes, query strings dropped. Anything else is ignored. |
| A server-side fetch of a URL built from request data (`packages/sdk/src/api.ts:192`) | This is the API client that the app runs. The base URL is a build-time constant and the path comes from a fixed table of endpoints. |
| Nine dependency advisories | The same ones listed in [THREAT_MODEL.md](THREAT_MODEL.md#dependency-scan), with the crate that pulls each one in and why it does not reach the program's code. |

## Low

| Finding | What the code does |
|---|---|
| CPI target "unresolved" (eleven places) | Every target is a typed Anchor account: `Program<'info, System>`, `Program<'info, AssociatedToken>`, or `Interface<'info, TokenInterface>` constrained to the packet's stored `token_program`. Anchor checks the program id when the instruction is deserialized. |
| Missing owner check (`cancel_stale.rs:7`, `config.rs:5`, `payout.rs:12`) | The accounts are `Account<'info, T>` types, for which Anchor checks the owner and the discriminator. |
| Missing signer check (`vrf_callback.rs:11`) | The `#[vrf_callback]` macro from the MagicBlock SDK adds the VRF program identity as a required signer. `callback_not_signed_by_the_vrf_identity_is_refused` sends a forged callback and expects the refusal. |

## What the audit could not cover

The report says not every check finished and gives no overall score. It also reads source without expanding macros
or following multi-line attributes, which is where most of the high findings come from. An external review before
mainnet is still the first step in [MAINNET.md](MAINNET.md).
