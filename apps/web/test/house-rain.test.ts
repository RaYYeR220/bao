import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getTransactionSize,
  getTransactionSizeLimit,
  none,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from '@solana/kit';
import { AccountState, TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getTokenEncoder } from '@solana-program/token';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BAO_PROGRAM_ADDRESS,
  CREATE_PACKET_DISCRIMINATOR,
  SplitMode,
  findConfigPda,
  getConfigEncoder,
  getCreatePacketInstructionDataDecoder,
  getPacketEncoder,
  messageHash,
} from '@bao/sdk';
import { runCrank } from '@/lib/crank';
import type { Store } from '@/lib/db';
import { HOUSE_MESSAGE, dropCostLamports, runHouseRain, type HouseRainConfig, type HouseRainDeps } from '@/lib/house-rain';
import { feed } from '@/lib/packets';
import { pushPacketDropped, setPushTransport, type PushMessage } from '@/lib/push';
import { base64Account, fakeRpc, packetBytes } from './fake-rpc';
import { A, freshStore, mirror, wipe } from './helpers';

const NOW = 1_800_000_000;
const TREASURY = address(A.alice);
const CFG: HouseRainConfig = {
  enabled: true,
  minLive: 2,
  total: 88_000_000n,
  shares: 24,
  everySecs: 30 * 60,
  minSolLamports: 500_000_000n,
  mint: address(A.mint),
};
/** 88 tSKR plus the 1% fee on open packets. */
const NEEDED = 88_880_000n;

let store: Store;
let faucet: KeyPairSigner;
let configPda: Address;
let faucetAta: Address;
const seed = new Uint8Array(32).fill(7);

