/**
 * House rain: keeps the public feed stocked for people who install the app long after launch.
 * When fewer than HOUSE_RAIN_MIN_LIVE public packets are live, the faucet key drops one Lucky,
 * open, Seeker-only packet of tSKR (at most one per HOUSE_RAIN_EVERY_MIN, claimed in the
 * database before sending). It runs as a crank step and is off unless HOUSE_RAIN_ENABLED is set.
 */
import { address as toAddress, type Address, type Instruction, type KeyPairSigner } from '@solana/kit';
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token';
import { buildCreatePacket, fetchMaybeConfig, findConfigPda, messageHash } from '@bao/sdk';
import { getMintTestTokenInstructions } from '@bao/sdk/devnet-admin';
import { CLAIM_SIZE, CROWN_SIZE, PACKET_SIZE } from './chain';
import type { Store } from './db';
import { env } from './env';
import { syncPacket } from './indexer';
import { errorMessage, log } from './log';
import { sendAndConfirm, type SolanaRpc } from './rpc';
import { tokenMeta } from './tokens';

export const HOUSE_LABEL = 'Bao';
export const HOUSE_MESSAGE = 'Bao house rain';
export const HOUSE_EXPIRES_IN = 24n * 3_600n;

/** Sizes and allowances `create_packet` funds (programs/bao/src/gas.rs, constants.rs). */
const TOKEN_ACCOUNT_SIZE = 165;
const ATA_SPACE_BUDGET = 200;
const VRF_FEE_ALLOWANCE = 1_000_000n;
/** Signature fees with room to spare. */
const TX_FEES = 20_000n;

export interface HouseRainConfig {
  enabled: boolean;
  minLive: number;
  /** tSKR base units per packet. */
  total: bigint;
  shares: number;
  everySecs: number;
  /** The faucet never drops below this many lamports. */
  minSolLamports: bigint;
  mint: Address;
}

export function houseRainConfig(): HouseRainConfig {
  const e = env();
  return {
    enabled: e.HOUSE_RAIN_ENABLED,
    minLive: e.HOUSE_RAIN_MIN_LIVE,
    total: e.HOUSE_RAIN_TSKR,
    shares: e.HOUSE_RAIN_SHARES,
    everySecs: e.HOUSE_RAIN_EVERY_MIN * 60,
    minSolLamports: e.HOUSE_RAIN_MIN_SOL_LAMPORTS,
    mint: toAddress(e.TSKR_MINT),
  };
}

export interface HouseRainDeps {
  store: Store;
  rpc: SolanaRpc;
  /** The house sender (FAUCET_KEYPAIR). */
  faucet: KeyPairSigner | null;
  /** tSKR mint authority (MINT_AUTHORITY_KEYPAIR); tops the faucet's tSKR up when short. */
  authority: KeyPairSigner | null;
  config?: HouseRainConfig;
  send?: typeof sendAndConfirm;
  now?: () => number;
  /** Packet account reads after the drop before the known fields are mirrored instead. */
  indexRetry?: { attempts: number; delayMs: number };
}

export type HouseRainSkip = 'disabled' | 'no_key' | 'enough_live' | 'rate_limited' | 'paused' | 'low_sol' | 'no_tskr' | 'budget';

export type HouseRainResult =
  | { action: 'dropped'; packet: string; signature: string; live: number; minted: string | null }
  | { action: 'skipped'; reason: HouseRainSkip; live?: number };

/**
 * Lamports one drop takes from the faucet: what `create_packet` locks (packet and vault rent, the
 * GasTank budget of gas.rs), two token accounts in case the faucet's or the treasury's is missing,
 * and fees. Most of it comes back when the crank closes the packet.
 */
export async function dropCostLamports(rpc: SolanaRpc, shares: number, crankReward: bigint): Promise<bigint> {
  const [packet, token, claim, ata, crown, empty] = await Promise.all(
    [PACKET_SIZE, TOKEN_ACCOUNT_SIZE, CLAIM_SIZE, ATA_SPACE_BUDGET, CROWN_SIZE, 0].map((bytes) =>
      rpc.getMinimumBalanceForRentExemption(BigInt(bytes)).send(),
    ),
  );
  const gasTank = (claim + ata + VRF_FEE_ALLOWANCE) * BigInt(shares) + crown + crankReward + empty;
  return packet + token + gasTank + 2n * token + TX_FEES;
}

