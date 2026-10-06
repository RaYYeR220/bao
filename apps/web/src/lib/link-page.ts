/** Data for the public packet link page and its preview image. */
import { cache } from 'react';
import type { PacketDetail } from '@bao/sdk';
import { packetDetail } from './packets';
import { deps } from './server';
import { formatUi } from './tokens';
import { HttpError } from './types';

export const loadPacketPage = cache(async (address: string): Promise<PacketDetail | null> => {
  try {
    const d = await deps();
    return await packetDetail(d.store, d.devnet, address);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
});

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function packetCopy(p: PacketDetail) {
  const who = p.senderSkr ?? shortAddress(p.sender);
  const amount = `${formatUi(p.total, p.token.decimals)} ${p.token.symbol}`;
  const left = p.shares - p.reserved;
  return {
    title: `${who} dropped a red packet`,
    amount,
    shares: `${left} of ${p.shares} ${p.shares === 1 ? 'share' : 'shares'} left`,
    mode: p.mode === 'lucky' ? 'Lucky split — random shares, biggest grab is crowned Luck King' : 'Equal split',
    gate: p.seekerOnly ? 'One grab per Seeker Genesis Token' : 'Open to any wallet',
  };
}

export function timeLeft(p: Pick<PacketDetail, 'status' | 'startsAt' | 'expiresAt'>, now = Math.floor(Date.now() / 1000)) {
  const fmt = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    const h = Math.floor(s / 3600);
    return h < 48 ? `${h} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(h / 24)} days`;
  };
  if (p.status === 'scheduled') return `Opens in ${fmt(p.startsAt - now)}`;
  if (p.status === 'live') return `Expires in ${fmt(p.expiresAt - now)}`;
  if (p.status === 'emptied') return 'All shares grabbed';
  if (p.status === 'expired') return 'Expired';
  return 'Closed';
}
