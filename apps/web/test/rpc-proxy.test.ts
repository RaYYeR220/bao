import { describe, expect, it } from 'vitest';
import { checkRpcBody, proxyRpc } from '@/lib/rpc-proxy';

describe('devnet rpc proxy', () => {
  it('allows reads and sends, refuses everything else', () => {
    expect(() => checkRpcBody({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' })).not.toThrow();
    expect(() => checkRpcBody([{ method: 'getBalance' }, { method: 'sendTransaction' }])).not.toThrow();
    expect(() => checkRpcBody({ method: 'getProgramAccounts' })).toThrow(/not allowed/);
    expect(() => checkRpcBody([])).toThrow();
    expect(() => checkRpcBody(null)).toThrow();
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
});
