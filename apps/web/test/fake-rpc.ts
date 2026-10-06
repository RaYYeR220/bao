import type { SolanaRpc } from '@/lib/rpc';

type Handler = (...args: unknown[]) => unknown;

/** An RPC whose methods are plain functions; unknown methods throw so tests notice. */
export function fakeRpc(handlers: Record<string, Handler>): SolanaRpc & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  return new Proxy({ calls } as never, {
    get(target, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'then') return undefined;
      return (...args: unknown[]) => ({
        send: async () => {
          calls.push({ method: String(prop), args });
          const h = handlers[String(prop)];
          if (!h) throw new Error(`fake rpc: ${String(prop)} not stubbed`);
          return h(...args);
        },
      });
    },
  });
}

export const base64Account = (data: string, owner = '11111111111111111111111111111111') => ({
  data: [data, 'base64'] as const,
  executable: false,
  lamports: 1_000_000n,
  owner,
  rentEpoch: 0n,
  space: BigInt(Buffer.from(data, 'base64').length),
});

/** On-chain packet accounts are allocated at their maximum size; pad compact encodings to match. */
export function packetBytes(encoded: ArrayLike<number>, size = 379): string {
  const out = new Uint8Array(size);
  out.set(Uint8Array.from(encoded));
  return Buffer.from(out).toString('base64');
}
