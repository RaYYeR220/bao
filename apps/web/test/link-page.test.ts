import { describe, expect, it } from 'vitest';
import type { GrabView, PacketDetail } from '@bao/sdk';
import { countdownText } from '@/lib/countdown';
import { emptiedIn, linkState, packetCopy, shortAddress, span, timeLeft } from '@/lib/link-page';
import { tickCounts } from '@/ui/envelope';
import { A } from './helpers';

const NOW = 1_800_000_000;

function packet(over: Partial<PacketDetail> = {}): PacketDetail {
  return {
    address: A.p1,
    sender: A.alice,
    senderSkr: null,
    token: { mint: A.mint, symbol: 'tSKR', decimals: 6, usd: null },
    total: '168000000',
    remaining: '168000000',
    shares: 8,
    reserved: 0,
    resolved: 0,
    mode: 'lucky',
    audience: 'open',
    seekerOnly: true,
    startsAt: NOW - 900,
    expiresAt: NOW + 85_440,
    createdAt: NOW - 900,
    status: 'live',
    message: null,
    skin: null,
    circleId: null,
    codeHint: null,
    chainRoot: A.p1,
    chainDepth: 0,
    luckKing: null,
    luckKingSkr: null,
    luckKingAmount: null,
    createSignature: null,
    grabs: [],
    ...over,
  };
}

const grab = (claimer: string, at: number): GrabView => ({
  packet: A.p1,
  claimer,
  claimerSkr: null,
  deviceKey: claimer,
  index: 0,
  amount: '1',
  status: 'paid',
  grabSignature: null,
  callbackSignature: null,
  payoutSignature: null,
  randomness: null,
  at,
});

describe('link page copy', () => {
  it('describes a live packet the way the app does', () => {
    const copy = packetCopy(packet({ reserved: 3, resolved: 3 }));
    expect(copy).toMatchObject({
      who: shortAddress(A.alice),
      title: `${shortAddress(A.alice)} dropped a red packet`,
      amountUi: '168',
      symbol: 'tSKR',
      amount: '168 tSKR',
      left: 5,
      state: 'live',
      shares: '5 of 8 shares left',
      kind: 'Public · Lucky split',
      gate: 'Seeker-only',
      gateNote: 'One grab per Seeker Genesis Token',
      status: 'Live · 5 of 8 shares left',
    });
    expect(packetCopy(packet({ senderSkr: 'hana.skr' })).title).toBe('hana.skr dropped a red packet');
  });

  it('names the audience and the split', () => {
    expect(packetCopy(packet({ audience: 'circle', mode: 'equal' })).kind).toBe('Circle · Equal split');
    const code = packetCopy(packet({ audience: 'code', seekerOnly: false, shares: 1, total: '12500000' }));
    expect(code).toMatchObject({ kind: 'Code word · Lucky split', gate: 'Any wallet', gateNote: 'One grab per wallet', shares: '1 of 1 share left', amount: '12.5 tSKR' });
  });

  it('calls a scheduled open packet a rain and says it is not open yet', () => {
    const rain = packet({ status: 'scheduled', createdAt: NOW - 600, startsAt: NOW + 744, expiresAt: NOW + 87_144, shares: 24 });
    expect(packetCopy(rain)).toMatchObject({ state: 'scheduled', kind: 'Public rain · Lucky split', status: 'Not open yet · 24 shares' });
    expect(timeLeft(rain, NOW)).toBe('Opens in 12 min');
  });

  it('describes an emptied packet, also once it is closed', () => {
    const emptied = packet({ status: 'emptied', reserved: 8, resolved: 8 });
    expect(packetCopy(emptied)).toMatchObject({ state: 'emptied', left: 0, shares: 'All 8 shares grabbed', status: 'All 8 shares grabbed' });
    expect(packetCopy({ ...emptied, status: 'closed' }).state).toBe('emptied');
    expect(packetCopy(packet({ status: 'emptied', shares: 1, reserved: 1 })).status).toBe('Grabbed');
    expect(timeLeft(emptied, NOW)).toBe('All shares grabbed');
  });

  it('describes an expired packet, also once it is closed and refunded', () => {
    const expired = packet({ status: 'expired', reserved: 2, resolved: 2, expiresAt: NOW - 60 });
    expect(packetCopy(expired)).toMatchObject({ state: 'expired', left: 6, status: 'Expired · 6 of 8 shares left' });
    expect(packetCopy({ ...expired, status: 'closed' })).toMatchObject({ state: 'expired', status: 'Expired · 6 of 8 shares left' });
    expect(packetCopy(packet({ status: 'expired' })).status).toBe('Expired · nobody grabbed a share');
    expect(packetCopy(packet({ status: 'closed', shares: 1 })).status).toBe('Expired · nobody grabbed it');
    expect(timeLeft(expired, NOW)).toBe('Expired');
    expect(timeLeft({ ...expired, status: 'closed' }, NOW)).toBe('Closed');
  });

  it('maps every packet status to one of the four states the page draws', () => {
    expect(linkState({ status: 'live', shares: 5, reserved: 1 })).toBe('live');
    expect(linkState({ status: 'scheduled', shares: 5, reserved: 0 })).toBe('scheduled');
    expect(linkState({ status: 'emptied', shares: 5, reserved: 5 })).toBe('emptied');
    expect(linkState({ status: 'expired', shares: 5, reserved: 1 })).toBe('expired');
    expect(linkState({ status: 'closed', shares: 5, reserved: 5 })).toBe('emptied');
    expect(linkState({ status: 'closed', shares: 5, reserved: 4 })).toBe('expired');
  });
});

