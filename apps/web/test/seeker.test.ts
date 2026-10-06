import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/db';
import { identity, resetIdentityBackoff } from '@/lib/seeker';
import { fakeRpc } from './fake-rpc';
import { A, freshStore, wipe } from './helpers';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());
beforeEach(async () => {
  await wipe(store);
  resetIdentityBackoff();
});

describe('identity', () => {
  it('caches answers and backs off after failures', async () => {
    const down = fakeRpc({});
    const devnet = fakeRpc({ getTokenAccountsByOwner: () => ({ value: [] }) });
    const view = await identity({ store, mainnet: down, devnet, now: () => 1_000 }, A.bob);
    expect(view).toEqual({ address: A.bob, skrName: null, seekerOnMainnet: false, devnetGenesisMint: null });
    const failedCalls = down.calls.length;
    expect(failedCalls).toBeGreaterThan(0);

    // within the backoff window mainnet is not asked again; devnet is cached for minutes
    await identity({ store, mainnet: down, devnet, now: () => 1_100 }, A.bob);
    expect(down.calls.length).toBe(failedCalls);
    expect(devnet.calls.length).toBe(1);

    await identity({ store, mainnet: down, devnet, now: () => 1_100 }, A.bob, { refreshDevnet: true });
    expect(devnet.calls.length).toBe(2);
  });

  it('serves cached names without touching mainnet', async () => {
    await store.saveSkr(A.carol, 'carol.skr');
    await store.saveSeeker(A.carol, true);
    await store.saveDevnetGenesis(A.carol, A.dave);
    const mainnet = fakeRpc({});
    const devnet = fakeRpc({});
    const now = Math.floor(Date.now() / 1000);
    expect(await identity({ store, mainnet, devnet, now: () => now }, A.carol)).toEqual({
      address: A.carol,
      skrName: 'carol.skr',
      seekerOnMainnet: true,
      devnetGenesisMint: A.dave,
    });
    expect(mainnet.calls.length + devnet.calls.length).toBe(0);
  });
});
