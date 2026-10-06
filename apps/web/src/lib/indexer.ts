/**
 * Mirrors the program into the database. Two feeds share one code path:
 *   - Helius webhooks (raw payloads carry logs; enhanced ones are refetched by signature)
 *   - a poller over getSignaturesForAddress(program) from a stored cursor (cron backfill)
 * Every write is an idempotent upsert, so replays and out-of-order delivery are harmless.
 */
import { address, signature as toSignature, type Address, type Signature } from '@solana/kit';
import { BAO_PROGRAM_ADDRESS, fetchMaybePacket } from '@bao/sdk';
import { eventsFromLogs, mirrorFromAccount, mirrorFromEvent, packetStatus, randomnessHex, type BaoEvent } from './chain';
import type { Store } from './db';
import { env } from './env';
import { log, errorMessage } from './log';
import { pushLuckKing, pushPacketEmptied, pushPaidOut } from './push';
import type { SolanaRpc } from './rpc';
import { tokenMeta } from './tokens';
import type { PacketRecord } from './types';

export interface IndexerDeps {
  store: Store;
  rpc: SolanaRpc;
  now?: () => number;
}

export interface TxInput {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  logs: readonly string[] | null;
}

const nowSecs = () => Math.floor(Date.now() / 1000);
/** Pushes only for events this recent, so a backfill does not replay old notifications. */
const PUSH_WINDOW_SECS = 15 * 60;

const decimalsCache = new Map<string, number>();

