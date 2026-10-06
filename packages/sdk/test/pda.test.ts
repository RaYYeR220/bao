import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { findClaimPda, findPacketPda } from '../src/pda';

const sender = address('4EtAFmWtCzMxyUku7NofttEPLDWniigFAEL7KmCeCYKo');

describe('pdas', () => {
  it('packet address is deterministic per sender and id', async () => {
    const [a] = await findPacketPda(sender, 1n);
    const [b] = await findPacketPda(sender, 1n);
    const [c] = await findPacketPda(sender, 2n);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('claim address depends on the device key', async () => {
    const [packet] = await findPacketPda(sender, 1n);
    const [x] = await findClaimPda(packet, address('So11111111111111111111111111111111111111112'));
    const [y] = await findClaimPda(packet, address('SysvarC1ock11111111111111111111111111111111'));
    expect(x).not.toBe(y);
  });
});
