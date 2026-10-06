import { address, none } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCircleTree, getPacketEncoder, messageHash, SplitMode, type CircleDetail } from '@bao/sdk';
import { GET as listCircles, POST as createCircle } from '@/app/api/circles/route';
import { POST as joinCircle } from '@/app/api/circles/join/route';
import { GET as getCircle } from '@/app/api/circles/[id]/route';
import { POST as snapshot } from '@/app/api/circles/[id]/snapshot/route';
import { POST as register } from '@/app/api/packets/route';
import { GET as getPacket } from '@/app/api/packets/[address]/route';
import { GET as getProof } from '@/app/api/packets/[address]/proof/route';
import { GET as getFeed } from '@/app/api/feed/route';
import { GET as getWidget } from '@/app/api/widget/route';
import { POST as registerPush } from '@/app/api/push/register/route';
import { issueSession } from '@/lib/auth';
import { setStore, type Store } from '@/lib/db';
import { resetRateLimits } from '@/lib/http';
import { setRpcs } from '@/lib/rpc';
import { base64Account, fakeRpc, packetBytes } from './fake-rpc';
import { A, freshStore } from './helpers';

const TSKR = 'aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr';
const PACKET = A.p1;
const accounts = new Map<string, string>();
let store: Store;
const tokens: Record<string, string> = {};

function packetAccount(root: Uint8Array, message: string | null, startsAt = 1_000n) {
  const data = getPacketEncoder().encode({
    sender: address(A.alice),
    id: 7n,
    mint: address(TSKR),
    tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    totalAmount: 10_000_000n,
    remainingAmount: 10_000_000n,
    totalShares: 3,
    reserved: 0,
    resolved: 0,
    openClaims: 0,
    mode: SplitMode.Lucky,
    audience: { __kind: 'Circle', merkleRoot: root },
    seekerOnly: false,
    sgtGroup: address(A.dave),
    crankReward: 5_000n,
    createdAt: 1_000n,
    startsAt,
    expiresAt: 4_000_000_000n,
    messageHash: messageHash(message),
    parent: none(),
    chainRoot: address(PACKET),
    chainDepth: 0,
    luckKing: none(),
    luckKingAmount: 0n,
    crowned: false,
    bump: 255,
    vaultBump: 255,
    gasBump: 255,
  });
  return packetBytes(data);
}

const rpc = fakeRpc({
  getAccountInfo: (a) => ({ value: accounts.has(a as string) ? base64Account(accounts.get(a as string)!) : null }),
  getProgramAccounts: () => [],
  getTokenAccountsByOwner: () => ({ value: [] }),
  getSignaturesForAddress: () => [{ signature: 'create-sig', slot: 1n, err: null }],
});

