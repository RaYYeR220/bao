/**
 * Who a wallet is: its `.skr` name and real Seeker Genesis Token (mainnet reads), and the test
 * Genesis token the devnet program checks. Mainnet answers are cached for a day, devnet for minutes.
 */
import { address as toAddress } from '@solana/kit';
import { findGenesisToken, type UserView } from '@bao/sdk';
import type { Store } from './db';
import { env } from './env';
import { errorMessage, log } from './log';
import { devnetRpc, mainnetRpc, type SolanaRpc } from './rpc';
import { resolveSkrName } from './skr';
import type { IdentityRecord } from './types';

const DAY = 86_400;
const DEVNET_TTL = 300;
const READ_TIMEOUT_MS = 6_000;

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface IdentityDeps {
  store: Store;
  mainnet?: SolanaRpc;
  devnet?: SolanaRpc;
  now?: () => number;
}

const stale = (checkedAt: number | null, ttl: number, now: number) => checkedAt === null || now - checkedAt > ttl;

/** Reads (and refreshes when stale) a wallet's identity. Lookup failures keep the cached value. */
export async function identity(deps: IdentityDeps, address: string, opts: { refreshDevnet?: boolean } = {}): Promise<UserView> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const owner = toAddress(address);
  const e = env();
  let row: IdentityRecord | null = await deps.store.getIdentity(address);
  const tasks: Promise<void>[] = [];

  if (stale(row?.skrCheckedAt ?? null, DAY, now)) {
    tasks.push(
      withTimeout(resolveSkrName(deps.mainnet ?? mainnetRpc(), owner, now), READ_TIMEOUT_MS, 'skr lookup')
        .then((name) => deps.store.saveSkr(address, name))
        .catch((err) => log.warn('identity.skr_failed', { address, error: errorMessage(err) })),
    );
  }
  if (stale(row?.seekerCheckedAt ?? null, DAY, now)) {
    tasks.push(
      withTimeout(findGenesisToken(deps.mainnet ?? mainnetRpc(), owner, toAddress(e.MAINNET_GENESIS_GROUP)), READ_TIMEOUT_MS, 'sgt lookup')
        .then((token) => deps.store.saveSeeker(address, token !== null))
        .catch((err) => log.warn('identity.seeker_failed', { address, error: errorMessage(err) })),
    );
  }
  if (opts.refreshDevnet || stale(row?.genesisCheckedAt ?? null, DEVNET_TTL, now)) {
    tasks.push(
      withTimeout(findGenesisToken(deps.devnet ?? devnetRpc(), owner, toAddress(e.GENESIS_GROUP)), READ_TIMEOUT_MS, 'devnet genesis lookup')
        .then((token) => deps.store.saveDevnetGenesis(address, token?.mint ?? null))
        .catch((err) => log.warn('identity.devnet_genesis_failed', { address, error: errorMessage(err) })),
    );
  }
  if (tasks.length > 0) {
    await Promise.all(tasks);
    row = await deps.store.getIdentity(address);
  }
  return {
    address,
    skrName: row?.skrName ?? null,
    seekerOnMainnet: row?.seekerMainnet ?? false,
    devnetGenesisMint: row?.devnetGenesisMint ?? null,
  };
}

/** Resolves `.skr` names for addresses never looked up (bounded, best effort), so lists show names. */
export async function warmSkrNames(deps: IdentityDeps, addresses: string[], max = 8): Promise<void> {
  const unique = [...new Set(addresses.filter(Boolean))];
  if (unique.length === 0) return;
  const rows = await Promise.all(unique.map((a) => deps.store.getIdentity(a)));
  const missing = unique.filter((_a, i) => rows[i]?.skrCheckedAt == null).slice(0, max);
  await Promise.all(
    missing.map((a) =>
      withTimeout(resolveSkrName(deps.mainnet ?? mainnetRpc(), toAddress(a)), READ_TIMEOUT_MS, 'skr lookup')
        .then((name) => deps.store.saveSkr(a, name))
        .catch((err) => log.warn('identity.skr_failed', { address: a, error: errorMessage(err) })),
    ),
  );
}
