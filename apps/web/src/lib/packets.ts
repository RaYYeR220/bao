/** Packet registration (after the sender's on-chain create), detail, feed and widget. */
import { address as toAddress } from '@solana/kit';
import { messageHash, type FeedView, type PacketDetail, type PacketView, type WidgetView } from '@bao/sdk';
import type { Store } from './db';
import { refreshPacket, syncPacket } from './indexer';
import { errorMessage, log } from './log';
import { pushPacketDropped } from './push';
import type { SolanaRpc } from './rpc';
import { warmSkrNames, type IdentityDeps } from './seeker';
import { env } from './env';
import { formatUi, tokenMeta } from './tokens';
import { HttpError, type PacketRecord } from './types';
import { grabViews, nowSecs, packetViews } from './views';

export interface RegisterInput {
  address: string;
  message?: string;
  skin?: string;
  circleId?: string;
  snapshotRoot?: string;
  codeHint?: string;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

async function waitForPacket(store: Store, rpc: SolanaRpc, address: string, attempts: number, delayMs: number) {
  for (let i = 0; i < attempts; i++) {
    const { found, row } = await syncPacket({ store, rpc }, address);
    if (found) return row;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export async function registerPacket(
  deps: IdentityDeps & { rpc: SolanaRpc; retry?: { attempts: number; delayMs: number } },
  viewer: string,
  input: RegisterInput,
): Promise<PacketView> {
  const { store, rpc } = deps;
  const address = input.address;
  const packet = await waitForPacket(store, rpc, address, deps.retry?.attempts ?? 5, deps.retry?.delayMs ?? 1_500);
  if (!packet) throw new HttpError(404, 'packet account not found on devnet (yet)');
  if (packet.sender !== viewer) throw new HttpError(403, 'only the sender can register this packet');

  // same rule as the sdk: an empty message hashes to zeros
  const message = input.message ? input.message : null;
  if (packet.messageHash !== hex(messageHash(message))) throw new HttpError(400, 'message does not match the on-chain message hash');

  let circleId: string | null = null;
  let snapshotRoot: string | null = null;
  if (packet.audience === 'circle') {
    if (!input.circleId || !input.snapshotRoot) throw new HttpError(400, 'circle packets need circleId and snapshotRoot');
    const circle = await store.getCircle(input.circleId);
    if (!circle) throw new HttpError(404, 'circle not found');
    if (!(await store.isMember(circle.id, viewer))) throw new HttpError(403, 'not a member of this circle');
    const root = input.snapshotRoot.toLowerCase();
    if (!(await store.snapshot(root, circle.id))) throw new HttpError(400, 'unknown snapshot for this circle');
    if (packet.merkleRoot !== root) throw new HttpError(400, 'snapshotRoot does not match the on-chain merkle root');
    circleId = circle.id;
    snapshotRoot = root;
  } else if (input.circleId || input.snapshotRoot) {
    throw new HttpError(400, 'circleId and snapshotRoot apply to circle packets only');
  }
  const codeHint = packet.audience === 'code' && input.codeHint?.trim() ? input.codeHint.trim() : null;

  await store.registerPacket(address, { message, skin: input.skin ?? null, circleId, snapshotRoot, codeHint });
  if (!packet.createSignature) await fillCreateSignature(store, rpc, address);
  const row = (await store.getPacket(address))!;
  try {
    const circle = circleId ? await store.getCircle(circleId) : null;
    await pushPacketDropped(store, row, circle?.name ?? null);
  } catch (e) {
    log.warn('packets.push_failed', { packet: address, error: errorMessage(e) });
  }
  await warmSkrNames(deps, [viewer]);
  return (await packetViews(store, [row]))[0];
}

/** The oldest signature touching the packet is its create transaction. */
async function fillCreateSignature(store: Store, rpc: SolanaRpc, address: string) {
  try {
    const sigs = await rpc.getSignaturesForAddress(toAddress(address), { limit: 50, commitment: 'confirmed' }).send();
    const oldest = sigs.filter((s) => !s.err).at(-1);
    if (oldest && sigs.length < 50) {
      await store.sql.query('update packets set create_signature = coalesce(create_signature, $2) where address = $1', [
        address,
        oldest.signature,
      ]);
    }
  } catch (e) {
    log.warn('packets.create_signature_failed', { packet: address, error: errorMessage(e) });
  }
}

export async function packetDetail(store: Store, rpc: SolanaRpc, address: string): Promise<PacketDetail> {
  let packet = await store.getPacket(address);
  if (!packet) packet = await refreshPacket({ store, rpc }, address);
  if (!packet) throw new HttpError(404, 'packet not found');
  const [view] = await packetViews(store, [packet]);
  return { ...view, grabs: await grabViews(store, await store.grabsOf(address)) };
}

/** The feed plus the senders whose `.skr` names are worth looking up after the response. */
export async function feed(deps: IdentityDeps, viewer: string | null, now = nowSecs()): Promise<FeedView & { senders: string[] }> {
  const [packets, rains] = await Promise.all([deps.store.feed(viewer, now), deps.store.upcomingRains(now)]);
  return {
    packets: await packetViews(deps.store, packets, now),
    rains: await packetViews(deps.store, rains, now),
    senders: [...packets, ...rains].map((p) => p.sender),
  };
}

/** "3 packets waiting · 47 tSKR · rain in 12 min" for the home-screen widget. */
export async function widget(store: Store, viewer: string | null, now = nowSecs()): Promise<WidgetView> {
  const [packets, rains] = await Promise.all([store.feed(viewer, now), store.upcomingRains(now, 1)]);
  const waiting = packets.filter((p) => p.startsAt <= now);
  const mint = mainMint(waiting);
  const meta = tokenMeta(mint, waiting.find((p) => p.mint === mint)?.decimals);
  const total = waiting.filter((p) => p.mint === mint).reduce((sum, p) => sum + BigInt(p.remainingAmount), 0n);
  return {
    waiting: waiting.length,
    waitingAmountUi: formatUi(total, meta.decimals, 2),
    symbol: meta.symbol,
    nextRainAt: rains[0]?.startsAt ?? null,
    topPacket: waiting[0]?.address ?? null,
  };
}

function mainMint(packets: PacketRecord[]): string {
  const counts = new Map<string, number>();
  for (const p of packets) counts.set(p.mint, (counts.get(p.mint) ?? 0) + 1);
  let best = env().TSKR_MINT;
  let bestCount = counts.get(best) ?? 0;
  for (const [mint, n] of counts) if (n > bestCount) [best, bestCount] = [mint, n];
  return best;
}
