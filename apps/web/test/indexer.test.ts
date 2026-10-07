import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/db';
import { indexTransaction, indexWebhook, parseWebhookPayload, pollProgram, type TxInput } from '@/lib/indexer';
import { setPushTransport, type PushMessage } from '@/lib/push';
import closeFx from './fixtures/close-txs.json';
import smoke from './fixtures/smoke-txs.json';
import { fakeRpc } from './fake-rpc';
import { freshStore, mirror, wipe } from './helpers';

const PACKET = 'ASRrZfbPcSoDjjJwuDGhghQyin8meXeb4HwTuEca8rXV';
type Fx = { signature: string; slot: number; blockTime: number; err: unknown; logMessages: string[] };
const tx = (f: Fx): TxInput => ({ signature: f.signature, slot: f.slot, blockTime: f.blockTime, err: f.err, logs: f.logMessages });
const ORDER = ['create_packet', 'grab_lucky', 'vrf_callback', 'payout'] as const;
const fx = smoke as unknown as Record<(typeof ORDER)[number], Fx>;

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());
beforeEach(() => wipe(store));
afterEach(() => setPushTransport(undefined));

// the packet account is closed by now, so refreshes find nothing and events carry the state
const rpcWithoutAccounts = () =>
  fakeRpc({
    getAccountInfo: () => ({ value: null }),
    getTransaction: (sig) => {
      const f = Object.values(fx).find((t) => t.signature === sig);
      return f ? { slot: BigInt(f.slot), blockTime: BigInt(f.blockTime), meta: { err: null, logMessages: f.logMessages } } : null;
    },
  });

describe('indexTransaction on real devnet transactions', () => {
  it('follows a lucky grab from reservation to payout', async () => {
    const deps = { store, rpc: rpcWithoutAccounts(), now: () => fx.payout.blockTime + 5 };
    const pushes: PushMessage[] = [];
    setPushTransport({ send: async (_t, m) => (pushes.push(m), 'ok') });

    expect((await indexTransaction(deps, tx(fx.create_packet))).events).toEqual(['PacketCreated']);
    const packet = await store.getPacket(PACKET);
    expect(packet).toMatchObject({ totalAmount: '10000000', totalShares: 2, mode: 'lucky', audience: 'open', seekerOnly: true });
    expect(packet?.createSignature).toBe(fx.create_packet.signature);

    await indexTransaction(deps, tx(fx.grab_lucky));
    let [grab] = await store.grabsOf(PACKET);
    expect(grab).toMatchObject({ status: 'pending', grabSignature: fx.grab_lucky.signature, amount: null, slot: fx.grab_lucky.slot });

    await indexTransaction(deps, tx(fx.vrf_callback));
    [grab] = await store.grabsOf(PACKET);
    expect(grab).toMatchObject({ status: 'won', amount: '4391318', callbackSignature: fx.vrf_callback.signature });
    expect(grab.randomness).toMatch(/^[0-9a-f]{64}$/);

    await store.registerPushToken(grab.claimer, 'tok');
    await indexTransaction(deps, tx(fx.payout));
    [grab] = await store.grabsOf(PACKET);
    expect(grab).toMatchObject({ status: 'paid', payoutSignature: fx.payout.signature, at: fx.grab_lucky.blockTime });
    expect(pushes.map((p) => p.kind)).toEqual(['paid_out']);
  });

  it('pushes a payout once when the webhook and the poller both index it', async () => {
    const deps = { store, rpc: rpcWithoutAccounts(), now: () => fx.payout.blockTime + 5 };
    const pushes: PushMessage[] = [];
    setPushTransport({ send: async (_t, m) => (pushes.push(m), 'ok') });
    for (const k of ['create_packet', 'grab_lucky', 'vrf_callback'] as const) await indexTransaction(deps, tx(fx[k]));
    const [grab] = await store.grabsOf(PACKET);
    await store.registerPushToken(grab.claimer, 'tok');
    for (let round = 0; round < 3; round++) await indexTransaction(deps, tx(fx.payout));
    expect(pushes.map((p) => p.kind)).toEqual(['paid_out']);
  });

  it('is idempotent under replays', async () => {
    const deps = { store, rpc: rpcWithoutAccounts() };
    for (let round = 0; round < 2; round++) for (const k of ORDER) await indexTransaction(deps, tx(fx[k]));
    const grabs = await store.grabsOf(PACKET);
    expect(grabs).toHaveLength(1);
    expect(grabs[0].status).toBe('paid');
  });

  it('skips failed transactions', async () => {
    const deps = { store, rpc: rpcWithoutAccounts() };
    expect((await indexTransaction(deps, { ...tx(fx.create_packet), err: { InstructionError: [0, 'x'] } })).events).toEqual([]);
    expect(await store.getPacket(PACKET)).toBeNull();
  });
});

