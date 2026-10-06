import { createSignInMessageText } from '@solana/wallet-standard-util';
import { generateKeyPair, getAddressFromPublicKey, signBytes } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignInInput } from '@bao/sdk';
import { POST as nonce } from '@/app/api/auth/nonce/route';
import { POST as verify } from '@/app/api/auth/verify/route';
import { GET as me } from '@/app/api/me/route';
import { GET as user } from '@/app/api/users/[address]/route';
import { setStore, type Store } from '@/lib/db';
import { setRpcs } from '@/lib/rpc';
import { fakeRpc } from './fake-rpc';
import { freshStore } from './helpers';

let store: Store;
const noAccounts = () =>
  fakeRpc({
    getAccountInfo: () => ({ value: null }),
    getProgramAccounts: () => [],
    getTokenAccountsByOwner: () => ({ value: [] }),
  });

beforeAll(async () => {
  store = await freshStore();
  setStore(store);
  setRpcs({ devnet: noAccounts(), mainnet: noAccounts() });
});
afterAll(async () => {
  setStore(null);
  setRpcs({ devnet: null, mainnet: null });
  await store.sql.close();
});

const post = (body: unknown) =>
  new Request('http://localhost:3000/api/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('auth routes', () => {
  it('signs in end to end and serves /api/me', async () => {
    const keys = await generateKeyPair();
    const address = await getAddressFromPublicKey(keys.publicKey);

    const res = await nonce(post({ address }), undefined as never);
    expect(res.status).toBe(200);
    const input = (await res.json()) as SignInInput;

    const message = new TextEncoder().encode(createSignInMessageText(input));
    const signature = await signBytes(keys.privateKey, message);
    const output = {
      address,
      signedMessage: Buffer.from(message).toString('base64'),
      signature: Buffer.from(signature).toString('base64'),
    };
    const verified = await verify(post({ input, output }), undefined as never);
    expect(verified.status).toBe(200);
    const { token, user: view } = await verified.json();
    expect(view).toEqual({ address, skrName: null, seekerOnMainnet: false, devnetGenesisMint: null });

    const meRes = await me(new Request('http://localhost:3000/api/me', { headers: { authorization: `Bearer ${token}` } }), undefined as never);
    expect(await meRes.json()).toEqual(view);

    const replay = await verify(post({ input, output }), undefined as never);
    expect(replay.status).toBe(401);
  });

  it('validates bodies', async () => {
    expect((await nonce(post({}), undefined as never)).status).toBe(400);
    expect((await nonce(post({ address: 'nope' }), undefined as never)).status).toBe(400);
    expect((await verify(post({ input: {} }), undefined as never)).status).toBe(400);
  });

  it('requires a session for /api/me', async () => {
    expect((await me(new Request('http://localhost:3000/api/me'), undefined as never)).status).toBe(401);
  });

  it('serves public profiles', async () => {
    const address = 'BuRJQxYkL43H3MmgmZmRuC1GCDFc1hSkEu2t1mxiDgwK';
    const res = await user(new Request(`http://localhost:3000/api/users/${address}`), { params: Promise.resolve({ address }) });
    expect(await res.json()).toMatchObject({ address, sent: [], grabs: [], crowns: 0 });
  });
});
