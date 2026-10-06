import { createSignInMessageText } from '@solana/wallet-standard-util';
import { generateKeyPair, getAddressFromPublicKey, signBytes } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SignInInput, SignInOutput } from '@bao/sdk';
import { issueSession, issueSignIn, requireUser, sessionAddress, verifySignIn } from '@/lib/auth';
import type { Store } from '@/lib/db';
import { HttpError } from '@/lib/types';
import { freshStore } from './helpers';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function wallet() {
  const keys = await generateKeyPair();
  const address = await getAddressFromPublicKey(keys.publicKey);
  const sign = async (input: SignInInput, text = createSignInMessageText(input)): Promise<SignInOutput> => {
    const message = new TextEncoder().encode(text);
    const signature = await signBytes(keys.privateKey, message);
    return { address, signedMessage: b64(message), signature: b64(signature) };
  };
  return { address, sign };
}

describe('sign in with solana', () => {
  it('issues a devnet SIWS challenge for the app domain', async () => {
    const w = await wallet();
    const input = await issueSignIn(store, w.address);
    expect(input).toMatchObject({
      address: w.address,
      domain: 'localhost:3000',
      uri: 'http://localhost:3000',
      statement: 'Sign in to Bao',
      version: '1',
      chainId: 'solana:devnet',
    });
    expect(input.nonce).toMatch(/^[A-Za-z0-9]{16,}$/);
    expect(Date.parse(input.expirationTime) - Date.parse(input.issuedAt)).toBe(10 * 60_000);
  });

  it('rejects a malformed address', async () => {
    await expect(issueSignIn(store, 'not-an-address')).rejects.toBeInstanceOf(HttpError);
  });

  it('accepts a real signature once', async () => {
    const w = await wallet();
    const input = await issueSignIn(store, w.address);
    const output = await w.sign(input);
    expect(await verifySignIn(store, input, output)).toBe(w.address);
    await expect(verifySignIn(store, input, output)).rejects.toThrow(/nonce/);
  });

  it('rejects a tampered message', async () => {
    const w = await wallet();
    const input = await issueSignIn(store, w.address);
    const output = await w.sign(input, createSignInMessageText({ ...input, statement: 'Sign in to Evil' }));
    await expect(verifySignIn(store, input, output)).rejects.toThrow(/signature/);
  });

  it('rejects a tampered signature', async () => {
    const w = await wallet();
    const input = await issueSignIn(store, w.address);
    const output = await w.sign(input);
    const sig = Buffer.from(output.signature, 'base64');
    sig[0] ^= 1;
    await expect(verifySignIn(store, input, { ...output, signature: b64(sig) })).rejects.toThrow(/signature/);
  });

  it('rejects a signature from another wallet', async () => {
    const w = await wallet();
    const mallory = await wallet();
    const input = await issueSignIn(store, w.address);
    const output = await mallory.sign(input);
    await expect(verifySignIn(store, input, { ...output, address: w.address })).rejects.toThrow(/signature/);
  });

  it('rejects an input that differs from the issued challenge', async () => {
    const w = await wallet();
    const input = await issueSignIn(store, w.address);
    const forged = { ...input, expirationTime: new Date(Date.now() + 86_400_000).toISOString() };
    const output = await w.sign(forged);
    await expect(verifySignIn(store, forged, output)).rejects.toThrow(/challenge/);
  });
});

describe('sessions', () => {
  it('round-trips a 30-day bearer token', async () => {
    const w = await wallet();
    const token = await issueSession(w.address);
    const req = new Request('http://x/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(await sessionAddress(req)).toBe(w.address);
    expect(await requireUser(req)).toBe(w.address);
  });

  it('refuses missing or forged tokens', async () => {
    await expect(requireUser(new Request('http://x'))).rejects.toMatchObject({ status: 401 });
    const forged = new Request('http://x', { headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(await sessionAddress(forged)).toBeNull();
  });
});
