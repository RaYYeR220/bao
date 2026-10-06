/** Equal split: floor(remaining / sharesLeft); the last share takes the remainder. */
export function equalShare(remaining: bigint, sharesLeft: number): bigint {
  return sharesLeft <= 1 ? remaining : remaining / BigInt(sharesLeft);
}

/**
 * Double-mean split, identical to the program: uniform in [1, cap] where
 * cap = min(2 * remaining / sharesLeft, remaining - (sharesLeft - 1)).
 */
export function luckyShare(remaining: bigint, sharesLeft: number, randomness: Uint8Array): bigint {
  const n = BigInt(sharesLeft);
  if (n <= 1n) return remaining;
  const maxForThis = remaining - (n - 1n);
  let cap = (remaining * 2n) / n;
  if (cap > maxForThis) cap = maxForThis;
  if (cap < 1n) cap = 1n;
  const r = new DataView(randomness.buffer, randomness.byteOffset, 8).getBigUint64(0, true);
  return 1n + (r % cap);
}
