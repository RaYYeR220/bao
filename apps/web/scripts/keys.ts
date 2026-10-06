/**
 * Creates the server keypairs (keys/faucet.json, keys/crank.json — gitignored) if missing and
 * tops each up to 0.5 devnet SOL from the local Solana CLI wallet.
 *   pnpm --filter web keys
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKeyPairSignerFromBytes, generateKeyPair, lamports } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { createRpc, devnetUrl, sendAndConfirm } from '../src/lib/rpc';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TARGET = 500_000_000n;

async function loadOrCreate(path: string) {
  if (!existsSync(path)) {
    const pair = await generateKeyPair(true);
    const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).slice(-32);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...priv, ...pub]));
    console.log(`created ${path}`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))));
}

async function main() {
  const rpc = createRpc(devnetUrl());
  const payer = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(readFileSync(process.env.SOLANA_WALLET ?? `${homedir()}/.config/solana/id.json`, 'utf8'))),
  );
  for (const name of ['faucet', 'crank']) {
    const signer = await loadOrCreate(resolve(ROOT, 'keys', `${name}.json`));
    const { value } = await rpc.getBalance(signer.address).send();
    if (value < TARGET) {
      const sig = await sendAndConfirm(
        rpc,
        [getTransferSolInstruction({ source: payer, destination: signer.address, amount: lamports(TARGET - value) })],
        payer,
      );
      console.log(`${name} ${signer.address}: topped up to 0.5 SOL (${sig})`);
    } else {
      console.log(`${name} ${signer.address}: ${Number(value) / 1e9} SOL`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