describe('pollProgram', () => {
  it('indexes from the cursor, oldest first, and resumes', async () => {
    const newestFirst = [...ORDER].reverse().map((k) => ({ signature: fx[k].signature, slot: BigInt(fx[k].slot), err: null }));
    const base = rpcWithoutAccounts();
    let served = newestFirst;
    const rpc = fakeRpc({
      getAccountInfo: () => ({ value: null }),
      getTransaction: (sig) => base.getTransaction(sig as never).send(),
      getSignaturesForAddress: (_p, opts) => {
        const until = (opts as { until?: string }).until;
        const stop = until ? served.findIndex((s) => s.signature === until) : -1;
        return stop >= 0 ? served.slice(0, stop) : served;
      },
    });
    const first = await pollProgram({ store, rpc });
    expect(first).toMatchObject({ seen: 4, processed: 4, events: 4, cursor: fx.payout.signature });
    expect((await store.grabsOf(PACKET))[0].status).toBe('paid');

    served = [{ signature: 'newer', slot: 1n, err: { x: 1 } as never }, ...newestFirst];
    const second = await pollProgram({ store, rpc });
    expect(second).toMatchObject({ seen: 1, processed: 1, events: 0, cursor: 'newer' });
  });
});

describe('helius webhooks', () => {
  it('parses raw and enhanced payloads', () => {
    const raw = {
      blockTime: fx.payout.blockTime,
      slot: fx.payout.slot,
      meta: { err: null, logMessages: fx.payout.logMessages },
      transaction: { signatures: [fx.payout.signature], message: {} },
    };
    const enhanced = { signature: fx.create_packet.signature, type: 'UNKNOWN', events: {} };
    const parsed = parseWebhookPayload([raw, enhanced, 42, null]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].tx?.logs).toEqual(fx.payout.logMessages);
    expect(parsed[1]).toEqual({ signature: fx.create_packet.signature, tx: null });
  });

  it('refetches enhanced payloads by signature', async () => {
    const rpc = rpcWithoutAccounts();
    const result = await indexWebhook({ store, rpc }, [{ signature: fx.create_packet.signature }]);
    expect(result).toEqual({ received: 1, events: 1, failed: [] });
    expect(await store.getPacket(PACKET)).not.toBeNull();
  });
});

describe('crowning and closing (real devnet crank pass)', () => {
  it('records the Luck King and the close', async () => {
    const c = closeFx as unknown as Record<'vrf_callback_crowned' | 'close_claims' | 'close_packet', Fx> & { packet: string };
    const deps = { store, rpc: rpcWithoutAccounts() };
    expect((await indexTransaction(deps, tx(c.vrf_callback_crowned))).events).toEqual(['Grabbed', 'LuckKingCrowned']);
    expect((await indexTransaction(deps, tx(c.close_claims))).events).toEqual([]);
    expect((await indexTransaction(deps, tx(c.close_packet))).events).toEqual(['PacketClosed']);
    const [grab] = await store.grabsOf(c.packet);
    expect(grab.status).toBe('won');
    // the row exists only through events here; the close and crown still land on it once known
    await store.upsertPacketMirror(mirror({ address: c.packet }), 'live');
    await indexTransaction(deps, tx(c.vrf_callback_crowned));
    await indexTransaction(deps, tx(c.close_packet));
    const packet = await store.getPacket(c.packet);
    expect(packet).toMatchObject({ status: 'closed', crowned: true, luckKing: grab.claimer, refunded: '0' });
    expect(packet?.closeSignature).toBe(c.close_packet.signature);
  });
});
