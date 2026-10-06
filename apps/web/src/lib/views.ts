/** Database rows -> the API contract shapes in @bao/sdk. */
import type { GrabView, PacketView, TokenInfo } from '@bao/sdk';
import { packetStatus } from './chain';
import type { Store } from './db';
import { tokenInfo } from './tokens';
import type { GrabRecord, PacketRecord } from './types';

export const nowSecs = () => Math.floor(Date.now() / 1000);

export function toPacketView(p: PacketRecord, token: TokenInfo, names: Map<string, string>, now: number): PacketView {
  return {
    address: p.address,
    sender: p.sender,
    senderSkr: names.get(p.sender) ?? null,
    token,
    total: p.totalAmount,
    remaining: p.remainingAmount,
    shares: p.totalShares,
    reserved: p.reserved,
    resolved: p.resolved,
    mode: p.mode,
    audience: p.audience,
    seekerOnly: p.seekerOnly,
    startsAt: p.startsAt,
    expiresAt: p.expiresAt,
    createdAt: p.createdAt,
    status: packetStatus(p, now),
    message: p.message,
    skin: p.skin,
    circleId: p.circleId,
    codeHint: p.codeHint,
    chainRoot: p.chainRoot,
    chainDepth: p.chainDepth,
    luckKing: p.luckKing,
    luckKingSkr: p.luckKing ? (names.get(p.luckKing) ?? null) : null,
    luckKingAmount: p.luckKingAmount,
    createSignature: p.createSignature,
  };
}

export function toGrabView(g: GrabRecord, names: Map<string, string>): GrabView {
  return {
    packet: g.packet,
    claimer: g.claimer,
    claimerSkr: names.get(g.claimer) ?? null,
    deviceKey: g.deviceKey,
    index: g.index,
    amount: g.amount,
    status: g.status,
    grabSignature: g.grabSignature,
    callbackSignature: g.callbackSignature,
    payoutSignature: g.payoutSignature,
    randomness: g.randomness,
    at: g.at,
  };
}

export async function packetViews(store: Store, rows: PacketRecord[], now = nowSecs()): Promise<PacketView[]> {
  const names = await store.skrNames(rows.flatMap((p) => [p.sender, p.luckKing ?? '']));
  const tokens = new Map<string, TokenInfo>();
  for (const p of rows) if (!tokens.has(p.mint)) tokens.set(p.mint, await tokenInfo(p.mint, p.decimals));
  return rows.map((p) => toPacketView(p, tokens.get(p.mint)!, names, now));
}

export async function grabViews(store: Store, rows: GrabRecord[]): Promise<GrabView[]> {
  const names = await store.skrNames(rows.map((g) => g.claimer));
  return rows.map((g) => toGrabView(g, names));
}

/** Circle packet messages are for the circle: others (and signed-out viewers) see them without it. */
export async function redactForViewer<T extends { audience: string; circleId: string | null; sender: string; message: string | null }>(
  store: Store,
  viewer: string | null,
  packets: T[],
): Promise<T[]> {
  if (!packets.some((p) => p.audience === 'circle' && p.message)) return packets;
  const mine = viewer ? await store.circleIdsOf(viewer) : new Set<string>();
  return packets.map((p) =>
    p.audience === 'circle' && p.sender !== viewer && !(p.circleId && mine.has(p.circleId)) ? { ...p, message: null } : p,
  );
}
