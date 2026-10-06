/**
 * Sign In With Solana. The server issues the exact SIWS input, keeps it with a single-use
 * nonce, and verifies the wallet's signature over the reconstructed message. A verified
 * sign-in yields a 30-day HS256 bearer token.
 */
import { randomBytes } from 'node:crypto';
import { verifySignIn as verifySiws } from '@solana/wallet-standard-util';
import { getAddressEncoder, getBase58Decoder, isAddress, type Address } from '@solana/kit';
import { jwtVerify, SignJWT } from 'jose';
import type { SignInInput, SignInOutput } from '@bao/sdk';
import type { Store } from './db';
import { baseUrl, jwtSecret, siwsDomain } from './env';
import { HttpError } from './types';

export const SIWS_STATEMENT = 'Sign in to Bao';
export const SIWS_CHAIN = 'solana:devnet';
const CHALLENGE_TTL_MS = 10 * 60_000;
const SESSION_TTL = '30d';
const ISSUER = 'bao';

export function assertAddress(value: unknown, field = 'address'): Address {
  if (typeof value !== 'string' || !isAddress(value)) throw new HttpError(400, `${field} must be a base58 Solana address`);
  return value;
}

export async function issueSignIn(store: Store, address: string, now = new Date()): Promise<SignInInput> {
  assertAddress(address);
  const nonce = getBase58Decoder().decode(randomBytes(16));
  const input: SignInInput = {
    domain: siwsDomain(),
    address,
    statement: SIWS_STATEMENT,
    uri: baseUrl(),
    version: '1',
    chainId: SIWS_CHAIN,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
  };
  await store.createNonce(nonce, address, input, new Date(now.getTime() + CHALLENGE_TTL_MS));
  return input;
}

const FIELDS: (keyof SignInInput)[] = [
  'domain',
  'address',
  'statement',
  'uri',
  'version',
  'chainId',
  'nonce',
  'issuedAt',
  'expirationTime',
];

const fromB64 = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.length === 0) throw new HttpError(400, `${field} must be base64`);
  return new Uint8Array(Buffer.from(value, 'base64'));
};

/** Returns the signed-in address, or throws 401. The nonce is burned on the first attempt. */
export async function verifySignIn(store: Store, input: SignInInput, output: SignInOutput): Promise<Address> {
  if (!input || typeof input.nonce !== 'string') throw new HttpError(400, 'input.nonce is required');
  const address = assertAddress(output?.address, 'output.address');
  const issued = await store.consumeNonce(input.nonce);
  if (!issued) throw new HttpError(401, 'unknown, used or expired nonce');
  const expected = issued.input as SignInInput;
  if (FIELDS.some((k) => expected[k] !== input[k])) throw new HttpError(401, 'input does not match the issued challenge');
  if (address !== issued.address) throw new HttpError(401, 'signed by a different wallet than the challenge');
  if (Date.parse(expected.expirationTime) <= Date.now()) throw new HttpError(401, 'challenge expired');

  const ok = verifySiws(expected, {
    account: {
      address,
      publicKey: new Uint8Array(getAddressEncoder().encode(address)),
      chains: [SIWS_CHAIN],
      features: [],
    },
    signedMessage: fromB64(output.signedMessage, 'output.signedMessage'),
    signature: fromB64(output.signature, 'output.signature'),
  });
  if (!ok) throw new HttpError(401, 'invalid sign-in signature');
  await store.markSignedIn(address);
  return address;
}

export async function issueSession(address: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(address)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(jwtSecret());
}

/** The bearer token's wallet, or null when absent or invalid. */
export async function sessionAddress(req: Request): Promise<Address | null> {
  const header = req.headers.get('authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { issuer: ISSUER, algorithms: ['HS256'] });
    return payload.sub && isAddress(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function requireUser(req: Request): Promise<Address> {
  const address = await sessionAddress(req);
  if (!address) throw new HttpError(401, 'sign in first');
  return address;
}
