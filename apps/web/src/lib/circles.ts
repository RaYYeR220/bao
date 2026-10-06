/** Circles: invite codes, members, Merkle snapshots for circle packets, chains and leaderboards. */
import { randomInt } from 'node:crypto';
import { address as toAddress } from '@solana/kit';
import { buildCircleTree, type CircleDetail, type CircleSummary } from '@bao/sdk';
import type { Store } from './db';
import { refreshPacket } from './indexer';
import { warmSkrNames, type IdentityDeps } from './seeker';
import type { SolanaRpc } from './rpc';
import { HttpError, type CircleRecord } from './types';
import { nowSecs, packetViews } from './views';

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function inviteCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

export const normalizeInvite = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function createCircle(store: Store, owner: string, name: string, emoji: string | null): Promise<CircleRecord> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await store.createCircle({ name, emoji, owner, inviteCode: inviteCode() });
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error).message))) throw e;
    }
  }
  throw new HttpError(503, 'could not allocate an invite code, try again');
}

export async function joinCircle(store: Store, viewer: string, code: string): Promise<CircleRecord> {
  const circle = await store.circleByInvite(normalizeInvite(code));
  if (!circle) throw new HttpError(404, 'no circle with that invite code');
  await store.addMember(circle.id, viewer);
  return circle;
}

export async function memberCircle(store: Store, circleId: string, viewer: string): Promise<CircleRecord> {
  const circle = await store.getCircle(circleId);
  if (!circle) throw new HttpError(404, 'circle not found');
  if (!(await store.isMember(circle.id, viewer))) throw new HttpError(403, 'not a member of this circle');
  return circle;
}

export async function circleSummaries(store: Store, viewer: string, now = nowSecs()): Promise<CircleSummary[]> {
  return (await store.circlesOf(viewer, now)).map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    memberCount: c.memberCount,
    livePackets: c.livePackets,
  }));
}

export async function circleDetail(deps: IdentityDeps, circle: CircleRecord, now = nowSecs()): Promise<CircleDetail> {
  const { store } = deps;
  const members = await store.members(circle.id);
  const [packets, chains, boards, counts] = await Promise.all([
    store.circlePackets(circle.id),
    store.circleChains(circle.id),
    store.circleLeaderboards(circle.id),
    store.circleCounts(circle.id, now),
  ]);
  await warmSkrNames(deps, members.map((m) => m.address));
  const names = await store.skrNames([
    ...members.map((m) => m.address),
    ...chains.map((c) => c.lastKing ?? ''),
    ...boards.generous.map((g) => g.address),
    ...boards.lucky.map((l) => l.address),
  ]);
  return {
    id: circle.id,
    name: circle.name,
    emoji: circle.emoji,
    memberCount: counts.memberCount,
    livePackets: counts.livePackets,
    inviteCode: circle.inviteCode,
    owner: circle.owner,
    members: members.map((m) => ({ address: m.address, skrName: names.get(m.address) ?? null, joinedAt: m.joinedAt })),
    packets: await packetViews(store, packets, now),
    chains: chains.map((c) => ({
      root: c.root,
      depth: c.depth,
      lastKing: c.lastKing,
      lastKingSkr: c.lastKing ? (names.get(c.lastKing) ?? null) : null,
    })),
    leaderboard: {
      generous: boards.generous.map((g) => ({ ...g, skrName: names.get(g.address) ?? null })),
      lucky: boards.lucky.map((l) => ({ ...l, skrName: names.get(l.address) ?? null })),
    },
  };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Freezes the current member list; the root goes into a new circle packet. */
export async function snapshotCircle(store: Store, circleId: string): Promise<{ root: string; members: string[] }> {
  const members = (await store.members(circleId)).map((m) => m.address);
  const tree = buildCircleTree(members.map((m) => toAddress(m)));
  const root = hex(tree.root);
  await store.saveSnapshot(circleId, root, members);
  return { root, members };
}

/** The wallet's Merkle proof for a circle packet, from the snapshot whose root the packet carries. */
export async function proofFor(store: Store, rpc: SolanaRpc, packetAddress: string, wallet: string): Promise<string[]> {
  let packet = await store.getPacket(packetAddress);
  if (!packet) packet = await refreshPacket({ store, rpc }, packetAddress);
  if (!packet) throw new HttpError(404, 'packet not found');
  if (packet.audience !== 'circle') return [];
  const root = packet.merkleRoot ?? packet.snapshotRoot;
  if (!root) throw new HttpError(404, 'packet has no circle snapshot');
  const snapshot = await store.snapshot(root, packet.circleId);
  if (!snapshot) throw new HttpError(404, 'circle snapshot not found for this packet');
  if (!snapshot.members.includes(wallet)) throw new HttpError(403, 'wallet is not in the circle snapshot of this packet');
  const tree = buildCircleTree(snapshot.members.map((m) => toAddress(m)));
  return tree.proofOf(toAddress(wallet)).map(hex);
}
