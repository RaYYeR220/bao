import { address, none, type Address, type Instruction } from '@solana/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLOSE_CLAIMS_DISCRIMINATOR,
  ClaimStatus,
  SplitMode,
  getClaimRecordEncoder,
  getPacketEncoder,
  type ClaimRecord,
  type Packet,
} from '@bao/sdk';
import { CLAIM_SIZE, PACKET_SIZE, planCrank, runCrank, type ChainSnapshot } from '@/lib/crank';
import type { Store } from '@/lib/db';
import { setPushTransport } from '@/lib/push';
import { base64Account, fakeRpc } from './fake-rpc';
import { A, freshStore, mirror, wipe } from './helpers';

const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const NOW = 1_000_000;
const SLOT = 10_000n;

function packet(over: Partial<Packet> = {}): Packet {
  return {
    discriminator: new Uint8Array(8),
    sender: address(A.alice),
    id: 1n,
    mint: address(A.mint),
    tokenProgram: TOKEN,
    totalAmount: 100n,
    remainingAmount: 100n,
    totalShares: 2,
    reserved: 0,
    resolved: 0,
    openClaims: 0,
    mode: SplitMode.Lucky,
    audience: { __kind: 'Open' },
    seekerOnly: true,
    sgtGroup: address(A.dave),
    crankReward: 5_000n,
    createdAt: BigInt(NOW - 100),
    startsAt: BigInt(NOW - 100),
    expiresAt: BigInt(NOW + 3_600),
    messageHash: new Uint8Array(32),
    parent: none(),
    chainRoot: address(A.p1),
    chainDepth: 0,
    luckKing: none(),
    luckKingAmount: 0n,
    crowned: false,
    bump: 255,
    vaultBump: 255,
    gasBump: 255,
    ...over,
  };
}

function claim(p: string, device: string, status: ClaimStatus, over: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    discriminator: new Uint8Array(8),
    packet: address(p),
    claimer: address(device),
    deviceKey: address(device),
    index: 0,
    amount: status === ClaimStatus.Pending ? 0n : 40n,
    status,
    requestedSlot: SLOT - 10n,
    bump: 255,
    ...over,
  };
}

const snap = (packets: [string, Packet][], claims: [string, ClaimRecord][]): ChainSnapshot => ({
  slot: SLOT,
  now: NOW,
  packets: packets.map(([a, data]) => ({ address: address(a), data })),
  claims: claims.map(([a, data]) => ({ address: address(a), data })),
  crowns: [],
});

