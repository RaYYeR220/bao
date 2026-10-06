/**
 * Solana Actions: any Actions-aware wallet or site can grab a Bao packet. The POST returns an
 * unsigned grab transaction with the grabber as fee payer.
 */
import {
  address as toAddress,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  isAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { buildGrab, fetchMaybeClaimRecord, fetchMaybePacket, findClaimPda, findGenesisToken, hexToBytes } from '@bao/sdk';
import { packetStatus, modeName } from './chain';
import { proofFor } from './circles';
import type { Store } from './db';
import { baseUrl } from './env';
import { json } from './http';
import type { SolanaRpc } from './rpc';
import { formatUi, tokenMeta } from './tokens';
import { HttpError } from './types';

export const DEVNET_CHAIN_ID = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export const ACTIONS_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': '2.4',
  'X-Blockchain-Ids': DEVNET_CHAIN_ID,
};

export const actionJson = (data: unknown, status = 200) => json(data, status, ACTIONS_CORS);
export const actionError = (e: unknown) =>
  actionJson({ message: e instanceof HttpError ? e.message : 'Something went wrong' }, e instanceof HttpError ? e.status : 500);

async function loadPacket(rpc: SolanaRpc, packet: string) {
  if (!isAddress(packet)) throw new HttpError(400, 'not a packet address');
  const account = await fetchMaybePacket(rpc, toAddress(packet), { commitment: 'confirmed' });
  if (!account.exists) throw new HttpError(404, 'This packet is gone (closed or never existed)');
  return account.data;
}

export async function grabActionMetadata(rpc: SolanaRpc, packet: string, now = Math.floor(Date.now() / 1000)) {
  const p = await loadPacket(rpc, packet);
  const meta = tokenMeta(p.mint);
  const status = packetStatus(
    { startsAt: Number(p.startsAt), expiresAt: Number(p.expiresAt), reserved: p.reserved, totalShares: p.totalShares },
    now,
  );
  const left = p.totalShares - p.reserved;
  const base = baseUrl();
  const href = `${base}/api/actions/grab/${packet}`;
  const isCode = p.audience.__kind === 'Code';
  return {
    type: 'action',
    icon: `${base}/p/${packet}/opengraph-image`,
    title: `Red packet: ${formatUi(p.totalAmount, meta.decimals)} ${meta.symbol}`,
    description:
      `${left} of ${p.totalShares} shares left · ${modeName(p.mode) === 'lucky' ? 'lucky split' : 'equal split'}` +
      (p.seekerOnly ? ' · Seeker Genesis Token required (one grab per device)' : ''),
    label: 'Grab',
    ...(status !== 'live' ? { disabled: true, error: { message: `This packet is ${status}` } } : {}),
    links: {
      actions: isCode
        ? [
            {
              type: 'transaction',
              label: 'Grab',
              href: `${href}?code={code}`,
              parameters: [{ name: 'code', label: 'Code word', required: true }],
            },
          ]
        : [{ type: 'transaction', label: 'Grab', href }],
    },
  };
}

export async function buildGrabTransaction(
  deps: { store: Store; rpc: SolanaRpc },
  packet: string,
  account: string,
  code?: string | null,
  now = Math.floor(Date.now() / 1000),
) {
  if (!isAddress(account)) throw new HttpError(400, 'account must be a wallet address');
  const p = await loadPacket(deps.rpc, packet);
  const status = packetStatus(
    { startsAt: Number(p.startsAt), expiresAt: Number(p.expiresAt), reserved: p.reserved, totalShares: p.totalShares },
    now,
  );
  if (status !== 'live') throw new HttpError(400, `This packet is ${status}`);

  const claimer = toAddress(account);
  const genesis = p.seekerOnly ? await findGenesisToken(deps.rpc, claimer, p.sgtGroup) : null;
  if (p.seekerOnly && !genesis) {
    throw new HttpError(403, 'Seeker-only packet: this wallet holds no Seeker Genesis Token (on devnet, get a test one from the Bao faucet)');
  }
  const [claim] = await findClaimPda(toAddress(packet), genesis?.mint ?? claimer);
  if ((await fetchMaybeClaimRecord(deps.rpc, claim)).exists) throw new HttpError(409, 'This device already grabbed this packet');

  let proof: Uint8Array[] = [];
  if (p.audience.__kind === 'Circle') proof = (await proofFor(deps.store, deps.rpc, packet, account)).map(hexToBytes);
  if (p.audience.__kind === 'Code' && !code) throw new HttpError(400, 'This packet needs its code word');

  const { instruction } = await buildGrab({
    claimer: createNoopSigner(claimer),
    packet: { address: toAddress(packet), mint: p.mint, tokenProgram: p.tokenProgram, mode: modeName(p.mode), seekerOnly: p.seekerOnly },
    genesis,
    proof,
    code: p.audience.__kind === 'Code' ? (code ?? undefined) : undefined,
  });
  const { value: blockhash } = await deps.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(claimer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );
  return {
    type: 'transaction',
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    message: modeName(p.mode) === 'lucky' ? 'Grabbed! Your share is revealed in a few seconds.' : 'Grabbed!',
  };
}
