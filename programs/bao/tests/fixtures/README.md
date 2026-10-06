# Test fixtures

- `noop.so` — the SPL Noop program (`noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV`), dumped from mainnet with
  `solana program dump`. Tests map it at the MagicBlock VRF program id so `grab_lucky` request CPIs succeed;
  callbacks are then delivered by the tests themselves.
- `sgt_mainnet_mint.bin` — the raw account data of a real Seeker Genesis Token mint on mainnet
  (`5mXbkqKz883aufhAsx3p5Z1NcvD2ppZbdTTznM6oUKLj`, a member of the Seeker Genesis group
  `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te`), fetched with `solana account <mint> -u mainnet-beta`.
  `test_mainnet_genesis.rs` proves the on-chain check accepts the real layout.
