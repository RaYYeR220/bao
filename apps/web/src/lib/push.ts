/**
 * Push notifications over FCM HTTP v1. OAuth uses a service-account JWT signed with jose,
 * so no firebase-admin. Without FIREBASE_SERVICE_ACCOUNT_JSON pushes are logged and skipped.
 */
import { importPKCS8, SignJWT } from 'jose';
import type { PushKind } from '@bao/sdk';
import type { Store } from './db';
import { env } from './env';
import { log } from './log';
import { formatUi, tokenMeta } from './tokens';
import type { PacketRecord } from './types';

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushResult = 'ok' | 'unregistered' | 'error';

export interface PushTransport {
  send(token: string, message: PushMessage): Promise<PushResult>;
}

/** Android notification channels the app registers (ids must match). */
export const CHANNELS: Record<PushKind, string> = {
  packet_dropped: 'packets',
  rain_starting: 'rains',
  packet_emptied: 'results',
  luck_king: 'results',
  paid_out: 'results',
};

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(json: string): ServiceAccount {
  const sa = JSON.parse(json) as Partial<ServiceAccount>;
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error('service account JSON needs project_id, client_email and private_key');
  }
  return sa as ServiceAccount;
}

export function fcmTransport(sa: ServiceAccount, fetcher: typeof fetch = fetch): PushTransport {
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetcher(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`fcm oauth ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  }

  return {
    async send(token, message) {
      const res = await fetcher(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: { kind: message.kind, ...message.data },
            android: {
              priority: 'HIGH',
              notification: { channel_id: CHANNELS[message.kind], tag: message.data.packet ?? message.kind },
            },
          },
        }),
      });
      if (res.ok) return 'ok';
      const text = await res.text();
      if (res.status === 404 || /UNREGISTERED|registration token/i.test(text)) return 'unregistered';
      log.warn('push.send_failed', { status: res.status, body: text.slice(0, 300) });
      return 'error';
    },
  };
}

let transport: PushTransport | null | undefined;

export function getPushTransport(): PushTransport | null {
  if (transport !== undefined) return transport;
  const json = env().FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    log.once('push.disabled', { note: 'FIREBASE_SERVICE_ACCOUNT_JSON unset; pushes are logged and skipped' });
    transport = null;
    return null;
  }
  try {
    transport = fcmTransport(parseServiceAccount(json));
  } catch (e) {
    log.error('push.bad_service_account', { error: (e as Error).message });
    transport = null;
  }
  return transport;
}

export function setPushTransport(t: PushTransport | null | undefined) {
  transport = t;
}

/** Sends to each token; drops tokens FCM reports as unregistered. Never throws. */
export async function deliver(store: Store, recipients: { token: string; address: string }[], message: PushMessage) {
  const t = getPushTransport();
  if (!t) {
    log.info('push.skipped', { kind: message.kind, recipients: recipients.length, title: message.title });
    return { sent: 0, skipped: recipients.length };
  }
  let sent = 0;
  for (const r of recipients) {
    try {
      const result = await t.send(r.token, message);
      if (result === 'ok') sent++;
      if (result === 'unregistered') await store.deletePushToken(r.token);
    } catch (e) {
      log.warn('push.error', { kind: message.kind, error: (e as Error).message });
    }
  }
  return { sent, skipped: 0 };
}

// ---------- copy ----------

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function amount(p: PacketRecord, base: string) {
  const meta = tokenMeta(p.mint, p.decimals);
  return `${formatUi(base, meta.decimals)} ${meta.symbol}`;
}

const linkData = (p: PacketRecord) => ({ packet: p.address, url: `bao://packet/${p.address}` });

export const messages = {
  packetDropped(p: PacketRecord, senderName: string | null, circleName: string | null): PushMessage {
    const who = senderName ?? short(p.sender);
    const what = `${amount(p, p.totalAmount)} · ${p.totalShares} ${p.totalShares === 1 ? 'share' : 'shares'}`;
    return {
      kind: 'packet_dropped',
      title: `${who} dropped a red packet${circleName ? ` in ${circleName}` : ''}`,
      body: p.message ? `“${p.message}” — ${what}` : `${what}. Shake to grab!`,
      data: linkData(p),
    };
  },
  rainStarting(p: PacketRecord): PushMessage {
    return {
      kind: 'rain_starting',
      title: 'A rain is starting',
      body: `${amount(p, p.totalAmount)} for ${p.totalShares} Seekers — open Bao to grab`,
      data: linkData(p),
    };
  },
  packetEmptied(p: PacketRecord, grabs: number, seconds: number): PushMessage {
    return {
      kind: 'packet_emptied',
      title: 'Your packet was emptied',
      body: `${grabs} ${grabs === 1 ? 'grab' : 'grabs'} in ${duration(seconds)}`,
      data: linkData(p),
    };
  },
  luckKing(p: PacketRecord, amountBase: string): PushMessage {
    return {
      kind: 'luck_king',
      title: 'You are the Luck King',
      body: `Biggest grab: ${amount(p, amountBase)}. By custom, you send the next one.`,
      data: linkData(p),
    };
  },
  paidOut(p: PacketRecord, amountBase: string, senderName: string | null): PushMessage {
    return {
      kind: 'paid_out',
      title: 'Your share arrived',
      body: `${amount(p, amountBase)} from ${senderName ?? short(p.sender)}'s packet`,
      data: linkData(p),
    };
  },
};

// ---------- fan-out ----------

/** Circle members for circle packets, every subscriber for open ones; never the sender. Once per packet. */
export async function pushPacketDropped(store: Store, p: PacketRecord, circleName: string | null) {
  if (p.audience === 'code') return;
  if (!(await store.claimPushFlag(p.address, 'dropped_push_at'))) return;
  const recipients =
    p.audience === 'circle' && p.circleId
      ? await store.pushTokensFor((await store.members(p.circleId)).map((m) => m.address).filter((a) => a !== p.sender))
      : await store.allPushTokens([p.sender]);
  const names = await store.skrNames([p.sender]);
  await deliver(store, recipients, messages.packetDropped(p, names.get(p.sender) ?? null, circleName));
}

export async function pushRainStarting(store: Store, p: PacketRecord) {
  if (!(await store.claimPushFlag(p.address, 'rain_push_at'))) return;
  await deliver(store, await store.allPushTokens([p.sender]), messages.rainStarting(p));
}

export async function pushPacketEmptied(store: Store, p: PacketRecord) {
  if (!(await store.claimPushFlag(p.address, 'emptied_push_at'))) return;
  const times = await store.grabTimes(p.address);
  const seconds = times.last !== null ? times.last - Math.max(p.startsAt, p.createdAt) : 0;
  await deliver(store, await store.pushTokensFor([p.sender]), messages.packetEmptied(p, p.totalShares, seconds));
}

export async function pushLuckKing(store: Store, p: PacketRecord, king: string, amountBase: string) {
  await deliver(store, await store.pushTokensFor([king]), messages.luckKing(p, amountBase));
}

export async function pushPaidOut(store: Store, p: PacketRecord, claimer: string, amountBase: string) {
  const names = await store.skrNames([p.sender]);
  await deliver(store, await store.pushTokensFor([claimer]), messages.paidOut(p, amountBase, names.get(p.sender) ?? null));
}
