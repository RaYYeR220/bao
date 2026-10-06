import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import { A, freshStore, mirror, wipe } from './helpers';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(async () => {
  await store.sql.close();
});
beforeEach(async () => {
  await wipe(store);
});

describe('migrations', () => {
  it('are applied once', async () => {
    expect(await migrate(store.sql)).toEqual([]);
  });

  it('enable row level security on every table', async () => {
    const rows = await store.sql.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname <> 'bao_migrations'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe('sign-in nonces', () => {
  it('are single use', async () => {
    await store.createNonce('n1', A.alice, { nonce: 'n1' }, new Date(Date.now() + 60_000));
    expect(await store.consumeNonce('n1')).toEqual({ address: A.alice, input: { nonce: 'n1' } });
    expect(await store.consumeNonce('n1')).toBeNull();
  });

  it('expire', async () => {
    await store.createNonce('n2', A.alice, {}, new Date(Date.now() - 1_000));
    expect(await store.consumeNonce('n2')).toBeNull();
  });
});

describe('circles', () => {
  it('creates with the owner as first member and joins by invite code', async () => {
    const c = await store.createCircle({ name: 'Fam', emoji: '🧧', owner: A.alice, inviteCode: 'ABC234' });
    expect((await store.circleByInvite('ABC234'))?.id).toBe(c.id);
    await store.addMember(c.id, A.bob);
    await store.addMember(c.id, A.bob);
    expect((await store.members(c.id)).map((m) => m.address)).toEqual([A.alice, A.bob]);
    expect(await store.isMember(c.id, A.bob)).toBe(true);
    expect(await store.isMember(c.id, A.carol)).toBe(false);
    const mine = await store.circlesOf(A.bob, 0);
    expect(mine).toHaveLength(1);
    expect(mine[0].memberCount).toBe(2);
  });

  it('rejects a duplicate invite code', async () => {
    await store.createCircle({ name: 'A', emoji: null, owner: A.alice, inviteCode: 'SAME22' });
    await expect(store.createCircle({ name: 'B', emoji: null, owner: A.bob, inviteCode: 'SAME22' })).rejects.toThrow();
  });

  it('keeps snapshots in member order', async () => {
    const c = await store.createCircle({ name: 'S', emoji: null, owner: A.alice, inviteCode: 'SNAP22' });
    await store.saveSnapshot(c.id, 'ab'.repeat(32), [A.bob, A.alice]);
    expect(await store.snapshot('ab'.repeat(32), c.id)).toEqual({ circleId: c.id, members: [A.bob, A.alice] });
    expect(await store.snapshot('cd'.repeat(32))).toBeNull();
  });

  it('ranks the generous and the lucky', async () => {
    const c = await store.createCircle({ name: 'L', emoji: null, owner: A.alice, inviteCode: 'LEAD22' });
    await store.upsertPacketMirror(mirror({ address: A.p1, sender: A.alice, totalAmount: '5' }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p2, sender: A.bob, totalAmount: '7' }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p3, sender: A.alice, totalAmount: '4' }), 'live');
    for (const p of [A.p1, A.p2, A.p3]) {
      await store.registerPacket(p, { message: null, skin: null, circleId: c.id, snapshotRoot: null, codeHint: null });
    }
    await store.markCrowned(A.p1, A.carol, '3');
    await store.markCrowned(A.p2, A.carol, '2');
    await store.markCrowned(A.p3, A.bob, '1');
    const boards = await store.circleLeaderboards(c.id);
    expect(boards.generous).toEqual([
      { address: A.alice, total: '9' },
      { address: A.bob, total: '7' },
    ]);
    expect(boards.lucky).toEqual([
      { address: A.carol, crowns: 2 },
      { address: A.bob, crowns: 1 },
    ]);
  });
});

describe('packets', () => {
  it('mirror updates never drop app metadata or reopen a closed packet', async () => {
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await store.registerPacket(A.p1, { message: 'gong xi', skin: 'gold', circleId: null, snapshotRoot: null, codeHint: null });
    await store.upsertPacketMirror(mirror({ address: A.p1, reserved: 2, resolved: 1, remainingAmount: '7' }), 'live');
    let p = await store.getPacket(A.p1);
    expect(p).toMatchObject({ message: 'gong xi', skin: 'gold', reserved: 2, resolved: 1, remainingAmount: '7', registered: true });
    await store.markClosed(A.p1, 'sig', '7', null);
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    p = await store.getPacket(A.p1);
    expect(p?.status).toBe('closed');
  });

  it('event-only mirrors keep known counters', async () => {
    await store.upsertPacketMirror(mirror({ address: A.p1, reserved: 3, resolved: 2, remainingAmount: '4' }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p1, reserved: undefined, resolved: undefined }), 'live');
    expect(await store.getPacket(A.p1)).toMatchObject({ reserved: 3, resolved: 2, remainingAmount: '4' });
  });

  it('feed shows open packets to everyone and circle packets to members, live before scheduled', async () => {
    const now = 5_000;
    const c = await store.createCircle({ name: 'F', emoji: null, owner: A.alice, inviteCode: 'FEED22' });
    await store.upsertPacketMirror(mirror({ address: A.p1, expiresAt: 9_000 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p2, audience: 'circle', expiresAt: 8_000 }), 'live');
    await store.registerPacket(A.p2, { message: null, skin: null, circleId: c.id, snapshotRoot: null, codeHint: null });
    await store.upsertPacketMirror(mirror({ address: A.p3, startsAt: 6_000, createdAt: 4_000 }), 'scheduled');
    await store.upsertPacketMirror(mirror({ address: A.p4, audience: 'code' }), 'live');

    expect((await store.feed(null, now)).map((p) => p.address)).toEqual([A.p1, A.p3]);
    expect((await store.feed(A.alice, now)).map((p) => p.address)).toEqual([A.p2, A.p1, A.p3]);
    expect((await store.feed(A.bob, now)).map((p) => p.address)).toEqual([A.p1, A.p3]);
    expect((await store.upcomingRains(now)).map((p) => p.address)).toEqual([A.p3]);

    await store.applyGrab({ packet: A.p1, deviceKey: A.carol, claimer: A.alice, index: 0, status: 'pending', at: now, slot: 1 });
    expect((await store.feed(A.alice, now)).map((p) => p.address)).toEqual([A.p2, A.p3]);
  });

  it('push flags fire once', async () => {
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    expect(await store.claimPushFlag(A.p1, 'dropped_push_at')).toBe(true);
    expect(await store.claimPushFlag(A.p1, 'dropped_push_at')).toBe(false);
  });
});

describe('grabs', () => {
  const base = { packet: A.p1, deviceKey: A.dave, claimer: A.bob, index: 0, at: 100 };

  it('never move backwards, whatever order events arrive in', async () => {
    await store.applyGrab({ ...base, status: 'paid', payoutSignature: 'pay', at: 300 });
    await store.applyGrab({ ...base, status: 'won', amount: '42', callbackSignature: 'cb', randomness: 'ff', at: 200 });
    await store.applyGrab({ ...base, status: 'pending', grabSignature: 'grab', slot: 10 });
    const [g] = await store.grabsOf(A.p1);
    expect(g).toMatchObject({
      status: 'paid',
      amount: '42',
      grabSignature: 'grab',
      callbackSignature: 'cb',
      payoutSignature: 'pay',
      randomness: 'ff',
      slot: 10,
      at: 100,
    });
  });

  it('a stale cancel removes the reservation but not a later re-grab', async () => {
    await store.applyGrab({ ...base, status: 'pending', slot: 10 });
    await store.applyGrab({ ...base, status: 'pending', slot: 500, index: 1 });
    await store.cancelGrab(A.p1, A.dave, 400);
    expect(await store.grabsOf(A.p1)).toHaveLength(1);
    await store.cancelGrab(A.p1, A.dave, 600);
    expect(await store.grabsOf(A.p1)).toHaveLength(0);
  });

  it('forfeits only won shares', async () => {
    await store.applyGrab({ ...base, status: 'won', amount: '5' });
    await store.markForfeited(A.p1, A.bob);
    expect((await store.grabsOf(A.p1))[0].status).toBe('forfeited');
  });
});

describe('faucet', () => {
  it('allows one claim per wallet per day', async () => {
    expect(await store.reserveFaucet(A.alice)).toBe(true);
    expect(await store.reserveFaucet(A.alice)).toBe(false);
    await store.sql.query("update faucet_claims set claimed_at = now() - interval '25 hours'");
    expect(await store.reserveFaucet(A.alice)).toBe(true);
  });
});

describe('cursor and push tokens', () => {
  it('stores the indexer cursor', async () => {
    expect(await store.cursor()).toBeNull();
    await store.setCursor('sig1', 5);
    await store.setCursor('sig2', 9);
    expect(await store.cursor()).toEqual({ signature: 'sig2', slot: 9 });
  });

  it('moves a push token to the latest wallet', async () => {
    await store.registerPushToken(A.alice, 'tok');
    await store.registerPushToken(A.bob, 'tok');
    expect(await store.pushTokensFor([A.alice])).toEqual([]);
    expect(await store.allPushTokens([A.alice])).toEqual([{ token: 'tok', address: A.bob }]);
  });
});
