/**
 * Solana RPC access. Devnet carries every money movement; mainnet is only read (identity).
 * Confirmations are polled over HTTP: serverless functions cannot hold websockets.
 */
import { setDefaultResultOrder } from 'node:dns';
import {
  appendTransactionMessageInstructions,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type TransactionSigner,
} from '@solana/kit';
import { env } from './env';
import { log } from './log';

// Some networks advertise IPv6 routes that never connect; prefer IPv4.
setDefaultResultOrder('ipv4first');

export type SolanaRpc = Rpc<SolanaRpcApi>;

export function devnetUrl(): string {
  const e = env();
  if (e.DEVNET_RPC_URL) return e.DEVNET_RPC_URL;
  if (e.HELIUS_API_KEY) return `https://devnet.helius-rpc.com/?api-key=${e.HELIUS_API_KEY}`;
  log.once('rpc.devnet_public', { note: 'HELIUS_API_KEY unset; using the rate-limited public devnet RPC' });
  return 'https://api.devnet.solana.com';
}

export function mainnetUrl(): string {
  const e = env();
  if (e.MAINNET_RPC_URL) return e.MAINNET_RPC_URL;
  if (e.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${e.HELIUS_API_KEY}`;
  log.once('rpc.mainnet_public', { note: 'HELIUS_API_KEY unset; using the public mainnet RPC for identity reads' });
  return 'https://api.mainnet-beta.solana.com';
}

const RETRIABLE = /429|Too Many Requests|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|502|503|504/i;

export function createRpc(url: string, maxAttempts = 6): SolanaRpc {
  const base = createDefaultRpcTransport({ url });
  const transport: typeof base = async (config) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await base(config);
      } catch (e) {
        const text = String((e as Error)?.message ?? e) + String((e as { cause?: unknown })?.cause ?? '');
        if (!RETRIABLE.test(text) || attempt >= maxAttempts) throw e;
        await new Promise((r) => setTimeout(r, Math.min(8_000, 400 * 2 ** attempt)));
      }
    }
  };
  return createSolanaRpcFromTransport(transport);
}

let devnet: SolanaRpc | null = null;
let mainnet: SolanaRpc | null = null;

export const devnetRpc = () => (devnet ??= createRpc(devnetUrl()));
export const mainnetRpc = () => (mainnet ??= createRpc(mainnetUrl(), 3));

export function setRpcs(r: { devnet?: SolanaRpc | null; mainnet?: SolanaRpc | null }) {
  if (r.devnet !== undefined) devnet = r.devnet;
  if (r.mainnet !== undefined) mainnet = r.mainnet;
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export async function waitForConfirmation(rpc: SolanaRpc, signature: Signature, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err, bigintSafe)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return status;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`transaction ${signature} not confirmed after ${Math.round(timeoutMs / 1000)}s`);
}

export const bigintSafe = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** Signs with every signer attached to the instructions, sends, and polls until confirmed. */
export async function sendAndConfirm(
  rpc: SolanaRpc,
  instructions: Instruction[],
  feePayer: TransactionSigner,
  opts: { skipPreflight?: boolean; timeoutMs?: number } = {},
): Promise<Signature> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(tx);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: 'base64',
      preflightCommitment: 'confirmed',
      skipPreflight: opts.skipPreflight ?? false,
    })
    .send();
  await waitForConfirmation(rpc, signature, opts.timeoutMs);
  return signature;
}

/** Program logs of a failed simulation, when the RPC returned them. */
export function simulationLogs(e: unknown): string[] {
  const ctx = (e as { context?: { logs?: string[] }; cause?: { context?: { logs?: string[] } } }) ?? {};
  return ctx.context?.logs ?? ctx.cause?.context?.logs ?? [];
}