const req = (method: string, path: string, who?: string, body?: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const none_ = undefined as never;

beforeAll(async () => {
  store = await freshStore();
  setStore(store);
  setRpcs({ devnet: rpc, mainnet: rpc });
  resetRateLimits();
  for (const who of [A.alice, A.bob, A.carol]) tokens[who] = await issueSession(who);
});
afterAll(async () => {
  setStore(null);
  setRpcs({ devnet: null, mainnet: null });
  await store.sql.close();
});

describe('circle packet lifecycle', () => {
  let circle: CircleDetail;
  let root: string;

  it('creates, joins and snapshots a circle', async () => {
    const created = await createCircle(req('POST', '/api/circles', A.alice, { name: 'Lunar crew', emoji: '🧧' }), none_);
    expect(created.status).toBe(201);
    circle = await created.json();
    expect(circle.inviteCode).toMatch(/^[A-Z2-9]{6}$/);

    const joined = await joinCircle(req('POST', '/api/circles/join', A.bob, { inviteCode: circle.inviteCode.toLowerCase() }), none_);
    expect((await joined.json()).members.map((m: { address: string }) => m.address)).toEqual([A.alice, A.bob]);
    expect((await joinCircle(req('POST', '/api/circles/join', A.bob, { inviteCode: 'ZZZZZZ' }), none_)).status).toBe(404);

    const snap = await snapshot(req('POST', `/api/circles/${circle.id}/snapshot`, A.bob, {}), params({ id: circle.id }));
    const body = await snap.json();
    expect(body.members).toEqual([A.alice, A.bob]);
    root = body.root;
    expect(root).toBe(Buffer.from(buildCircleTree([address(A.alice), address(A.bob)]).root).toString('hex'));

    expect((await snapshot(req('POST', `/api/circles/${circle.id}/snapshot`, A.carol, {}), params({ id: circle.id }))).status).toBe(403);
    expect((await listCircles(req('GET', '/api/circles', A.bob), none_)).status).toBe(200);
  });

  it('registers the packet only when the chain agrees', async () => {
    accounts.set(PACKET, packetAccount(Buffer.from(root, 'hex'), 'happy new year'));
    const good = { address: PACKET, message: 'happy new year', skin: 'gold', circleId: circle.id, snapshotRoot: root };

    expect((await register(req('POST', '/api/packets', A.bob, good), none_)).status).toBe(403);
    expect((await register(req('POST', '/api/packets', A.alice, { ...good, message: 'other' }), none_)).status).toBe(400);
    expect((await register(req('POST', '/api/packets', A.alice, { ...good, snapshotRoot: 'ab'.repeat(32) }), none_)).status).toBe(400);
    expect((await register(req('POST', '/api/packets', A.alice, { ...good, circleId: undefined }), none_)).status).toBe(400);

    const res = await register(req('POST', '/api/packets', A.alice, good), none_);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      address: PACKET,
      sender: A.alice,
      token: { symbol: 'tSKR', decimals: 6 },
      total: '10000000',
      shares: 3,
      mode: 'lucky',
      audience: 'circle',
      message: 'happy new year',
      skin: 'gold',
      circleId: circle.id,
      status: 'live',
      createSignature: 'create-sig',
    });
  });

  it('hands members their proof and refuses outsiders', async () => {
    const res = await getProof(req('GET', `/api/packets/${PACKET}/proof?wallet=${A.bob}`), params({ address: PACKET }));
    const { proof } = await res.json();
    const expected = buildCircleTree([address(A.alice), address(A.bob)]).proofOf(address(A.bob));
    expect(proof).toEqual(expected.map((p) => Buffer.from(p).toString('hex')));
    const outsider = await getProof(req('GET', `/api/packets/${PACKET}/proof?wallet=${A.carol}`), params({ address: PACKET }));
    expect(outsider.status).toBe(403);
  });

  it('shows the packet in member feeds, the widget and the circle', async () => {
    const bobFeed = await (await getFeed(req('GET', '/api/feed', A.bob), none_)).json();
    expect(bobFeed.packets.map((p: { address: string }) => p.address)).toEqual([PACKET]);
    const carolFeed = await (await getFeed(req('GET', '/api/feed', A.carol), none_)).json();
    expect(carolFeed.packets).toEqual([]);
    const anon = await (await getFeed(req('GET', '/api/feed'), none_)).json();
    expect(anon).toEqual({ packets: [], rains: [] });

    const w = await (await getWidget(req('GET', '/api/widget', A.bob), none_)).json();
    expect(w).toEqual({ waiting: 1, waitingAmountUi: '10', symbol: 'tSKR', nextRainAt: null, topPacket: PACKET });

    const detail = await (await getCircle(req('GET', `/api/circles/${circle.id}`, A.bob), params({ id: circle.id }))).json();
    expect(detail.packets).toHaveLength(1);
    expect(detail.livePackets).toBe(1);
    expect(detail.leaderboard.generous).toEqual([{ address: A.alice, skrName: null, total: '10000000' }]);
    expect(detail.chains).toEqual([{ root: PACKET, depth: 0, lastKing: null, lastKingSkr: null }]);
    expect((await getCircle(req('GET', `/api/circles/${circle.id}`, A.carol), params({ id: circle.id }))).status).toBe(403);
  });

  it('serves packet detail with grabs', async () => {
    await store.applyGrab({ packet: PACKET, deviceKey: A.bob, claimer: A.bob, index: 0, status: 'won', amount: '5', at: 2_000 });
    const detail = await (await getPacket(req('GET', `/api/packets/${PACKET}`), params({ address: PACKET }))).json();
    expect(detail.grabs).toEqual([
      expect.objectContaining({ claimer: A.bob, amount: '5', status: 'won', grabSignature: null }),
    ]);
    const missing = await getPacket(req('GET', `/api/packets/${A.p2}`), params({ address: A.p2 }));
    expect(missing.status).toBe(404);
  });

  it('registers push tokens', async () => {
    const res = await registerPush(req('POST', '/api/push/register', A.bob, { fcmToken: 'f'.repeat(40) }), none_);
    expect(await res.json()).toEqual({ ok: true });
    expect(await store.pushTokensFor([A.bob])).toHaveLength(1);
  });
});

