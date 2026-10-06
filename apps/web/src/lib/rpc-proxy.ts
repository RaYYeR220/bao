/** Devnet JSON-RPC pass-through so the app can use the server's Helius key without shipping it. */
import { devnetUrl } from './rpc';
import { HttpError } from './types';

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
  'getRecentPrioritizationFees',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTransaction',
  'getVersion',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction',
]);

const MAX_BATCH = 20;

export function checkRpcBody(body: unknown): void {
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) throw new HttpError(400, `send 1-${MAX_BATCH} JSON-RPC calls`);
  for (const call of calls) {
    const method = (call as { method?: unknown } | null)?.method;
    if (typeof method !== 'string' || !PROXY_METHODS.has(method)) throw new HttpError(400, `method not allowed: ${String(method)}`);
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