export async function mintDecimals(rpc: SolanaRpc, mint: string): Promise<number | null> {
  const known = tokenMeta(mint);
  if (!known.symbol.endsWith('…')) return known.decimals;
  const hit = decimalsCache.get(mint);
  if (hit !== undefined) return hit;
  try {
    const { value } = await rpc.getAccountInfo(address(mint), { encoding: 'jsonParsed' }).send();
    const decimals = (value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed?.info?.decimals;
    if (typeof decimals === 'number') {
      decimalsCache.set(mint, decimals);
      return decimals;
    }
  } catch (e) {
    log.warn('indexer.decimals_failed', { mint, error: errorMessage(e) });
  }
  return null;
}

/** Re-reads the packet account and mirrors it. `found` tells whether the account exists on chain. */
export async function syncPacket(deps: IndexerDeps, packet: string): Promise<{ found: boolean; row: PacketRecord | null }> {
  const now = (deps.now ?? nowSecs)();
  let found = false;
  try {
    const account = await fetchMaybePacket(deps.rpc, address(packet), { commitment: 'confirmed' });
    if (account.exists) {
      found = true;
      const mirror = mirrorFromAccount(packet, account.data, await mintDecimals(deps.rpc, account.data.mint));
      const known = await deps.store.getPacket(packet);
      await deps.store.upsertPacketMirror(mirror, packetStatus({ ...mirror, reserved: mirror.reserved ?? 0, status: known?.status }, now));
    }
  } catch (e) {
    log.warn('indexer.refresh_failed', { packet, error: errorMessage(e) });
  }
  return { found, row: await deps.store.getPacket(packet) };
}

/** Mirrors the packet account when it exists; returns the stored row (null if never seen). */
export async function refreshPacket(deps: IndexerDeps, packet: string): Promise<PacketRecord | null> {
  return (await syncPacket(deps, packet)).row;
}

async function applyEvent(deps: IndexerDeps, tx: TxInput, event: BaoEvent, blockTime: number) {
  const { store } = deps;
  const sig = tx.signature;
  switch (event.name) {
    case 'PacketCreated': {
      const m = mirrorFromEvent(event.data, blockTime, sig);
      await store.insertPacketIfMissing(m, packetStatus({ ...m, reserved: 0 }, (deps.now ?? nowSecs)()));
      return;
    }
    case 'GrabReserved':
      await store.applyGrab({
        packet: event.data.packet,
        deviceKey: event.data.deviceKey,
        claimer: event.data.claimer,
        index: event.data.index,
        status: 'pending',
        grabSignature: sig,
        slot: tx.slot,
        at: blockTime,
      });
      return;
    case 'Grabbed': {
      const randomness = randomnessHex(event.data.randomness);
      const equal = randomness === null; // equal grabs carry no randomness and pay at once
      await store.applyGrab({
        packet: event.data.packet,
        deviceKey: event.data.deviceKey,
        claimer: event.data.claimer,
        index: event.data.index,
        status: equal ? 'paid' : 'won',
        amount: event.data.amount.toString(),
        grabSignature: equal ? sig : undefined,
        callbackSignature: equal ? undefined : sig,
        randomness,
        slot: equal ? tx.slot : undefined,
        at: blockTime,
      });
      return;
    }
    case 'PaidOut':
      await store.markPaid(event.data.packet, event.data.claimer, event.data.amount.toString(), sig);
      return;
    case 'ClaimForfeited':
      await store.markForfeited(event.data.packet, event.data.claimer);
      return;
    case 'LuckKingCrowned':
      await store.markCrowned(event.data.packet, event.data.king, event.data.amount.toString());
      return;
    case 'StaleCancelled':
      await store.cancelGrab(event.data.packet, event.data.deviceKey, tx.slot);
      return;
    case 'PacketClosed':
      await store.markClosed(
        event.data.packet,
        sig,
        event.data.refunded.toString(),
        event.data.luckKing.__option === 'Some' ? event.data.luckKing.value : null,
      );
      return;
  }
}

async function notifyFor(deps: IndexerDeps, event: BaoEvent, packet: PacketRecord | null) {
  if (!packet) return;
  try {
    if (event.name === 'PaidOut') await pushPaidOut(deps.store, packet, event.data.claimer, event.data.amount.toString());
    if (event.name === 'LuckKingCrowned') await pushLuckKing(deps.store, packet, event.data.king, event.data.amount.toString());
    if (event.name === 'Grabbed' && packet.resolved >= packet.totalShares) await pushPacketEmptied(deps.store, packet);
  } catch (e) {
    log.warn('indexer.push_failed', { event: event.name, error: errorMessage(e) });
  }
}

/** Applies one transaction's Bao events. Failed transactions changed nothing and are skipped. */
export async function indexTransaction(deps: IndexerDeps, tx: TxInput): Promise<{ events: string[] }> {
  if (tx.err || !tx.logs) return { events: [] };
  const { events, truncated } = eventsFromLogs(tx.logs);
  if (truncated) log.warn('indexer.logs_truncated', { signature: tx.signature });
  const now = (deps.now ?? nowSecs)();
  const blockTime = tx.blockTime ?? now;
  const touched = new Map<string, BaoEvent[]>();
  for (const event of events) {
    await applyEvent(deps, tx, event, blockTime);
    const list = touched.get(event.data.packet) ?? [];
    list.push(event);
    touched.set(event.data.packet, list);
  }
  for (const [packet, list] of touched) {
    const closed = list.some((e) => e.name === 'PacketClosed');
    const row = closed ? await deps.store.getPacket(packet) : await refreshPacket(deps, packet);
    if (now - blockTime <= PUSH_WINDOW_SECS) for (const e of list) await notifyFor(deps, e, row);
  }
  return { events: events.map((e) => e.name) };
}

async function fetchTx(rpc: SolanaRpc, sig: string): Promise<TxInput | null> {
  const tx = await rpc
    .getTransaction(toSignature(sig), { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' })
    .send();
  if (!tx) return null;
  return {
    signature: sig,
    slot: Number(tx.slot),
    blockTime: tx.blockTime === null ? null : Number(tx.blockTime),
    err: tx.meta?.err ?? null,
    logs: tx.meta?.logMessages ?? null,
  };
}

export interface PollResult {
  seen: number;
  processed: number;
  events: number;
  cursor: string | null;
  error?: string;
}

/** Indexes program transactions newer than the stored cursor, oldest first. */
export async function pollProgram(deps: IndexerDeps, opts: { maxTx?: number; program?: Address } = {}): Promise<PollResult> {
  const program = opts.program ?? BAO_PROGRAM_ADDRESS;
  const maxTx = opts.maxTx ?? 100;
  const cursor = await deps.store.cursor();
  const pending: { signature: string; slot: number; err: unknown }[] = [];
  let before: Signature | undefined;
  const pageSize = cursor ? 1000 : env().INDEXER_BACKFILL_LIMIT;
  for (let page = 0; page < 20; page++) {
    const sigs = await deps.rpc
      .getSignaturesForAddress(program, {
        commitment: 'confirmed',
        limit: pageSize,
        ...(cursor ? { until: toSignature(cursor.signature) } : {}),
        ...(before ? { before } : {}),
      })
      .send();
    pending.push(...sigs.map((s) => ({ signature: s.signature, slot: Number(s.slot), err: s.err })));
    if (!cursor || sigs.length < pageSize) break;
    before = sigs[sigs.length - 1].signature;
  }
  pending.reverse();
  const result: PollResult = { seen: pending.length, processed: 0, events: 0, cursor: cursor?.signature ?? null };
  for (const item of pending.slice(0, maxTx)) {
    try {
      if (!item.err) {
        const tx = await fetchTx(deps.rpc, item.signature);
        if (!tx) break; // not yet served by this node; retry next run
        result.events += (await indexTransaction(deps, tx)).events.length;
      }
      await deps.store.setCursor(item.signature, item.slot);
      result.cursor = item.signature;
      result.processed++;
    } catch (e) {
      result.error = `${item.signature}: ${errorMessage(e)}`;
      log.error('indexer.poll_failed', { signature: item.signature, error: errorMessage(e) });
      break;
    }
  }
  return result;
}

/** Helius webhook bodies: raw transactions (with logs) or enhanced ones (signature only). */
export function parseWebhookPayload(body: unknown): { signature: string; tx: TxInput | null }[] {
  const items = Array.isArray(body) ? body : body ? [body] : [];
  const out: { signature: string; tx: TxInput | null }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const meta = item.meta as { logMessages?: string[]; err?: unknown } | undefined;
    const transaction = item.transaction as { signatures?: string[] } | undefined;
    const signature = (transaction?.signatures?.[0] ?? item.signature) as string | undefined;
    if (typeof signature !== 'string') continue;
    if (meta && Array.isArray(meta.logMessages)) {
      out.push({
        signature,
        tx: {
          signature,
          slot: Number(item.slot ?? 0),
          blockTime: item.blockTime === undefined || item.blockTime === null ? null : Number(item.blockTime),
          err: meta.err ?? null,
          logs: meta.logMessages,
        },
      });
    } else {
      out.push({ signature, tx: null });
    }
  }
  return out;
}

export async function indexWebhook(deps: IndexerDeps, body: unknown) {
  const items = parseWebhookPayload(body);
  let events = 0;
  const failed: string[] = [];
  for (const item of items) {
    try {
      const tx = item.tx ?? (await fetchTx(deps.rpc, item.signature));
      if (tx) events += (await indexTransaction(deps, tx)).events.length;
    } catch (e) {
      failed.push(item.signature);
      log.error('indexer.webhook_failed', { signature: item.signature, error: errorMessage(e) });
    }
  }
  return { received: items.length, events, failed };
}
