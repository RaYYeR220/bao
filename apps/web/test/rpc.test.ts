import { SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, SolanaError } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { isRetriable } from '@/lib/rpc';

describe('rpc retries', () => {
  it('retries rate limits and gateway errors, by status or by message', () => {
    const http = (statusCode: number) =>
      new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: 'x', statusCode });
    expect(isRetriable(http(429))).toBe(true);
    expect(isRetriable(http(503))).toBe(true);
    expect(isRetriable(http(400))).toBe(false);
    expect(isRetriable(new TypeError('fetch failed'))).toBe(true);
    expect(isRetriable(new Error('custom program error: 0x1'))).toBe(false);
  });
});
