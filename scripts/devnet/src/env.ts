import { setDefaultResultOrder } from 'node:dns';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
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
  type KeyPairSigner,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';

// Some networks advertise IPv6 routes that never connect; prefer IPv4.
setDefaultResultOrder('ipv4first');

export const RPC_URL = process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com';
const baseTransport = createDefaultRpcTransport({ url: RPC_URL });

/** Public devnet rate-limits aggressively; retry 429s and dropped connections with backoff. */
const retryingTransport: typeof baseTransport = async (config) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await baseTransport(config);
    } catch (e) {
      const text = String((e as Error)?.message ?? e);
      const retriable = text.includes('429') || text.includes('fetch failed') || text.includes('ECONNRESET');
      if (!retriable || attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, Math.min(10_000, 500 * 2 ** attempt)));
    }
  }
};

export const rpc = createSolanaRpcFromTransport(retryingTransport);

export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export async function loadKeypair(path = `${homedir()}/.config/solana/id.json`): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))));
}

async function build(instructions: Instruction[], feePayer: TransactionSigner) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return signTransactionMessageWithSigners(message);
}

/** Polls over HTTP until the signature is confirmed (public devnet websockets drop often). */
async function waitForConfirmation(signature: Signature) {
  for (let i = 0; i < 90; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return status;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`transaction ${signature} not confirmed after 90s`);
}

/** Signs with every signer attached to the instructions, sends with preflight and waits for confirmation. */
export async function send(instructions: Instruction[], feePayer: TransactionSigner): Promise<Signature> {
  const tx = await build(instructions, feePayer);
  const signature = getSignatureFromTransaction(tx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  const status = await waitForConfirmation(signature);
  if (status.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
  return signature;
}

/**
 * Sends without preflight so a transaction the program rejects still lands on-chain,
 * then returns its signature, error and logs (used to record refusals as proof).
 */
export async function sendExpectingFailure(instructions: Instruction[], feePayer: TransactionSigner) {
  const tx = await build(instructions, feePayer);
  const signature = getSignatureFromTransaction(tx);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', skipPreflight: true })
    .send();
  await waitForConfirmation(signature);
  const result = await rpc
    .getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' })
    .send();
  return { signature, err: result?.meta?.err ?? null, logs: result?.meta?.logMessages ?? [] };
}

const OUT = new URL('../../../packages/sdk/src/devnet.json', import.meta.url);

export function readOut(): Record<string, string> {
  return existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
}

export function writeOut(patch: Record<string, string>) {
  writeFileSync(OUT, JSON.stringify({ ...readOut(), ...patch }, null, 2) + '\n');
}

export async function airdropIfLow(address: Parameters<typeof rpc.getBalance>[0], minLamports: bigint, payer: KeyPairSigner) {
  const { value } = await rpc.getBalance(address).send();
  if (value >= minLamports) return;
  const { getTransferSolInstruction } = await import('@solana-program/system');
  await send([getTransferSolInstruction({ source: payer, destination: address, amount: minLamports - value })], payer);
}
