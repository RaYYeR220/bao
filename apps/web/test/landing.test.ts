import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setStore, type Store } from '@/lib/db';
import { resetEnv } from '@/lib/env';
import { formatPaid, landingStats, readLandingStats } from '@/lib/landing';
import { A, freshStore, mirror, wipe } from './helpers';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());
beforeEach(() => wipe(store));
afterEach(() => {
  delete process.env.PGLITE_DIR;
  resetEnv();
  setStore(null);
});

describe('landing stats', () => {
  it('shows nothing until a packet exists', async () => {
    expect(await store.totals(A.mint)).toEqual({ packets: 0, grabs: 0, paid: '0', houseDrops: 0 });
    expect(await readLandingStats(store, A.mint)).toBeNull();
  });

  it('counts packets, grabs that drew a share, and the tSKR that reached grabbers', async () => {
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p2 }), 'expired');
    await store.upsertPacketMirror(mirror({ address: A.p3, mint: USDC }), 'live');
    await store.applyGrab({ packet: A.p1, deviceKey: A.bob, claimer: A.bob, index: 0, status: 'paid', amount: '31200000', at: 1 });
    await store.applyGrab({ packet: A.p1, deviceKey: A.carol, claimer: A.carol, index: 1, status: 'won', amount: '19850000', at: 2 });
    await store.applyGrab({ packet: A.p1, deviceKey: A.dave, claimer: A.dave, index: 2, status: 'pending', at: 3 });
    await store.applyGrab({ packet: A.p2, deviceKey: A.bob, claimer: A.bob, index: 0, status: 'paid', amount: '21500000', at: 4 });
    // paid, but in another token: counted as a grab, not as tSKR
    await store.applyGrab({ packet: A.p3, deviceKey: A.bob, claimer: A.bob, index: 0, status: 'paid', amount: '900000000', at: 5 });

    expect(await store.totals(A.mint)).toEqual({ packets: 3, grabs: 4, paid: '52700000', houseDrops: 0 });
    expect(await readLandingStats(store, A.mint)).toEqual({ packets: '3', grabs: '4', paid: '52.7', symbol: 'tSKR', house: null });
  });

  it('says how many packets the house rain dropped', async () => {
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await store.claimHouseRain(1_000, 60);
    await store.recordHouseRain(1_000, A.p1, 'sig');
    expect((await readLandingStats(store, A.mint))?.house).toBe('1');
  });

  it('writes large totals as whole tokens and small ones with two decimals', () => {
    expect(formatPaid(52_700_000n, 6)).toBe('52.7');
    expect(formatPaid(99_999_999n, 6)).toBe('99.99');
    expect(formatPaid(100_000_000n, 6)).toBe('100');
    expect(formatPaid(1_234_567_890_000n, 6)).toBe('1,234,567');
    expect(formatPaid(0n, 6)).toBe('0');
  });

  it('is hidden without a database to read, and when the read fails', async () => {
    // no DATABASE_URL and no PGLITE_DIR: nothing is booted just to count zero packets
    expect(await landingStats()).toBeNull();
    process.env.PGLITE_DIR = 'memory://landing-test';
    resetEnv();
    const broken = { totals: async () => Promise.reject(new Error('connection refused')) } as unknown as Store;
    setStore(broken);
    expect(await landingStats()).toBeNull();
    const slow = { totals: () => new Promise(() => undefined) } as unknown as Store;
    setStore(slow);
    expect(await landingStats(30)).toBeNull();
    setStore(store);
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    expect(await landingStats()).toMatchObject({ packets: '1', grabs: '0', paid: '0', symbol: 'tSKR' });
  });
});