describe('link page times', () => {
  it('spells out spans for the preview image', () => {
    expect(span(45)).toBe('45s');
    expect(span(744)).toBe('12 min');
    expect(span(85_440)).toBe('23 h 44 min');
    expect(span(4 * 86_400)).toBe('4 days');
    expect(span(-5)).toBe('0s');
    expect(timeLeft(packet(), NOW)).toBe('Expires in 23 h 44 min');
  });

  it('counts down like the app: hours and minutes, then minutes and seconds', () => {
    expect(countdownText(85_440)).toBe('23h 44m');
    expect(countdownText(3_600)).toBe('1h 00m');
    expect(countdownText(1_130)).toBe('18:50');
    expect(countdownText(7)).toBe('0:07');
    expect(countdownText(0)).toBe('0:00');
    expect(countdownText(-30)).toBe('0:00');
    expect(countdownText(3 * 86_400 + 5)).toBe('3 days');
  });

  it('knows how fast a packet emptied only when every grab is known', () => {
    const p = packet({ shares: 2, createdAt: 1_000, startsAt: 1_000 });
    expect(emptiedIn({ ...p, grabs: [grab(A.bob, 1_010), grab(A.carol, 1_049)] })).toBe('49s');
    expect(emptiedIn({ ...p, grabs: [grab(A.bob, 1_010)] })).toBeNull();
    expect(emptiedIn({ ...p, grabs: [] })).toBeNull();
    // a rain is timed from when it opened, not from when it was created
    expect(emptiedIn({ ...p, startsAt: 1_600, grabs: [grab(A.bob, 1_700), grab(A.carol, 1_780)] })).toBe('3 min');
  });
});

describe('envelope ticks', () => {
  it('draws one tick per share up to twelve, and lights the share left', () => {
    expect(tickCounts(8, 5)).toEqual({ ticks: 8, lit: 5 });
    expect(tickCounts(3, 3)).toEqual({ ticks: 3, lit: 3 });
    expect(tickCounts(1, 0)).toEqual({ ticks: 1, lit: 0 });
    expect(tickCounts(200, 200)).toEqual({ ticks: 12, lit: 12 });
    expect(tickCounts(200, 100)).toEqual({ ticks: 12, lit: 6 });
    // a single share left of many still shows as one lit tick, never none
    expect(tickCounts(200, 1)).toEqual({ ticks: 12, lit: 1 });
    expect(tickCounts(24, 0)).toEqual({ ticks: 12, lit: 0 });
  });
});
