/** Devnet JSON-RPC pass-through so the app can use the server's Helius key without shipping it. */
import { BAO_PROGRAM_ADDRESS } from '@bao/sdk';
import { devnetUrl } from './rpc';
import { HttpError } from './types';

/**
 * Reads and simulation only. The app never sends through here: the wallet signs and sends
 * (Mobile Wallet Adapter), and the server's own transactions go straight to the RPC.
 */
export const PROXY_METHODS = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getEpochInfo',
  'getFeeForMessage',
  'getGenesisHash',
  'getHealth',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getRecentPrioritizationFees',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTransaction',
  'getVersion',
  'isBlockhashValid',
  'simulateTransaction',
]);

const MAX_BATCH = 20;

export function checkRpcBody(body: unknown): void {
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) throw new HttpError(400, `send 1-${MAX_BATCH} JSON-RPC calls`);
  for (const call of calls) {
    const { method, params } = (call ?? {}) as { method?: unknown; params?: unknown };
    if (typeof method !== 'string' || !PROXY_METHODS.has(method)) throw new HttpError(400, `method not allowed: ${String(method)}`);
    // an account scan is the one heavy read: only Bao's own program (the app's on-chain feed and history)
    if (method === 'getProgramAccounts' && (!Array.isArray(params) || params[0] !== BAO_PROGRAM_ADDRESS)) {
      throw new HttpError(400, 'method not allowed: getProgramAccounts outside the Bao program');
    }
  }
}

export async function proxyRpc(body: unknown, fetcher: typeof fetch = fetch): Promise<Response> {
  checkRpcBody(body);
  const upstream = await fetcher(devnetUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
