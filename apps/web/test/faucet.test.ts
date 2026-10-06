import { generateKeyPairSigner, type Instruction, type Signature } from '@solana/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/db';
import { runFaucet } from '@/lib/faucet';
import { fakeRpc } from './fake-rpc';
import { A, freshStore, wipe } from './helpers';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());
beforeEach(() => wipe(store));

const rpc = fakeRpc({
  getTokenAccountsByOwner: () => ({ value: [] }),
  getMinimumBalanceForRentExemption: () => 3_000_000n,
});

function recorder(failOn?: string) {
  const sent: Instruction[][] = [];
  const send = (async (_rpc: unknown, ixs: Instruction[]) => {
    sent.push(ixs);
    if (failOn && ixs.some((ix) => ix.programAddress.startsWith(failOn))) throw new Error('boom');
    return `sig${sent.length}` as Signature;
  }) as never;
  return { sent, send };
}

describe('faucet', () => {
  it('drips SOL, tSKR and a test Genesis token once per day', async () => {
    const faucet = await generateKeyPairSigner();
    const authority = await generateKeyPairSigner();
    const { sent, send } = recorder();
    const result = await runFaucet({ store, rpc, faucet, authority, send }, A.bob);
    expect(result.sol).toBe('sig1');
    expect(result.tskr).toBe('sig2');
    expect(result.genesis?.signature).toBe('sig3');
    expect(sent).toHaveLength(3);
    expect((await store.getIdentity(A.bob))?.devnetGenesisMint).toBe(result.genesis?.mint);

    await expect(runFaucet({ store, rpc, faucet, authority, send }, A.bob)).rejects.toMatchObject({ status: 429 });
  });

  it('keeps going when one grant fails', async () => {
    const { send } = recorder('1111'); // the system transfer fails
    const result = await runFaucet(
      { store, rpc, faucet: await generateKeyPairSigner(), authority: await generateKeyPairSigner(), send },
      A.carol,
    );
    expect(result.sol).toBeNull();
    expect(result.tskr).not.toBeNull();
  });

  it('releases the daily slot when nothing could be granted', async () => {
    const send = (async () => {
      throw new Error('rpc down');
    }) as never;
    await expect(
      runFaucet({ store, rpc, faucet: await generateKeyPairSigner(), authority: null, send }, A.dave),
    ).rejects.toMatchObject({ status: 502 });
    expect(await store.reserveFaucet(A.dave)).toBe(true);
  });

  it('still mints tokens without a SOL faucet key', async () => {
    const { send, sent } = recorder();
    const result = await runFaucet({ store, rpc, faucet: null, authority: await generateKeyPairSigner(), send }, A.alice);
    expect(result.sol).toBeNull();
    expect(sent.length).toBe(2);
  });
});