beforeAll(async () => {
  store = await freshStore();
  faucet = await createKeyPairSignerFromPrivateKeyBytes(seed);
  [configPda] = await findConfigPda();
  [faucetAta] = await findAssociatedTokenPda({ owner: faucet.address, mint: CFG.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
});
afterAll(() => store.sql.close());
beforeEach(() => wipe(store));
afterEach(() => setPushTransport(undefined));

interface Chain {
  lamports?: bigint;
  tskr?: bigint | null;
  paused?: boolean;
  /** Serve the new packet's account after the drop (otherwise the known fields are mirrored). */
  servePacket?: boolean;
}

function chainRpc(c: Chain = {}) {
  const account = (b64: string) => ({ value: base64Account(b64) });
  let created: { address: string; total: bigint; shares: number; expiresIn: bigint } | null = null;
  const rpc = fakeRpc({
    getMinimumBalanceForRentExemption: (bytes) => (BigInt(bytes as bigint) + 128n) * 6_960n,
    getBalance: () => ({ value: c.lamports ?? 5_000_000_000n }),
    getAccountInfo: (addr) => {
      if (addr === configPda) {
        const config = getConfigEncoder().encode({
          admin: TREASURY,
          sgtGroup: address(A.bob),
          treasury: TREASURY,
          feeBps: 100,
          crankRewardLamports: 10_000n,
          paused: c.paused ?? false,
          bump: 255,
        });
        return account(Buffer.from(config).toString('base64'));
      }
      if (addr === faucetAta) {
        if (c.tskr === null || c.tskr === undefined) return { value: null };
        const token = getTokenEncoder().encode({
          mint: CFG.mint,
          owner: faucet.address,
          amount: c.tskr,
          delegate: null,
          state: AccountState.Initialized,
          isNative: null,
          delegatedAmount: 0n,
          closeAuthority: null,
        });
        return account(Buffer.from(token).toString('base64'));
      }
      if (c.servePacket && created && addr === created.address) {
        const p = getPacketEncoder().encode({
          sender: faucet.address,
          id: 1n,
          mint: CFG.mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
          totalAmount: created.total,
          remainingAmount: created.total,
          totalShares: created.shares,
          reserved: 0,
          resolved: 0,
          openClaims: 0,
          mode: SplitMode.Lucky,
          audience: { __kind: 'Open' },
          seekerOnly: true,
          sgtGroup: address(A.bob),
          crankReward: 10_000n,
          createdAt: BigInt(NOW),
          startsAt: BigInt(NOW),
          expiresAt: BigInt(NOW) + created.expiresIn,
          messageHash: messageHash(HOUSE_MESSAGE),
          parent: none(),
          chainRoot: address(created.address),
          chainDepth: 0,
          luckKing: none(),
          luckKingAmount: 0n,
          crowned: false,
          bump: 255,
          vaultBump: 255,
          gasBump: 255,
        });
        return account(packetBytes(p));
      }
      return { value: null };
    },
  });
  /** Signs the real transaction (dummy blockhash) so signer clashes and size overflows fail here too. */
  const sent: Instruction[][] = [];
  const send = (async (_rpc: unknown, ixs: Instruction[], payer: TransactionSigner) => {
    sent.push(ixs);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(A.p1), lastValidBlockHeight: 0n }, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    expect(getTransactionSize(tx)).toBeLessThanOrEqual(getTransactionSizeLimit(tx));
    const ix = ixs.at(-1)!;
    const args = getCreatePacketInstructionDataDecoder().decode(ix.data!);
    created = { address: ix.accounts![2].address, total: args.total, shares: args.shares, expiresIn: args.expiresIn };
    return `sig${sent.length}`;
  }) as never;
  return { rpc, send, sent };
}

const deps = (c: ReturnType<typeof chainRpc>, over: Partial<HouseRainDeps> = {}): HouseRainDeps => ({
  store,
  rpc: c.rpc,
  faucet,
  authority: faucet,
  config: CFG,
  send: c.send,
  now: () => NOW,
  indexRetry: { attempts: 1, delayMs: 0 },
  ...over,
});

describe('house rain', () => {
  it('drops one public Seeker-only Lucky packet when the feed runs low, minting the tSKR it lacks', async () => {
    const c = chainRpc({ tskr: 1_000_000n, servePacket: true });
    // a circle packet, an expired one and an emptied one do not keep the public feed alive
    await store.upsertPacketMirror(mirror({ address: A.p1, expiresAt: NOW + 100 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p2, audience: 'circle', expiresAt: NOW + 100 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p3, expiresAt: NOW - 1 }), 'expired');
    await store.upsertPacketMirror(mirror({ address: A.p4, reserved: 5, expiresAt: NOW + 100 }), 'emptied');
    expect(await store.liveOpenPackets(NOW)).toBe(1);

    const result = await runHouseRain(deps(c));
    expect(result).toMatchObject({ action: 'dropped', live: 1, signature: 'sig1', minted: (NEEDED - 1_000_000n).toString() });
    expect(c.sent).toHaveLength(1);

    // one transaction: create the faucet ATA if needed + mint the shortfall, treasury ATA, create_packet
    const ixs = c.sent[0];
    const create = ixs.at(-1)!;
    expect(create.programAddress).toBe(BAO_PROGRAM_ADDRESS);
    expect(Buffer.from(create.data!.subarray(0, 8))).toEqual(Buffer.from(CREATE_PACKET_DISCRIMINATOR));
    const args = getCreatePacketInstructionDataDecoder().decode(create.data!);
    expect(args).toMatchObject({
      total: 88_000_000n,
      shares: 24,
      mode: SplitMode.Lucky,
      audience: { __kind: 'Open' },
      seekerOnly: true,
      expiresIn: 86_400n,
      maxFeeBps: 100,
      startsAt: 0n,
    });
    expect(Buffer.from(args.messageHash)).toEqual(Buffer.from(messageHash(HOUSE_MESSAGE)));
    expect(ixs.map((ix) => ix.programAddress)).toEqual([
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      TOKEN_PROGRAM_ADDRESS,
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      BAO_PROGRAM_ADDRESS,
    ]);

    // indexed right away from the packet account (its id is the served one), with its message,
    // as "Bao", and in the public feed
    const packet = (result as { packet: string }).packet;
    const row = (await store.getPacket(packet))!;
    expect(row).toMatchObject({
      packetId: '1',
      sender: faucet.address,
      audience: 'open',
      message: HOUSE_MESSAGE,
      createSignature: 'sig1',
      droppedPushed: true,
    });
    const view = await feed({ store }, A.bob, NOW);
    expect(view.packets.find((p) => p.address === packet)).toMatchObject({ senderSkr: 'Bao', message: HOUSE_MESSAGE, status: 'live' });
    expect(await store.houseRain()).toMatchObject({ claimedAt: NOW, droppedAt: NOW, packet, drops: 1 });
  });

  it('never pushes "packet dropped" to every subscriber', async () => {
    const pushes: PushMessage[] = [];
    setPushTransport({ send: async (_t, m) => (pushes.push(m), 'ok') });
    await store.registerPushToken(A.bob, 'tok-bob');
    const result = await runHouseRain(deps(chainRpc({ tskr: NEEDED })));
    expect(result.action).toBe('dropped');
    // the account was not served yet: the known fields are mirrored, the indexer corrects them later
    const row = (await store.getPacket((result as { packet: string }).packet))!;
    expect(row).toMatchObject({ totalAmount: '88000000', totalShares: 24, startsAt: NOW, expiresAt: NOW + 86_400, status: 'live' });
    // the app's drop path (POST /api/packets) would push; for a house packet it is already spent
    await pushPacketDropped(store, row, null);
    expect(pushes).toEqual([]);
    // no mint when the faucet already holds enough
    expect(result).toMatchObject({ minted: null });
  });

  it('skips while enough public packets are live', async () => {
    const c = chainRpc();
    await store.upsertPacketMirror(mirror({ address: A.p1, expiresAt: NOW + 100 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p2, startsAt: NOW + 600, createdAt: NOW - 10, expiresAt: NOW + 4_000 }), 'scheduled');
    expect(await runHouseRain(deps(c))).toEqual({ action: 'skipped', reason: 'enough_live', live: 2 });
    expect(c.sent).toHaveLength(0);
    expect(c.rpc.calls).toHaveLength(0);
  });

  it('drops at most once per interval', async () => {
    const c = chainRpc({ tskr: 10n * NEEDED });
    expect((await runHouseRain(deps(c))).action).toBe('dropped');
    await wipePackets();
    expect(await runHouseRain(deps(c, { now: () => NOW + 29 * 60 }))).toEqual({ action: 'skipped', reason: 'rate_limited', live: 0 });
    expect(c.sent).toHaveLength(1);
    expect((await runHouseRain(deps(c, { now: () => NOW + 30 * 60 }))).action).toBe('dropped');
    expect(c.sent).toHaveLength(2);
    expect((await store.houseRain())?.drops).toBe(2);
  });

  it('keeps the faucet above its SOL floor', async () => {
    const probe = chainRpc();
    const floor = (await dropCostLamports(probe.rpc, CFG.shares, 10_000n)) + CFG.minSolLamports;
    const low = chainRpc({ lamports: floor - 1n, tskr: NEEDED });
    expect(await runHouseRain(deps(low))).toEqual({ action: 'skipped', reason: 'low_sol', live: 0 });
    expect(low.sent).toHaveLength(0);
    // nothing claimed: the next tick tries again once the faucet is topped up
    expect(await store.houseRain()).toBeNull();
    const enough = chainRpc({ lamports: floor, tskr: NEEDED });
    expect((await runHouseRain(deps(enough))).action).toBe('dropped');
  });

  it('skips when tSKR is short and there is no mint authority, or the program is paused', async () => {
    expect(await runHouseRain(deps(chainRpc({ tskr: NEEDED - 1n }), { authority: null }))).toMatchObject({ reason: 'no_tskr' });
    expect(await runHouseRain(deps(chainRpc({ tskr: NEEDED, paused: true })))).toMatchObject({ reason: 'paused' });
    expect(await store.houseRain()).toBeNull();
  });

  it('is off unless enabled and keyed', async () => {
    const c = chainRpc();
    expect(await runHouseRain(deps(c, { config: { ...CFG, enabled: false } }))).toEqual({ action: 'skipped', reason: 'disabled' });
    expect(await runHouseRain(deps(c, { faucet: null }))).toEqual({ action: 'skipped', reason: 'no_key' });
    expect(c.rpc.calls).toHaveLength(0);
  });

  it('signs with one key when the mint authority is the faucet key loaded twice', async () => {
    const c = chainRpc({ tskr: 0n });
    const sameKey = await createKeyPairSignerFromPrivateKeyBytes(seed);
    expect(sameKey).not.toBe(faucet);
    // the recorder signs the real transaction: two signer objects for one address would throw
    expect((await runHouseRain(deps(c, { authority: sameKey }))).action).toBe('dropped');
  });

  it('claims the slot atomically: concurrent ticks drop once', async () => {
    expect(await store.claimHouseRain(NOW, 1_800)).toBe(true);
    expect(await store.claimHouseRain(NOW, 1_800)).toBe(false);
    expect(await store.claimHouseRain(NOW + 1_799, 1_800)).toBe(false);
    expect(await store.claimHouseRain(NOW + 1_800, 1_800)).toBe(true);

    await wipe(store);
    const c = chainRpc({ tskr: 10n * NEEDED });
    const results = await Promise.all([runHouseRain(deps(c)), runHouseRain(deps(c)), runHouseRain(deps(c))]);
    expect(results.filter((r) => r.action === 'dropped')).toHaveLength(1);
    expect(results.filter((r) => r.action === 'skipped' && r.reason === 'rate_limited')).toHaveLength(2);
    expect(c.sent).toHaveLength(1);
  });

  it('runs inside the crank tick, and is skipped without house signers', async () => {
    const c = chainRpc({ tskr: NEEDED });
    const rpc = fakeRpc({
      getSlot: () => 1n,
      getProgramAccounts: () => [],
      getMinimumBalanceForRentExemption: (b) => (BigInt(b as bigint) + 128n) * 6_960n,
      getBalance: () => ({ value: 5_000_000_000n }),
      getAccountInfo: (...a) => (c.rpc as unknown as { getAccountInfo: (...x: unknown[]) => { send: () => Promise<unknown> } }).getAccountInfo(...a).send(),
    });
    const base = { store, rpc, crank: null, send: c.send, now: () => NOW, skipIndexer: true };
    const off = await runCrank(base);
    expect(off.steps.houseRain.result).toEqual({ action: 'skipped', reason: 'disabled' });
    const on = await runCrank({ ...base, house: { faucet, authority: faucet, config: CFG, indexRetry: { attempts: 1, delayMs: 0 } } });
    expect(on.ok).toBe(true);
    expect(on.steps.houseRain.result).toMatchObject({ action: 'dropped' });
  });
});

async function wipePackets() {
  await store.sql.exec('truncate packets cascade');
}