describe('planCrank', () => {
  it('pays won shares and cancels only stale pending grabs', () => {
    const plan = planCrank(
      snap(
        [[A.p1, packet({ reserved: 2, resolved: 1 })]],
        [
          [A.p2, claim(A.p1, A.bob, ClaimStatus.Won)],
          [A.p3, claim(A.p1, A.carol, ClaimStatus.Pending, { requestedSlot: SLOT - 301n })],
          [A.p4, claim(A.p1, A.dave, ClaimStatus.Pending, { requestedSlot: SLOT - 300n })],
        ],
      ),
    );
    expect(plan.payouts).toEqual([{ claim: A.p2, packet: A.p1, claimer: A.bob, mint: A.mint, tokenProgram: TOKEN, amount: 40n }]);
    expect(plan.cancels).toEqual([{ claim: A.p3, packet: A.p1, deviceKey: A.carol }]);
    expect(plan.closes).toEqual([]);
  });

  it('closes finished packets once nothing is pending or unpaid', () => {
    const finished = packet({ reserved: 2, resolved: 2, openClaims: 2 });
    const paidOnly = planCrank(
      snap([[A.p1, finished]], [
        [A.p2, claim(A.p1, A.bob, ClaimStatus.Paid)],
        [A.p3, claim(A.p1, A.carol, ClaimStatus.Paid)],
      ]),
    );
    expect(paidOnly.closes).toEqual([{ packet: A.p1, sender: A.alice, mint: A.mint, tokenProgram: TOKEN, claimBatches: [[A.p2, A.p3]] }]);

    const unpaid = planCrank(snap([[A.p1, finished]], [[A.p2, claim(A.p1, A.bob, ClaimStatus.Won)]]));
    expect(unpaid.closes).toEqual([]);
    expect(unpaid.payouts).toHaveLength(1);
  });

  it('closes expired packets, forfeiting unpaid wins only after a grace period, never with a grab in flight', () => {
    const won: [string, ClaimRecord][] = [[A.p2, claim(A.p1, A.bob, ClaimStatus.Won)]];
    const justExpired = packet({ expiresAt: BigInt(NOW - 1), reserved: 1, resolved: 1 });
    expect(planCrank(snap([[A.p1, justExpired]], won)).closes).toEqual([]);
    expect(planCrank(snap([[A.p1, justExpired]], [])).closes).toHaveLength(1);
    const longExpired = packet({ expiresAt: BigInt(NOW - 3_600), reserved: 1, resolved: 1 });
    expect(planCrank(snap([[A.p1, longExpired]], won)).closes).toHaveLength(1);
    const inFlight = packet({ expiresAt: BigInt(NOW - 1), reserved: 2, resolved: 1 });
    expect(planCrank(snap([[A.p1, inFlight]], [])).closes).toEqual([]);
    const live = packet({ reserved: 1, resolved: 1 });
    expect(planCrank(snap([[A.p1, live]], [])).closes).toEqual([]);
  });

  it('batches claim records twenty at a time', () => {
    const claims: [string, ClaimRecord][] = Array.from({ length: 45 }, (_, i) => {
      const a = address(`${'1'.repeat(31)}${'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[i]}`);
      return [a, claim(A.p1, A.bob, ClaimStatus.Paid, { index: i })];
    });
    const plan = planCrank(snap([[A.p1, packet({ totalShares: 45, reserved: 45, resolved: 45 })]], claims));
    expect(plan.closes[0].claimBatches.map((b) => b.length)).toEqual([20, 20, 5]);
  });

  it('pays shares of packets closest to expiry first', () => {
    const plan = planCrank(
      snap(
        [
          [A.p1, packet({ expiresAt: BigInt(NOW + 9_000) })],
          [A.p3, packet({ expiresAt: BigInt(NOW + 60) })],
        ],
        [
          [A.p2, claim(A.p1, A.bob, ClaimStatus.Won)],
          [A.p4, claim(A.p3, A.carol, ClaimStatus.Won)],
        ],
      ),
      { payouts: 1, cancels: 0, closes: 0 },
    );
    expect(plan.payouts.map((p) => p.claim)).toEqual([A.p4]);
  });

  it('closes lapsed crowns', () => {
    const crown = (expiresAt: bigint) => ({
      discriminator: new Uint8Array(8),
      packet: address(A.p1),
      king: address(A.bob),
      amount: 1n,
      chainRoot: address(A.p1),
      chainDepth: 0,
      refundTo: address(A.alice),
      expiresAt,
      bump: 255,
    });
    const s = snap([], []);
    s.crowns = [
      { address: address(A.p2), data: crown(BigInt(NOW - 1)) },
      { address: address(A.p3), data: crown(BigInt(NOW + 100)) },
    ];
    expect(planCrank(s).crowns).toEqual([{ crown: A.p2, refundTo: A.alice }]);
  });

  it('respects per-tick limits', () => {
    const claims: [string, ClaimRecord][] = [A.p2, A.p3, A.p4].map((a, i) => [a, claim(A.p1, A.bob, ClaimStatus.Won, { index: i })]);
    expect(planCrank(snap([[A.p1, packet()]], claims), { payouts: 2, cancels: 1, closes: 1 }).payouts).toHaveLength(2);
  });
});

