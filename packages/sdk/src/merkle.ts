import { getAddressEncoder, type Address } from '@solana/kit';
import { sha256 } from '@noble/hashes/sha256';

const addressBytes = getAddressEncoder();

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Inner node: sha256(0x01 || min(a, b) || max(a, b)). */
export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(new Uint8Array([1, ...lo, ...hi]));
}

/** Leaf: sha256(0x00 || wallet). */
export function merkleLeaf(wallet: Address): Uint8Array {
  return sha256(new Uint8Array([0, ...addressBytes.encode(wallet)]));
}

/** Snapshot of a circle: the root goes into the packet, each member grabs with its proof. */
export function buildCircleTree(members: readonly Address[]) {
  const levels: Uint8Array[][] = [members.map(merkleLeaf)];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }
    levels.push(next);
  }
  const root = levels[levels.length - 1][0];
  const proofOf = (member: Address): Uint8Array[] => {
    let pos = members.indexOf(member);
    if (pos < 0) throw new Error(`${member} is not in this circle`);
    const proof: Uint8Array[] = [];
    for (let level = 0; level < levels.length - 1; level++) {
      const sibling = pos ^ 1;
      if (sibling < levels[level].length) proof.push(levels[level][sibling]);
      pos >>= 1;
    }
    return proof;
  };
  return { root, proofOf };
}

/** Normalizes a code word (NFC, trimmed, lowercase); the program stores sha256(code || packet). */
export function normalizeCode(code: string): Uint8Array {
  return new TextEncoder().encode(code.normalize('NFC').trim().toLowerCase());
}

export function codeHash(code: string, packet: Address): Uint8Array {
  return sha256(new Uint8Array([...normalizeCode(code), ...addressBytes.encode(packet)]));
}

export const bytesToHex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
