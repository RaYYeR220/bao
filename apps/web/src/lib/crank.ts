/**
 * The crank (`/api/cron/tick`, every minute): pays won lucky shares, cancels grabs whose
 * randomness never came, winds down finished or expired packets (close_claims in batches,
 * then close_packet), sends rain-start pushes, and runs the indexer. Every step is isolated
 * and idempotent; the crank key signs only permissionless instructions.
 */
import { AccountRole, getBase58Decoder, type Address, type Instruction, type KeyPairSigner } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token-2022';
import {
  BAO_PROGRAM_ADDRESS,
  CLAIM_RECORD_DISCRIMINATOR,
  ClaimStatus,
  PACKET_DISCRIMINATOR,
  buildPayout,
  getCancelStaleInstructionAsync,
  getClaimRecordDecoder,
  getCloseClaimsInstructionAsync,
  getClosePacketInstructionAsync,
  getPacketDecoder,
  type ClaimRecord,
  type Packet,
} from '@bao/sdk';
import { PACKET_SIZE } from './chain';
import type { Store } from './db';
import { pollProgram, type PollResult } from './indexer';
import { errorMessage, log } from './log';
import { pushRainStarting } from './push';
import { sendAndConfirm, type SolanaRpc } from './rpc';

/** Account sizes of the deployed layout; older layouts on devnet are skipped. */
export { PACKET_SIZE };
export const CLAIM_SIZE = 124;
export const STALE_SLOTS = 300n;
export const MAX_CLAIMS_PER_TX = 20;

export interface ChainSnapshot {
  slot: bigint;
  now: number;
  packets: { address: Address; data: Packet }[];
  claims: { address: Address; data: ClaimRecord }[];
}

export interface CrankPlan {
  payouts: { claim: Address; packet: Address; claimer: Address; mint: Address; tokenProgram: Address; amount: bigint }[];
  cancels: { claim: Address; packet: Address; deviceKey: Address }[];
  closes: { packet: Address; sender: Address; mint: Address; tokenProgram: Address; claimBatches: Address[][] }[];
}

export interface CrankLimits {
  payouts: number;
  cancels: number;
  closes: number;
}

const DEFAULT_LIMITS: CrankLimits = { payouts: 10, cancels: 5, closes: 3 };
/** Stop starting new transactions after this long, so a tick fits a 60 s function. */
const DEFAULT_BUDGET_MS = 40_000;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Pure selection over a chain snapshot; unit-tested without RPC. */
export function planCrank(s: ChainSnapshot, limits: CrankLimits = DEFAULT_LIMITS): CrankPlan {
  const packets = new Map(s.packets.map((p) => [p.address as string, p.data]));
  const claimsOf = new Map<string, { address: Address; data: ClaimRecord }[]>();
  for (const c of s.claims) {
    const list = claimsOf.get(c.data.packet) ?? [];
    list.push(c);
    claimsOf.set(c.data.packet, list);
  }

  const payouts: CrankPlan['payouts'] = [];
  const cancels: CrankPlan['cancels'] = [];
  for (const c of s.claims) {
    const packet = packets.get(c.data.packet);
    if (!packet) continue;
    if (c.data.status === ClaimStatus.Won) {
      payouts.push({
        claim: c.address,
        packet: c.data.packet,
        claimer: c.data.claimer,
        mint: packet.mint,
        tokenProgram: packet.tokenProgram,
        amount: c.data.amount,
      });
    } else if (c.data.status === ClaimStatus.Pending && s.slot > c.data.requestedSlot + STALE_SLOTS) {
      cancels.push({ claim: c.address, packet: c.data.packet, deviceKey: c.data.deviceKey });
    }
  }

  const closes: CrankPlan['closes'] = [];
  for (const { address, data: p } of s.packets) {
    const expired = BigInt(s.now) >= p.expiresAt;
    const finished = p.resolved === p.totalShares;
    if (!(expired || finished) || p.reserved !== p.resolved) continue;
    const claims = claimsOf.get(address) ?? [];
    // a won share that is not expired yet must be paid before its record can close
    if (!expired && claims.some((c) => c.data.status === ClaimStatus.Won)) continue;
    closes.push({
      packet: address,
      sender: p.sender,
      mint: p.mint,
      tokenProgram: p.tokenProgram,
      claimBatches: chunk(
        claims.map((c) => c.address),
        MAX_CLAIMS_PER_TX,
      ),
    });
  }

  return {
    payouts: payouts.slice(0, limits.payouts),
    cancels: cancels.slice(0, limits.cancels),
    closes: closes.sort((a, b) => a.claimBatches.length - b.claimBatches.length).slice(0, limits.closes),
  };
}