describe('runCrank', () => {
  let store: Store;
  beforeAll(async () => {
    store = await freshStore();
  });
  afterAll(() => store.sql.close());
  beforeEach(() => wipe(store));

  const accountsRpc = (packets: [string, Packet][], claims: [string, ClaimRecord][]) =>
    fakeRpc({
      getSlot: () => SLOT,
      getProgramAccounts: (_p, cfg) => {
        const size = Number((cfg as { filters: { dataSize?: bigint }[] }).filters[0].dataSize);
        if (size === PACKET_SIZE) {
          return packets.map(([a, d]) => ({ pubkey: a, account: base64Account(Buffer.from(getPacketEncoder().encode(d)).toString('base64')) }));
        }
        if (size === CLAIM_SIZE) {
          return claims.map(([a, d]) => ({ pubkey: a, account: base64Account(Buffer.from(getClaimRecordEncoder().encode(d)).toString('base64')) }));
        }
        return [];
      },
    });

  it('runs every step, isolates failures and reconciles grabs from claim accounts', async () => {
    const pushes: string[] = [];
    setPushTransport({ send: async (_t, m) => (pushes.push(m.kind), 'ok') });
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p4, createdAt: NOW - 600, startsAt: NOW + 30, expiresAt: NOW + 4_000 }), 'scheduled');
    await store.registerPacket(A.p4, { message: null, skin: null, circleId: null, snapshotRoot: null, codeHint: null });
    // an unregistered rain never fans out
    await store.upsertPacketMirror(mirror({ address: A.p3, createdAt: NOW - 600, startsAt: NOW + 30, expiresAt: NOW + 4_000 }), 'scheduled');
    await store.registerPushToken(A.bob, 'tok-bob');

    const finished = packet({ reserved: 2, resolved: 2, openClaims: 1 });
    const rpc = accountsRpc(
      [[A.p1, finished]],
      [
        [A.p2, claim(A.p1, A.bob, ClaimStatus.Won)],
        [A.p3, claim(A.p1, A.carol, ClaimStatus.Pending, { requestedSlot: 1n })],
      ],
    );
    const sent: Instruction[][] = [];
    const send = (async (_r: unknown, ixs: Instruction[]) => {
      sent.push(ixs);
      if (sent.length === 2) throw new Error('cancel failed on purpose');
      return `sig${sent.length}`;
    }) as never;
    const report = await runCrank({
      store,
      rpc,
      crank: { address: address(A.dave) } as never,
      send,
      now: () => NOW,
      skipIndexer: true,
    });

    expect(report.steps.payouts.result?.done).toEqual([{ target: A.p2, signature: 'sig1' }]);
    expect(report.steps.cancels.result?.failed).toEqual([{ target: A.p3, error: 'cancel failed on purpose' }]);
    // the finished packet still has an unpaid win in this snapshot, so it waits for the next tick
    expect(report.steps.closes.result?.done).toEqual([]);
    expect(report.steps.reconcile.result).toEqual({ claims: 2 });
    expect(report.steps.rains.result?.pushed).toEqual([A.p4]);
    expect(pushes).toEqual(['rain_starting']);
    // the payout settled bob's row; the failed cancel left carol's reservation in place
    expect((await store.grabsOf(A.p1)).map((g) => [g.claimer, g.status, g.payoutSignature])).toEqual([
      [A.bob, 'paid', 'sig1'],
      [A.carol, 'pending', null],
    ]);
    setPushTransport(undefined);
  });

  it('closes claims in batches before the packet', async () => {
    const rpc = accountsRpc(
      [[A.p1, packet({ reserved: 1, resolved: 1, openClaims: 1, expiresAt: BigInt(NOW - 5) })]],
      [[A.p2, claim(A.p1, A.bob, ClaimStatus.Paid)]],
    );
    const sent: Instruction[][] = [];
    const send = (async (_r: unknown, ixs: Instruction[]) => (sent.push(ixs), `sig${sent.length}`)) as never;
    const report = await runCrank({ store, rpc, crank: { address: address(A.dave) } as never, send, now: () => NOW, skipIndexer: true });
    expect(report.ok).toBe(true);
    expect(report.steps.closes.result?.done).toEqual([{ target: A.p1, signature: 'sig2' }]);
    const closeClaims = sent[0][0];
    expect(Buffer.from(closeClaims.data!.subarray(0, 8))).toEqual(Buffer.from(CLOSE_CLAIMS_DISCRIMINATOR));
    expect(closeClaims.accounts!.at(-1)!.address).toBe(A.p2 as Address);
  });

  it('skips on-chain steps without a crank key', async () => {
    const rpc = accountsRpc([[A.p1, packet()]], [[A.p2, claim(A.p1, A.bob, ClaimStatus.Won)]]);
    const report = await runCrank({ store, rpc, crank: null, skipIndexer: true });
    expect(report.steps.payouts.result).toEqual({ done: [], failed: [] });
    expect(report.ok).toBe(true);
  });
});

describe('crank time budget', () => {
  it('defers work once the budget is spent', async () => {
    const store = await freshStore();
    const claims: [string, ClaimRecord][] = [A.p2, A.p3].map((a, i) => [a, claim(A.p1, A.bob, ClaimStatus.Won, { index: i })]);
    const rpc = fakeRpc({
      getSlot: () => SLOT,
      getProgramAccounts: (_p, cfg) => {
        const size = Number((cfg as { filters: { dataSize?: bigint }[] }).filters[0].dataSize);
        return size === PACKET_SIZE
          ? [{ pubkey: A.p1, account: base64Account(Buffer.from(getPacketEncoder().encode(packet())).toString('base64')) }]
          : claims.map(([a, d]) => ({ pubkey: a, account: base64Account(Buffer.from(getClaimRecordEncoder().encode(d)).toString('base64')) }));
      },
    });
    const send = (async () => 'sig') as never;
    const report = await runCrank({ store, rpc, crank: { address: address(A.dave) } as never, send, skipIndexer: true, budgetMs: -1 });
    expect(report.steps.payouts.result).toEqual({ done: [], failed: [], deferred: [A.p2, A.p3] });
    await store.sql.close();
  });
});
