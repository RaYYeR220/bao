import { readFileSync } from 'node:fs';
import { SplitMode } from '@bao/sdk';
import { describe, expect, it } from 'vitest';
import { decodeEvent, eventDiscriminator, eventsFromLogs, packetStatus, randomnessHex } from '@/lib/chain';
import smoke from './fixtures/smoke-txs.json';

const PROGRAM = 'DifXuyhEu3r7sgXQjgCokyikQFcYCYD2cwhjNyU7j6XR';
const PACKET = 'ASRrZfbPcSoDjjJwuDGhghQyin8meXeb4HwTuEca8rXV';

describe('event discriminators', () => {
  it('match the IDL', () => {
    // from target/idl/bao.json
    const idl: Record<string, number[]> = {
      ClaimForfeited: [74, 212, 70, 124, 240, 136, 166, 82],
      GrabReserved: [242, 118, 27, 39, 108, 130, 82, 217],
      Grabbed: [113, 253, 184, 58, 60, 27, 39, 196],
      LuckKingCrowned: [7, 215, 121, 156, 76, 238, 90, 249],
      PacketClosed: [91, 143, 124, 113, 43, 86, 187, 17],
      PacketCreated: [214, 121, 255, 174, 78, 152, 79, 10],
      PaidOut: [6, 137, 209, 225, 252, 53, 249, 252],
      StaleCancelled: [93, 78, 91, 59, 9, 213, 62, 78],
    };
    for (const [name, disc] of Object.entries(idl)) expect([...eventDiscriminator(name)]).toEqual(disc);
  });
});

describe('events from real devnet transactions', () => {
  it('create_packet emits PacketCreated', () => {
    const { events } = eventsFromLogs(smoke.create_packet.logMessages);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('PacketCreated');
    expect(events[0].data).toMatchObject({
      packet: PACKET,
      mint: 'aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr',
      total: 10_000_000n,
      shares: 2,
      mode: SplitMode.Lucky,
      audience: { __kind: 'Open' },
      seekerOnly: true,
      chainRoot: PACKET,
      chainDepth: 0,
    });
  });

  it('grab_lucky emits GrabReserved (the VRF request is a nested invoke)', () => {
    const { events } = eventsFromLogs(smoke.grab_lucky.logMessages);
    expect(events.map((e) => e.name)).toEqual(['GrabReserved']);
    expect(events[0].data).toMatchObject({ packet: PACKET, index: 0 });
  });

  it('the oracle callback emits Grabbed with the randomness', () => {
    const { events } = eventsFromLogs(smoke.vrf_callback.logMessages);
    expect(events.map((e) => e.name)).toEqual(['Grabbed']);
    const grabbed = events[0];
    if (grabbed.name !== 'Grabbed') throw new Error('unreachable');
    expect(grabbed.data.amount).toBe(4_391_318n);
    expect(grabbed.data.remaining).toBe(10_000_000n - 4_391_318n);
    expect(randomnessHex(grabbed.data.randomness)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('payout emits PaidOut', () => {
    const { events } = eventsFromLogs(smoke.payout.logMessages);
    expect(events).toEqual([{ name: 'PaidOut', data: expect.objectContaining({ packet: PACKET, amount: 4_391_318n }) }]);
  });

  it('ignores Bao-shaped data logged by another program', () => {
    const line = smoke.payout.logMessages.find((l: string) => l.startsWith('Program data:'))!;
    const forged = [
      'Program Fake1111111111111111111111111111111111111 invoke [1]',
      line,
      'Program Fake1111111111111111111111111111111111111 success',
    ];
    expect(eventsFromLogs(forged, PROGRAM).events).toEqual([]);
  });

  it('skips unknown and malformed data lines', () => {
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      'Program data: AAAAAAAAAAAAAA==',
      `Program data: ${Buffer.from([...eventDiscriminator('PaidOut'), 1, 2]).toString('base64')}`,
      `Program ${PROGRAM} success`,
    ];
    expect(eventsFromLogs(logs).events).toEqual([]);
    expect(decodeEvent(new Uint8Array(4))).toBeNull();
  });

  it('flags truncated logs', () => {
    expect(eventsFromLogs(['Log truncated']).truncated).toBe(true);
  });
});

describe('packet status', () => {
  const p = { startsAt: 100, expiresAt: 200, reserved: 0, totalShares: 2 };
  it('follows the clock and the counters', () => {
    expect(packetStatus(p, 50)).toBe('scheduled');
    expect(packetStatus(p, 150)).toBe('live');
    expect(packetStatus(p, 200)).toBe('expired');
    expect(packetStatus({ ...p, reserved: 2 }, 150)).toBe('emptied');
    expect(packetStatus({ ...p, status: 'closed' }, 150)).toBe('closed');
  });
});

it('fixtures are real transactions', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/smoke-txs.json', import.meta.url), 'utf8'));
  expect(Object.values(raw).every((t) => (t as { err: unknown }).err === null)).toBe(true);
});