const base58 = getBase58Decoder();

export async function loadChainSnapshot(rpc: SolanaRpc, program: Address = BAO_PROGRAM_ADDRESS): Promise<ChainSnapshot> {
  const accountsOf = async (discriminator: Uint8Array, size: number) =>
    rpc
      .getProgramAccounts(program, {
        encoding: 'base64',
        commitment: 'confirmed',
        filters: [
          { dataSize: BigInt(size) },
          { memcmp: { offset: 0n, bytes: base58.decode(discriminator) as never, encoding: 'base58' } },
        ],
      })
      .send();
  const [slot, rawPackets, rawClaims] = await Promise.all([
    rpc.getSlot({ commitment: 'confirmed' }).send(),
    accountsOf(PACKET_DISCRIMINATOR, PACKET_SIZE),
    accountsOf(CLAIM_RECORD_DISCRIMINATOR, CLAIM_SIZE),
  ]);
  const decode = <T>(decoder: { decode: (b: Uint8Array) => T }, list: typeof rawPackets) =>
    list.flatMap((a) => {
      try {
        return [{ address: a.pubkey, data: decoder.decode(new Uint8Array(Buffer.from(a.account.data[0], 'base64'))) }];
      } catch {
        return [];
      }
    });
  return {
    slot,
    now: Math.floor(Date.now() / 1000),
    packets: decode(getPacketDecoder(), rawPackets),
    claims: decode(getClaimRecordDecoder(), rawClaims),
  };
}

type Send = typeof sendAndConfirm;

export interface CrankDeps {
  store: Store;
  rpc: SolanaRpc;
  crank: KeyPairSigner | null;
  send?: Send;
  now?: () => number;
  limits?: CrankLimits;
  /** Skips the indexer poll (tests). */
  skipIndexer?: boolean;
  /** Time after which no new transaction is started (the rest waits for the next tick). */
  budgetMs?: number;
}

interface StepResult<T> {
  ok: boolean;
  ms: number;
  error?: string;
  result?: T;
}

export interface CrankReport {
  ok: boolean;
  slot: string | null;
  steps: {
    snapshot: StepResult<{ packets: number; claims: number }>;
    reconcile: StepResult<{ claims: number }>;
    payouts: StepResult<ItemResults>;
    cancels: StepResult<ItemResults>;
    closes: StepResult<ItemResults>;
    rains: StepResult<{ pushed: string[] }>;
    indexer: StepResult<PollResult>;
  };
}

