import { exportPKCS8, generateKeyPair, jwtVerify, importSPKI, exportSPKI } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/db';
import {
  CHANNELS,
  duration,
  fcmTransport,
  messages,
  pushLuckKing,
  pushPacketDropped,
  pushPacketEmptied,
  pushPaidOut,
  setPushTransport,
  type PushMessage,
  type PushTransport,
} from '@/lib/push';
import { A, freshStore, mirror, wipe } from './helpers';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());
beforeEach(() => wipe(store));
afterEach(() => setPushTransport(undefined));

function fakeTransport(unregistered: string[] = []) {
  const sent: { token: string; message: PushMessage }[] = [];
  const t: PushTransport = {
    async send(token, message) {
      sent.push({ token, message });
      return unregistered.includes(token) ? 'unregistered' : 'ok';
    },
  };
  return { t, sent };
}

describe('fan-out', () => {
  it('circle packets reach the other members once', async () => {
    const { t, sent } = fakeTransport();
    setPushTransport(t);
    const c = await store.createCircle({ name: 'Fam', emoji: null, owner: A.alice, inviteCode: 'PUSH22' });
    await store.addMember(c.id, A.bob);
    await store.registerPushToken(A.alice, 'tok-alice');
    await store.registerPushToken(A.bob, 'tok-bob');
    await store.registerPushToken(A.carol, 'tok-carol');
    await store.upsertPacketMirror(mirror({ address: A.p1, audience: 'circle' }), 'live');
    await store.registerPacket(A.p1, { message: 'for the new year', skin: null, circleId: c.id, snapshotRoot: null, codeHint: null });
    const p = (await store.getPacket(A.p1))!;
    await pushPacketDropped(store, p, 'Fam');
    await pushPacketDropped(store, p, 'Fam');
    expect(sent.map((s) => s.token)).toEqual(['tok-bob']);
    expect(sent[0].message).toMatchObject({
      kind: 'packet_dropped',
      title: expect.stringContaining('dropped a red packet in Fam'),
      body: '“for the new year” — 10 tSKR · 5 shares',
      data: { packet: A.p1, url: `bao://packet/${A.p1}` },
    });
  });

  it('open packets reach every subscriber but the sender and prune dead tokens', async () => {
    const { t, sent } = fakeTransport(['tok-dead']);
    setPushTransport(t);
    await store.registerPushToken(A.alice, 'tok-alice');
    await store.registerPushToken(A.bob, 'tok-bob');
    await store.registerPushToken(A.carol, 'tok-dead');
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await pushPacketDropped(store, (await store.getPacket(A.p1))!, null);
    expect(sent.map((s) => s.token).sort()).toEqual(['tok-bob', 'tok-dead']);
    expect(await store.pushTokensFor([A.carol])).toEqual([]);
  });

  it('tells the sender how fast the packet emptied', async () => {
    const { t, sent } = fakeTransport();
    setPushTransport(t);
    await store.registerPushToken(A.alice, 'tok-alice');
    await store.upsertPacketMirror(mirror({ address: A.p1, totalShares: 2, createdAt: 1_000, startsAt: 1_000 }), 'live');
    await store.applyGrab({ packet: A.p1, deviceKey: A.bob, claimer: A.bob, index: 0, status: 'paid', at: 1_004 });
    await store.applyGrab({ packet: A.p1, deviceKey: A.carol, claimer: A.carol, index: 1, status: 'paid', at: 1_009 });
    await pushPacketEmptied(store, (await store.getPacket(A.p1))!);
    expect(sent[0].message.body).toBe('2 grabs in 9s');
  });

  it('crowns a Luck King once per packet and pays out once per claim, however often it is replayed', async () => {
    const { t, sent } = fakeTransport();
    setPushTransport(t);
    await store.registerPushToken(A.bob, 'tok-bob');
    await store.registerPushToken(A.carol, 'tok-carol');
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await store.upsertPacketMirror(mirror({ address: A.p2 }), 'live');
    const p1 = (await store.getPacket(A.p1))!;
    const p2 = (await store.getPacket(A.p2))!;
    // webhook, poller, webhook retry
    for (let i = 0; i < 3; i++) {
      await pushLuckKing(store, p1, A.bob, '4000000');
      await pushPaidOut(store, p1, A.bob, '4000000');
      await pushPaidOut(store, p1, A.carol, '1000000');
    }
    await pushPaidOut(store, p2, A.bob, '2000000');
    expect(sent.map((s) => `${s.message.kind} ${s.token} ${s.message.data.packet}`)).toEqual([
      `luck_king tok-bob ${A.p1}`,
      `paid_out tok-bob ${A.p1}`,
      `paid_out tok-carol ${A.p1}`,
      `paid_out tok-bob ${A.p2}`,
    ]);
  });

  it('skips quietly without a transport', async () => {
    setPushTransport(null);
    await store.upsertPacketMirror(mirror({ address: A.p1 }), 'live');
    await expect(pushPacketDropped(store, (await store.getPacket(A.p1))!, null)).resolves.toBeUndefined();
  });
});

describe('copy', () => {
  it('formats durations', () => {
    expect(duration(9)).toBe('9s');
    expect(duration(150)).toBe('3 min');
    expect(duration(3_900)).toBe('1 h 5 min');
  });

  it('maps every kind to an android channel', () => {
    const p = { ...mirror({ address: A.p1 }), message: null } as never;
    for (const m of [messages.rainStarting(p), messages.luckKing(p, '1'), messages.paidOut(p, '1', null)]) {
      expect(CHANNELS[m.kind]).toBeTruthy();
    }
  });
});

describe('fcm transport', () => {
  it('exchanges a signed service-account JWT for a token and posts an HTTP v1 message', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const spki = await exportSPKI(publicKey);
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const t = fcmTransport({ project_id: 'bao-test', client_email: 'push@bao-test.iam', private_key: pem }, fetcher);
    const message = messages.rainStarting({ ...mirror({ address: A.p1 }), message: null } as never);
    expect(await t.send('device-token', message)).toBe('ok');
    expect(await t.send('device-token', message)).toBe('ok');

    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    const assertion = new URLSearchParams(String(calls[0].init.body)).get('assertion')!;
    const { payload } = await jwtVerify(assertion, await importSPKI(spki, 'RS256'));
    expect(payload).toMatchObject({ iss: 'push@bao-test.iam', aud: 'https://oauth2.googleapis.com/token' });

    const send = calls[1];
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/bao-test/messages:send');
    expect((send.init.headers as Record<string, string>).authorization).toBe('Bearer at-1');
    const body = JSON.parse(String(send.init.body));
    expect(body.message).toMatchObject({
      token: 'device-token',
      data: { kind: 'rain_starting', packet: A.p1 },
      android: { priority: 'HIGH', notification: { channel_id: 'rains' } },
    });
  });

  it('reports unregistered tokens', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const fetcher = (async (url: string) =>
      url.includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }))
        : new Response('{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 })) as typeof fetch;
    const t = fcmTransport({ project_id: 'p', client_email: 'e', private_key: await exportPKCS8(privateKey) }, fetcher);
    expect(await t.send('gone', messages.rainStarting({ ...mirror({ address: A.p1 }), message: null } as never))).toBe(
      'unregistered',
    );
  });
});
