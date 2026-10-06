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

/** After a failed lookup (rate limit, timeout) wait before trying that wallet again. */
const FAILURE_BACKOFF_SECS = 600;
const failedAt = new Map<string, number>();
const backingOff = (key: string, now: number) => (failedAt.get(key) ?? -Infinity) > now - FAILURE_BACKOFF_SECS;
const noteFailure = (key: string, now: number) => {
  failedAt.set(key, now);
  if (failedAt.size > 10_000) failedAt.clear();
};

export function resetIdentityBackoff() {
  failedAt.clear();
}

/** Reads (and refreshes when stale) a wallet's identity. Lookup failures keep the cached value. */
export async function identity(deps: IdentityDeps, address: string, opts: { refreshDevnet?: boolean } = {}): Promise<UserView> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const owner = toAddress(address);
  const e = env();
  let row: IdentityRecord | null = await deps.store.getIdentity(address);
  const tasks: Promise<void>[] = [];

  const lookup = (key: string, run: () => Promise<void>) => {
    if (backingOff(`${key}:${address}`, now)) return;
    tasks.push(
      run().catch((err) => {
        noteFailure(`${key}:${address}`, now);
        log.warn(`identity.${key}_failed`, { address, error: errorMessage(err) });
      }),
    );
  };
  if (stale(row?.skrCheckedAt ?? null, DAY, now)) {
    lookup('skr', async () => {
      const name = await withTimeout(resolveSkrName(deps.mainnet ?? mainnetRpc(), owner, now), READ_TIMEOUT_MS, 'skr lookup');
      await deps.store.saveSkr(address, name);
    });
  }
  if (stale(row?.seekerCheckedAt ?? null, DAY, now)) {
    lookup('seeker', async () => {
      const group = toAddress(e.MAINNET_GENESIS_GROUP);
      const token = await withTimeout(findGenesisToken(deps.mainnet ?? mainnetRpc(), owner, group), READ_TIMEOUT_MS, 'sgt lookup');
      await deps.store.saveSeeker(address, token !== null);
    });
  }
  if (opts.refreshDevnet || stale(row?.genesisCheckedAt ?? null, DEVNET_TTL, now)) {
    lookup('devnet_genesis', async () => {
      const group = toAddress(e.GENESIS_GROUP);
      const token = await withTimeout(findGenesisToken(deps.devnet ?? devnetRpc(), owner, group), READ_TIMEOUT_MS, 'devnet genesis lookup');
      await deps.store.saveDevnetGenesis(address, token?.mint ?? null);
    });
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
  const now = Math.floor(Date.now() / 1000);
  const missing = unique.filter((a, i) => rows[i]?.skrCheckedAt == null && !backingOff(`skr:${a}`, now)).slice(0, max);
  await Promise.all(
    missing.map((a) =>
      withTimeout(resolveSkrName(deps.mainnet ?? mainnetRpc(), toAddress(a)), READ_TIMEOUT_MS, 'skr lookup')
        .then((name) => deps.store.saveSkr(a, name))
        .catch((err) => {
          noteFailure(`skr:${a}`, now);
          log.warn('identity.skr_failed', { address: a, error: errorMessage(err) });
        }),
    ),
  );
}
