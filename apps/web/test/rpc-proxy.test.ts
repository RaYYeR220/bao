import { describe, expect, it } from 'vitest';
import { BAO_PROGRAM_ADDRESS } from '@bao/sdk';
import { PROXY_METHODS, checkRpcBody, proxyRpc } from '@/lib/rpc-proxy';

/** Every JSON-RPC method the Android app calls (apps/mobile/src and the SDK readers it uses). */
const APP_METHODS = [
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getLatestBlockhash',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getTokenAccountsByOwner',
  'simulateTransaction',
];

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

describe('devnet rpc proxy', () => {
  it('allows reads and simulation, refuses sends and everything else', () => {
    expect(() => checkRpcBody({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' })).not.toThrow();
    expect(() => checkRpcBody([{ method: 'getBalance' }, { method: 'simulateTransaction' }])).not.toThrow();
    expect(() => checkRpcBody({ method: 'sendTransaction' })).toThrow(/not allowed/);
    expect(() => checkRpcBody({ method: 'requestAirdrop' })).toThrow(/not allowed/);
    expect(() => checkRpcBody([{ method: 'getBalance' }, { method: 'sendTransaction' }])).toThrow(/not allowed/);
    expect(() => checkRpcBody([])).toThrow();
    expect(() => checkRpcBody(null)).toThrow();
    expect(() => checkRpcBody([null])).toThrow(/not allowed/);
  });

  it('covers every method the app calls', () => {
    for (const method of APP_METHODS) expect(PROXY_METHODS.has(method), method).toBe(true);
    const batch = APP_METHODS.map((method, id) => ({ jsonrpc: '2.0', id, method, params: [BAO_PROGRAM_ADDRESS] }));
    expect(() => checkRpcBody(batch)).not.toThrow();
  });

  it('scans program accounts for the Bao program only', () => {
    const scan = (...params: unknown[]) => ({ jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params });
    expect(() => checkRpcBody(scan(BAO_PROGRAM_ADDRESS, { encoding: 'base64', filters: [] }))).not.toThrow();
    expect(() => checkRpcBody(scan(TOKEN_PROGRAM, { encoding: 'base64' }))).toThrow(/not allowed/);
    expect(() => checkRpcBody(scan())).toThrow(/not allowed/);
    expect(() => checkRpcBody({ method: 'getProgramAccounts' })).toThrow(/not allowed/);
    expect(() => checkRpcBody({ method: 'getProgramAccounts', params: { programId: BAO_PROGRAM_ADDRESS } })).toThrow(/not allowed/);
    expect(() => checkRpcBody([{ method: 'getSlot' }, scan(TOKEN_PROGRAM)])).toThrow(/not allowed/);
  });

  it('takes batches up to 20 calls', () => {
    const calls = (n: number) => Array.from({ length: n }, (_, id) => ({ jsonrpc: '2.0', id, method: 'getSlot' }));
    expect(() => checkRpcBody(calls(20))).not.toThrow();
    expect(() => checkRpcBody(calls(21))).toThrow(/1-20/);
  });

  it('forwards the call to the configured devnet endpoint', async () => {
    let seen: { url: string; body: string } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return new Response('{"jsonrpc":"2.0","id":1,"result":42}');
    }) as typeof fetch;
    const res = await proxyRpc({ jsonrpc: '2.0', id: 1, method: 'getSlot' }, fetcher);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: 42 });
    expect(seen!.url).toContain('devnet');
    expect(JSON.parse(seen!.body).method).toBe('getSlot');
  });

  it('forwards a batch as one upstream request', async () => {
    const bodies: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response('[{"jsonrpc":"2.0","id":1,"result":1},{"jsonrpc":"2.0","id":2,"result":2}]');
    }) as typeof fetch;
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'getSlot' },
      { jsonrpc: '2.0', id: 2, method: 'getBlockHeight' },
    ];
    const res = await proxyRpc(batch, fetcher);
    expect(await res.json()).toHaveLength(2);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0])).toEqual(batch);
  });

  // the app tells a proxy failure (it falls back to the public endpoint) from a cluster answer by the HTTP status
  it('passes the upstream status and body through untouched', async () => {
    const limited = (async () => new Response('{"jsonrpc":"2.0","error":{"code":-32429,"message":"rate limited"}}', { status: 429 })) as typeof fetch;
    const res = await proxyRpc({ jsonrpc: '2.0', id: 1, method: 'getSlot' }, limited);
    expect(res.status).toBe(429);

    const refused = '{"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid param: Invalid"},"id":1}';
    const answered = await proxyRpc({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['x'] }, (async () => new Response(refused)) as typeof fetch);
    expect(answered.status).toBe(200);
    expect(await answered.text()).toBe(refused);
  });

  it('never reaches the endpoint with a refused call', async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch;
    await expect(proxyRpc({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: ['AAAA'] }, fetcher)).rejects.toMatchObject({ status: 400 });
    expect(called).toBe(false);
  });
});
