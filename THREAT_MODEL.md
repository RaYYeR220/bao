# Threat model

What Bao protects, against whom, and what it deliberately does not claim.

## Assets

- Tokens deposited in a packet vault (owned by the packet PDA).
- Lamports in a packet's GasTank (a system-owned PDA the sender pre-funds; it pays every rent and fee a
  grab needs, so grabbers pay only the network signature fee).
- Fairness of a Lucky split, and the promise "one Seeker, one grab".

## Actors

| Actor | Can | Cannot |
|---|---|---|
| Sender | create packets, continue a chain if they hold its Crown | take a packet back before it expires, see future Lucky shares |
| Grabber | grab once per device per packet | grab twice with one Seeker Genesis Token, choose or predict their share |
| Bot farm | create unlimited wallets | obtain Seeker Genesis Tokens: they are minted once per Seeker device |
| Anyone (crank) | pay out won shares, cancel stale requests, close expired packets | redirect any funds: every destination is pinned by the program |
| Admin (config) | pause new packets and grabs, change the fee and genesis group for future packets | touch vaults or GasTanks; change the group or crank reward of a live packet (both are copied into the packet at creation); pause payouts, cancels or closing |
| VRF oracle | deliver randomness late or not at all | forge it (the proof is verified on-chain by the VRF program) or call back as anyone else (the callback must be signed by the per-program VRF identity) |

## Device binding

A grab on a Seeker-only packet must present a Token-2022 account that:

1. is owned by the grabber and holds exactly 1 token,
2. whose mint has 0 decimals and supply 1,
3. whose mint carries a `TokenGroupMember` extension with `group == packet.sgt_group` and `mint == itself`,
4. and a `MetadataPointer` equal to the group address.

The claim record address is derived from the **Genesis mint**, not the wallet. Moving the token to another
wallet does not allow a second grab (`AlreadyGrabbedOnThisDevice`, proven on devnet in [PROOF.md](PROOF.md)).
A `TokenGroupMember` cannot be added to a mint without the group's update authority, so a forged
"genesis" mint fails check 3.

## Randomness

Each Lucky grab requests its own MagicBlock VRF value. The caller seed is derived by the program
(`sha256(packet ‖ index ‖ device ‖ slot)`), the callback is verified, and it must echo the slot of the
request it answers, so a late answer to a cancelled request cannot settle a newer one.

The callback only assigns the share; tokens move in a separate permissionless `payout`. A grabber therefore
cannot make the callback fail (for example by breaking their own token account) to retry until they like the
result: a failed payout leaves the assigned amount unchanged.

**Residual:** the order in which callbacks land changes individual amounts (each draws from what is left).
Whoever orders transactions in a block (a leader, or the oracle by delaying) could pick between orderings.
The sum is always exact and no one can choose their own randomness; this is an accepted limit for gifting.

## Griefing that was closed

| Attack | Defence | Test |
|---|---|---|
| Send lamports to a future Crown or claim address so `create_account` fails forever | addresses that already hold lamports are topped up, allocated and assigned (like Anchor `init`) | `prefunded_crown_*`, `prefunded_claim_address_*` |
| Break your own token account so the VRF callback fails, then cancel and re-request at the sender's expense | callback cannot fail on claimer-controlled accounts; a won share cannot be cancelled | `sabotaged_token_account_cannot_break_the_callback_or_drain_the_tank` |
| Admin raises the crank reward to sweep GasTanks | reward copied into the packet at creation | `raising_the_crank_reward_later_does_not_drain_a_live_packet` |
| Admin switches the genesis group to one they control | group copied into the packet at creation | `switching_the_genesis_group_does_not_open_live_packets_to_other_tokens` |
| Fee raised between signing and landing | sender passes `max_fee_bps` | `sender_fee_ceiling_is_enforced` |
| Mints that skim, freeze or claw back (transfer fee, hook, permanent delegate, default-frozen, pausable, non-transferable, confidential) | rejected before the vault is created | `every_denied_token2022_extension_is_rejected` |

## Not claimed

- **Devnet.** The deployed program checks a devnet test group whose tokens anyone can get from the in-app
  faucet, so devnet itself is not sybil-resistant; the check is the same code that points at the real Seeker
  Genesis group on mainnet.
- **Upgradeable program.** The upgrade authority could change the code. It will be handed to a multisig, then
  frozen, after the mainnet release.
- **Code words are not secrets.** The code travels in the first grab and its hash is public, so it is a ritual
  for a group chat, not access control.
- **Mint freeze authorities.** A sender who picks a mint whose freeze authority later freezes the vault locks
  their own packet; Bao does not restrict which classic SPL mints can be used.
- **Liveness of the oracle.** If MagicBlock stops answering, Lucky grabs stay pending and can be cancelled after
  300 slots; nothing is paid without a proof.

## Dependency scan

`gitleaks` over the full git history finds no secrets. `osv-scanner` over `Cargo.lock`, `pnpm-lock.yaml`
and `apps/mobile/package-lock.json` reports the advisories below; none has a fix Bao can apply without
forking Anchor or the MagicBlock SDK, and none is reachable from the program's own code.

| Crate | Advisory | Pulled in by | Why it does not bite |
|---|---|---|---|
| `bincode 1.3.3` | RUSTSEC-2025-0141, unmaintained | `anchor-lang` | no known vulnerability; Bao never decodes bincode from user input |
| `borsh 0.10.4` | GHSA-fjx5-qpf4-xjf2, ZST parsing unsound | `magicblock-delegation-program-api` | Bao uses Anchor's borsh 1.x; no zero-sized types are deserialized |
| `rkyv 0.7.46` | RUSTSEC-2026-0235, Rc/Arc archive validation | `magicblock-delegation-program-api` | delegation code path, not used by the VRF calls Bao makes |
| `libsecp256k1 0.6.0` | RUSTSEC-2025-0161, unmaintained | `solana-program 2.3` (MagicBlock SDK) | compiled for off-chain targets only |
| `rand 0.7.3` | RUSTSEC-2026-0097, unsound with a custom logger | `solana-program 2.3` (MagicBlock SDK) | off-chain only; on-chain randomness comes from the VRF proof |
| `ansi_term`, `derivative`, `paste` | unmaintained | test and build tooling | not in the program's dependency graph |
| `braces 3.0.3` (npm) | GHSA-vfj7-8cjw-p6xm | Metro's file map | build time only, never shipped in the app; no patched release exists |
| `node-forge 1.4.0` (npm) | GHSA-86w9-cpqp-85rv | `@expo/cli` | dev-server certificates only; no patched release exists |
| `decode-uri-component 0.2.2` (npm) | GHSA-vcc3-ghjq-m6fr | expo-router's `query-string` | the fixed release is ESM-only and breaks the router; the app strips query strings from outside links before routing |

Fixed rather than documented: `vitest`, `tinypool` and `@vitest/mocker` (upgraded to vitest 4) and `uuid` under the
Expo build tooling (overridden to 11.1.1). The pnpm workspace refuses packages younger than a week, transitive
dependencies from git or tarball URLs, and provenance downgrades.
