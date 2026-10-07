/**
 * Solana Actions: any Actions-aware wallet or site can grab a Bao packet, or drop a public one.
 * Each POST returns an unsigned transaction with the caller as fee payer.
 */
import {
  address as toAddress,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  isAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, fetchMaybeToken, findAssociatedTokenPda } from '@solana-program/token';
import {
  buildCreatePacket,
  buildGrab,
  fetchMaybeClaimRecord,
  fetchMaybeConfig,
  findClaimPda,
  findConfigPda,
  findGenesisToken,
  hexToBytes,
} from '@bao/sdk';
import { fetchPacketAccount, modeName, packetStatus } from './chain';
import { proofFor } from './circles';
import type { Store } from './db';
import { baseUrl, env } from './env';
import { json } from './http';
import { errorMessage, log } from './log';
import type { SolanaRpc } from './rpc';
import { formatUi, parseUi, tokenMeta } from './tokens';
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
  const account = await fetchPacketAccount(rpc, toAddress(packet));
  if (!account) throw new HttpError(404, 'This packet is gone (closed or never existed)');
  return account;
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

// ---------- create ----------

/** Bounds `create_packet` enforces (programs/bao/src/constants.rs and instructions/create_packet.rs). */
export const MAX_SHARES = 200;
export const MIN_EXPIRY_SECS = 3_600n;
export const MAX_EXPIRY_SECS = 7n * 86_400n;
const U64_MAX = 2n ** 64n - 1n;
/** How long a packet dropped through the Action stays open. */
export const CREATE_EXPIRES_IN = 24n * 3_600n;

export interface CreateActionInput {
  /** tSKR as a decimal string ("88", "12.5"). */
  amount: string | null | undefined;
  shares: string | null | undefined;
  mode: string | null | undefined;
}

/** Checks the three inputs against the program's bounds; throws a 400 naming the field. */
export function parseCreateInput(input: CreateActionInput, decimals: number) {
  const unit = formatUi(1n, decimals, decimals);
  const total = parseUi(input.amount ?? '', decimals);
  if (total === null) throw new HttpError(400, `amount: a number of tSKR with at most ${decimals} decimals, for example 88`);
  if (total <= 0n) throw new HttpError(400, 'amount: must be more than 0');
  if (total > U64_MAX) throw new HttpError(400, 'amount: too large for a packet');
  const sharesText = (input.shares ?? '').trim();
  const shares = /^\d{1,4}$/.test(sharesText) ? Number(sharesText) : NaN;
  if (!(shares >= 1 && shares <= MAX_SHARES)) throw new HttpError(400, `shares: a whole number from 1 to ${MAX_SHARES}`);
  // the program needs one base unit per share, so no share can be 0
  if (total < BigInt(shares)) throw new HttpError(400, `amount: at least ${unit} tSKR for each of the ${shares} shares`);
  const mode = (input.mode ?? 'lucky').trim().toLowerCase();
  if (mode !== 'lucky' && mode !== 'equal') throw new HttpError(400, 'mode: lucky or equal');
  return { total, shares, mode: mode as 'lucky' | 'equal' };
}

async function loadConfig(rpc: SolanaRpc) {
  const [configPda] = await findConfigPda();
  const config = await fetchMaybeConfig(rpc, configPda, { commitment: 'confirmed' });
  if (!config.exists) throw new HttpError(503, 'The Bao program is not set up on this cluster');
  return config.data;
}

const percent = (bps: number) => `${formatUi(BigInt(bps), 2)}%`;

export async function createActionMetadata(rpc: SolanaRpc) {
  const base = baseUrl();
  const { decimals } = tokenMeta(env().TSKR_MINT);
  let feeBps = 0;
  let paused = false;
  try {
    ({ feeBps, paused } = await loadConfig(rpc));
  } catch (e) {
    // the card still renders; the POST reports the real problem
    log.warn('actions.config_unread', { error: errorMessage(e) });
  }
  return {
    type: 'action',
    icon: `${base}/icon.png`,
    title: 'Drop a red packet',
    description:
      'A public tSKR packet on Solana devnet. A wallet holding a Seeker Genesis Token can grab one share, once per device. ' +
      'What nobody grabs in 24 hours returns to you.' +
      (feeBps > 0 ? ` Public packets pay a ${percent(feeBps)} fee on top.` : ''),
    label: 'Drop',
    ...(paused ? { disabled: true, error: { message: 'New packets are paused right now' } } : {}),
    links: {
      actions: [
        {
          type: 'transaction',
          label: 'Drop the packet',
          href: `${base}/api/actions/create?amount={amount}&shares={shares}&mode={mode}`,
          parameters: [
            { name: 'amount', label: 'Amount in tSKR', type: 'number', required: true, min: Number(formatUi(1n, decimals, decimals)) },
            { name: 'shares', label: `Shares (1 to ${MAX_SHARES})`, type: 'number', required: true, min: 1, max: MAX_SHARES },
            {
              name: 'mode',
              label: 'Split',
              type: 'radio',
              required: true,
              options: [
                { label: 'Lucky: random shares', value: 'lucky', selected: true },
                { label: 'Equal: the same share for everyone', value: 'equal' },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * An unsigned `create_packet` from `account`: a public, Seeker-only tSKR packet that stays open
 * for 24 hours. `max_fee_bps` is the fee read now, so a fee raised before the transaction lands
 * fails it instead of charging more.
 */
export async function buildCreateTransaction(rpc: SolanaRpc, account: string, input: CreateActionInput) {
  if (!isAddress(account)) throw new HttpError(400, 'account must be a wallet address');
  const mint = toAddress(env().TSKR_MINT);
  const { decimals, symbol } = tokenMeta(mint);
  const { total, shares, mode } = parseCreateInput(input, decimals);
  const ui = (base: bigint) => `${formatUi(base, decimals, decimals)} ${symbol}`;

  const config = await loadConfig(rpc);
  if (config.paused) throw new HttpError(409, 'New packets are paused right now');

  // public packets pay the protocol fee on top of the deposit
  const sender = toAddress(account);
  const needed = total + (total * BigInt(config.feeBps)) / 10_000n;
  const [senderToken] = await findAssociatedTokenPda({ owner: sender, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const held = await fetchMaybeToken(rpc, senderToken, { commitment: 'confirmed' });
  const balance = held.exists ? held.data.amount : 0n;
  if (balance < needed) {
    throw new HttpError(
      400,
      `This wallet holds ${ui(balance)}; the packet needs ${ui(needed)}` +
        (needed > total ? ` (${ui(total)} plus the ${percent(config.feeBps)} fee).` : '.') +
        ' On devnet, the Playground in the Bao app gives test tSKR.',
    );
  }

  const created = await buildCreatePacket({
    sender: createNoopSigner(sender),
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    treasury: config.treasury,
    total,
    shares,
    mode,
    audience: { kind: 'open' },
    seekerOnly: true,
    expiresIn: CREATE_EXPIRES_IN,
    maxFeeBps: config.feeBps,
  });
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(sender, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(created.instructions, m),
  );
  return {
    type: 'transaction',
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    message: `Packet sealed: ${ui(total)} in ${shares} ${shares === 1 ? 'share' : 'shares'}. Share it: ${baseUrl()}/p/${created.packet}`,
  };
}