interface ItemResults {
  done: { target: string; signature: string }[];
  failed: { target: string; error: string }[];
  deferred?: string[];
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<StepResult<T>> {
  const started = Date.now();
  try {
    const result = await fn();
    return { ok: true, ms: Date.now() - started, result };
  } catch (e) {
    log.error('crank.step_failed', { step: name, error: errorMessage(e) });
    return { ok: false, ms: Date.now() - started, error: errorMessage(e) };
  }
}

const withRemaining = (ix: Instruction, accounts: Address[]): Instruction => ({
  ...ix,
  accounts: [...(ix.accounts ?? []), ...accounts.map((address) => ({ address, role: AccountRole.WRITABLE }))],
});

export async function runCrank(deps: CrankDeps): Promise<CrankReport> {
  const send = deps.send ?? sendAndConfirm;
  const crank = deps.crank;
  const deadline = Date.now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
  let snapshot: ChainSnapshot | null = null;
  let plan: CrankPlan | null = null;
  const empty: ItemResults = { done: [], failed: [] };

  const snapshotStep = await step('snapshot', async () => {
    snapshot = await loadChainSnapshot(deps.rpc);
    if (deps.now) snapshot.now = deps.now();
    plan = planCrank(snapshot, deps.limits ?? DEFAULT_LIMITS);
    return { packets: snapshot.packets.length, claims: snapshot.claims.length };
  });

  const each = async <T extends { packet: Address }>(items: T[], target: (t: T) => string, run: (t: T, signer: KeyPairSigner) => Promise<string>) => {
    const out: ItemResults = { done: [], failed: [] };
    if (!crank) {
      if (items.length) log.once('crank.no_key', { note: 'CRANK_KEYPAIR unset; on-chain crank steps skipped' });
      return out;
    }
    for (const item of items) {
      if (Date.now() > deadline) {
        (out.deferred ??= []).push(target(item));
        continue;
      }
      try {
        out.done.push({ target: target(item), signature: await run(item, crank) });
      } catch (e) {
        out.failed.push({ target: target(item), error: errorMessage(e).slice(0, 300) });
      }
    }
    return out;
  };

  // events can be missed (webhook gaps, truncated logs); claim accounts are the truth
  const reconcile = await step('reconcile', async () => {
    const s = snapshot as ChainSnapshot | null;
    if (!s) return { claims: 0 };
    const known = new Set((await deps.store.packetsByAddress(s.claims.map((c) => c.data.packet))).map((p) => p.address));
    let n = 0;
    for (const c of s.claims) {
      if (!known.has(c.data.packet)) continue;
      const status = c.data.status === ClaimStatus.Pending ? 'pending' : c.data.status === ClaimStatus.Won ? 'won' : 'paid';
      await deps.store.applyGrab({
        packet: c.data.packet,
        deviceKey: c.data.deviceKey,
        claimer: c.data.claimer,
        index: c.data.index,
        status,
        amount: status === 'pending' ? null : c.data.amount.toString(),
        slot: Number(c.data.requestedSlot),
        at: s.now,
      });
      n++;
    }
    return { claims: n };
  });

  const payouts = await step('payouts', async () => {
    const p = plan as CrankPlan | null;
    if (!p) return empty;
    return each(p.payouts, (x) => x.claim, async (x, signer) => {
      const ix = await buildPayout({ payer: signer, packet: x.packet, claim: x.claim, claimer: x.claimer, mint: x.mint, tokenProgram: x.tokenProgram });
      const signature = await send(deps.rpc, [ix], signer);
      await deps.store.markPaid(x.packet, x.claimer, x.amount.toString(), signature);
      return signature;
    });
  });

  const cancels = await step('cancels', async () => {
    const p = plan as CrankPlan | null;
    if (!p) return empty;
    return each(p.cancels, (x) => x.claim, async (x, signer) => {
      const signature = await send(deps.rpc, [await getCancelStaleInstructionAsync({ caller: signer, packet: x.packet, claim: x.claim })], signer);
      await deps.store.cancelGrab(x.packet, x.deviceKey, Number.MAX_SAFE_INTEGER);
      return signature;
    });
  });

  const closes = await step('closes', async () => {
    const p = plan as CrankPlan | null;
    if (!p) return empty;
    return each(p.closes, (x) => x.packet, async (x, signer) => {
      for (const batch of x.claimBatches) {
        const ix = await getCloseClaimsInstructionAsync({ caller: signer, packet: x.packet });
        await send(deps.rpc, [withRemaining(ix, batch)], signer);
      }
      const [senderToken] = await findAssociatedTokenPda({ owner: x.sender, mint: x.mint, tokenProgram: x.tokenProgram });
      const close = await getClosePacketInstructionAsync({
        caller: signer,
        packet: x.packet,
        sender: x.sender,
        mint: x.mint,
        senderToken,
        tokenProgram: x.tokenProgram,
      });
      return send(deps.rpc, [close], signer);
    });
  });

  const rains = await step('rains', async () => {
    const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
    const due = await deps.store.rainsStartingBefore(now + 60);
    for (const rain of due) await pushRainStarting(deps.store, rain);
    return { pushed: due.map((r) => r.address) };
  });

  const indexer = deps.skipIndexer
    ? { ok: true, ms: 0, result: { seen: 0, processed: 0, events: 0, cursor: null } }
    : await step('indexer', () => pollProgram({ store: deps.store, rpc: deps.rpc }));

  const steps = { snapshot: snapshotStep, reconcile, payouts, cancels, closes, rains, indexer };
  const s = snapshot as ChainSnapshot | null;
  return { ok: Object.values(steps).every((x) => x.ok), slot: s ? s.slot.toString() : null, steps };
}
