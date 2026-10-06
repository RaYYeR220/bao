import { address, generateKeyPairSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { buildCircleTree, codeHash, hashPair, merkleLeaf } from '../src/merkle';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const verify = (proof: Uint8Array[], root: Uint8Array, leaf: Uint8Array) =>
  hex(proof.reduce((node, sibling) => hashPair(node, sibling), leaf)) === hex(root);

describe('circle tree', () => {
  it('leaf is sha256(0x00 || wallet)', () => {
    expect(hex(merkleLeaf(address('11111111111111111111111111111111')))).toBe(
      '7f9c9e31ac8256ca2f258583df262dbc7d6f68f2a03043d5c99a4ae5a7396ce9',
    );
  });

  it('every member verifies and a stranger does not', async () => {
    const members = await Promise.all(Array.from({ length: 5 }, async () => (await generateKeyPairSigner()).address));
    const tree = buildCircleTree(members);
    for (const m of members) expect(verify(tree.proofOf(m), tree.root, merkleLeaf(m))).toBe(true);
    const stranger = (await generateKeyPairSigner()).address;
    expect(verify(tree.proofOf(members[0]), tree.root, merkleLeaf(stranger))).toBe(false);
  });

  it('a single-member circle has an empty proof', async () => {
    const m = (await generateKeyPairSigner()).address;
    const tree = buildCircleTree([m]);
    expect(tree.proofOf(m)).toEqual([]);
    expect(hex(tree.root)).toBe(hex(merkleLeaf(m)));
  });
});

describe('code word', () => {
  it('is normalized and bound to the packet', () => {
    const packet = address('11111111111111111111111111111111');
    expect(hex(codeHash('  Gongxi Facai ', packet))).toBe('f6f18b227fe26ec4e28d48947f0915062bb252e4a235204327aa5c3cfd1f2527');
  });
});
