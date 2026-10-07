/** Data and copy for the public packet link page and its preview image. */
import { cache } from 'react';
import type { PacketDetail, PacketView } from '@bao/sdk';
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

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** What the link page draws. A closed packet shows as whichever way it ended. */
export type LinkState = 'live' | 'scheduled' | 'emptied' | 'expired';

export function linkState(p: Pick<PacketView, 'status' | 'shares' | 'reserved'>): LinkState {
  if (p.status === 'closed') return p.reserved >= p.shares ? 'emptied' : 'expired';
  return p.status;
}

type CopyInput = Pick<
  PacketView,
  'sender' | 'senderSkr' | 'token' | 'total' | 'shares' | 'reserved' | 'mode' | 'audience' | 'seekerOnly' | 'status' | 'startsAt' | 'createdAt'
>;

export function packetCopy(p: CopyInput) {
  const who = p.senderSkr ?? shortAddress(p.sender);
  const amountUi = formatUi(p.total, p.token.decimals);
  const left = Math.max(0, p.shares - p.reserved);
  const state = linkState(p);
  const split = p.mode === 'lucky' ? 'Lucky split' : 'Equal split';
  // an open packet created before it opens is a rain
  const audience = p.audience === 'circle' ? 'Circle' : p.audience === 'code' ? 'Code word' : p.startsAt > p.createdAt ? 'Public rain' : 'Public';
  const shares =
    state === 'emptied'
      ? p.shares === 1
        ? 'Grabbed'
        : `All ${p.shares} shares grabbed`
      : `${left} of ${p.shares} ${plural(p.shares, 'share')} left`;
  return {
    who,
    title: `${who} dropped a red packet`,
    amountUi,
    symbol: p.token.symbol,
    amount: `${amountUi} ${p.token.symbol}`,
    left,
    state,
    shares,
    /** The line over the amount, as the app writes it: "Public · Lucky split". */
    kind: `${audience} · ${split}`,
    mode: p.mode === 'lucky' ? 'Random shares, drawn on-chain. The biggest grab is crowned Luck King.' : 'Every grab gets the same share.',
    gate: p.seekerOnly ? 'Seeker-only' : 'Any wallet',
    gateNote: p.seekerOnly ? 'One grab per Seeker Genesis Token' : 'One grab per wallet',
    /** The state in a few words, for the status line and the preview image. */
    status:
      state === 'live'
        ? `Live · ${shares}`
        : state === 'scheduled'
          ? `Not open yet · ${p.shares} ${plural(p.shares, 'share')}`
          : state === 'emptied'
            ? shares
            : left === p.shares
              ? `Expired · nobody grabbed ${p.shares === 1 ? 'it' : 'a share'}`
              : `Expired · ${shares}`,
  };
}

export type PacketCopy = ReturnType<typeof packetCopy>;

/** "45s", "5 min", "22 h 30 min", "3 days". */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(h / 24)} days`;
}

export function timeLeft(p: Pick<PacketDetail, 'status' | 'startsAt' | 'expiresAt'>, now = Math.floor(Date.now() / 1000)) {
  if (p.status === 'scheduled') return `Opens in ${span(p.startsAt - now)}`;
  if (p.status === 'live') return `Expires in ${span(p.expiresAt - now)}`;
  if (p.status === 'emptied') return 'All shares grabbed';
  if (p.status === 'expired') return 'Expired';
  return 'Closed';
}

/** How long an emptied packet took, from opening to its last grab; null when the grabs are not all known. */
export function emptiedIn(p: Pick<PacketDetail, 'shares' | 'startsAt' | 'createdAt' | 'grabs'>): string | null {
  if (p.grabs.length === 0 || p.grabs.length < p.shares) return null;
  const last = Math.max(...p.grabs.map((g) => g.at));
  const took = last - Math.max(p.startsAt, p.createdAt);
  return took > 0 ? span(took) : null;
}
