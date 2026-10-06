import { describe, expect, it } from 'vitest';
import { equalShare, luckyShare } from '../src/math';

const rnd = (n: number) => {
  const r = new Uint8Array(32);
  new DataView(r.buffer).setBigUint64(0, (BigInt(n) * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn, true);
  return r;
};

describe('share math mirrors the program', () => {
  it('equal split floors and the last share takes the remainder', () => {
    let remaining = 10n;
    const out: bigint[] = [];
    for (const left of [3, 2, 1]) {
      const a = equalShare(remaining, left);
      out.push(a);
      remaining -= a;
    }
    expect(out).toEqual([3n, 3n, 4n]);
  });

  it('lucky shares always sum to the deposit and never starve a later share', () => {
    for (let seed = 0; seed < 500; seed++) {
      let remaining = 1_000_003n;
      let sum = 0n;
      for (let i = 0; i < 7; i++) {
        const left = 7 - i;
        const a = luckyShare(remaining, left, rnd(seed * 31 + i));
        expect(a >= 1n).toBe(true);
        expect(remaining - a >= BigInt(left - 1)).toBe(true);
        remaining -= a;
        sum += a;
      }
      expect(sum).toBe(1_000_003n);
    }
  });

  it('matches the vector pinned in the Rust program', () => {
    expect(luckyShare(1_000_000n, 4, new Uint8Array(32).fill(11))).toBe(343_404n);
  });
});