export async function runHouseRain(deps: HouseRainDeps): Promise<HouseRainResult> {
  const cfg = deps.config ?? houseRainConfig();
  if (!cfg.enabled) return { action: 'skipped', reason: 'disabled' };
  const faucet = deps.faucet;
  if (!faucet) {
    log.once('house_rain.no_key', { note: 'FAUCET_KEYPAIR unset; house rain skipped' });
    return { action: 'skipped', reason: 'no_key' };
  }
  // one signer object per address, or the transaction refuses to sign
  const authority = deps.authority?.address === faucet.address ? faucet : deps.authority;
  const { store, rpc } = deps;
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();

  const live = await store.liveOpenPackets(now);
  if (live >= cfg.minLive) return { action: 'skipped', reason: 'enough_live', live };
  const last = (await store.houseRain())?.claimedAt ?? null;
  if (last !== null && last > now - cfg.everySecs) return { action: 'skipped', reason: 'rate_limited', live };

  const [configPda] = await findConfigPda();
  const config = await fetchMaybeConfig(rpc, configPda, { commitment: 'confirmed' });
  if (!config.exists) throw new Error(`program config ${configPda} not found`);
  if (config.data.paused) return { action: 'skipped', reason: 'paused', live };

  const cost = await dropCostLamports(rpc, cfg.shares, config.data.crankRewardLamports);
  const { value: sol } = await rpc.getBalance(faucet.address, { commitment: 'confirmed' }).send();
  if (sol < cost + cfg.minSolLamports) {
    log.once('house_rain.low_sol', { faucet: faucet.address, lamports: sol, needed: cost + cfg.minSolLamports });
    return { action: 'skipped', reason: 'low_sol', live };
  }

  // open packets pay the protocol fee on top of the deposit
  const needed = cfg.total + (cfg.total * BigInt(config.data.feeBps)) / 10_000n;
  const [faucetToken] = await findAssociatedTokenPda({ owner: faucet.address, mint: cfg.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const held = await fetchMaybeToken(rpc, faucetToken, { commitment: 'confirmed' });
  const balance = held.exists ? held.data.amount : 0n;
  const shortfall = balance < needed ? needed - balance : 0n;
  if (shortfall > 0n && !authority) {
    log.once('house_rain.no_tskr', { note: 'faucet tSKR is short and MINT_AUTHORITY_KEYPAIR is unset', balance, needed });
    return { action: 'skipped', reason: 'no_tskr', live };
  }

  if (!(await store.claimHouseRain(now, cfg.everySecs))) return { action: 'skipped', reason: 'rate_limited', live };

  const instructions: Instruction[] = [];
  if (shortfall > 0n) {
    // the faucet key is the tSKR mint authority: top up in the same transaction as the drop
    const mint = await getMintTestTokenInstructions({ authority: authority!, mint: cfg.mint, owner: faucet.address, amount: shortfall });
    instructions.push(...mint.instructions);
  }
  const [treasuryToken] = await findAssociatedTokenPda({ owner: config.data.treasury, mint: cfg.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  instructions.push(
    getCreateAssociatedTokenIdempotentInstruction({ payer: faucet, ata: treasuryToken, owner: config.data.treasury, mint: cfg.mint }),
  );
  const created = await buildCreatePacket({
    sender: faucet,
    mint: cfg.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    treasury: config.data.treasury,
    total: cfg.total,
    shares: cfg.shares,
    mode: 'lucky',
    audience: { kind: 'open' },
    seekerOnly: true,
    expiresIn: HOUSE_EXPIRES_IN,
    message: HOUSE_MESSAGE,
    maxFeeBps: config.data.feeBps,
  });
  instructions.push(...created.instructions);

  const signature = await (deps.send ?? sendAndConfirm)(rpc, instructions, faucet);
  const packet = created.packet as string;
  await store.recordHouseRain(now, packet, signature);
  await store.setLabel(faucet.address, HOUSE_LABEL);
  log.info('house_rain.dropped', { packet, signature, live, minted: shortfall });
  try {
    await indexDrop(deps, { packet, id: created.id, signature, now, cfg, sender: faucet.address });
  } catch (e) {
    // the packet is on chain either way; the indexer mirrors it on its next pass
    log.warn('house_rain.index_failed', { packet, error: errorMessage(e) });
  }
  return { action: 'dropped', packet, signature, live, minted: shortfall > 0n ? shortfall.toString() : null };
}

/** Mirrors the new packet now (not a minute later), adds its message, and marks it as the house's. */
async function indexDrop(
  deps: HouseRainDeps,
  d: { packet: string; id: bigint; signature: string; now: number; cfg: HouseRainConfig; sender: Address },
) {
  const { store, rpc } = deps;
  const retry = deps.indexRetry ?? { attempts: 5, delayMs: 1_500 };
  let found = false;
  for (let i = 0; i < retry.attempts && !found; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, retry.delayMs));
    found = (await syncPacket({ store, rpc, now: deps.now }, d.packet)).found;
  }
  if (!found) {
    // the node has not served the account yet: mirror what was sent; the indexer corrects it later
    await store.insertPacketIfMissing(
      {
        address: d.packet,
        sender: d.sender,
        packetId: d.id.toString(),
        mint: d.cfg.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        decimals: tokenMeta(d.cfg.mint).decimals,
        totalAmount: d.cfg.total.toString(),
        remainingAmount: d.cfg.total.toString(),
        totalShares: d.cfg.shares,
        mode: 'lucky',
        audience: 'open',
        seekerOnly: true,
        createdAt: d.now,
        startsAt: d.now,
        expiresAt: d.now + Number(HOUSE_EXPIRES_IN),
        messageHash: Buffer.from(messageHash(HOUSE_MESSAGE)).toString('hex'),
        chainRoot: d.packet,
        chainDepth: 0,
        createSignature: d.signature,
      },
      'live',
    );
  }
  await store.setCreateSignature(d.packet, d.signature);
  await store.registerPacket(d.packet, { message: HOUSE_MESSAGE, skin: null, circleId: null, snapshotRoot: null, codeHint: null });
  // no "packet dropped" push to every subscriber for a house rain: take the one-time flag unused
  await store.claimPushFlag(d.packet, 'dropped_push_at');
}
