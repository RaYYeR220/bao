import { address, none, type Instruction } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaimStatus, PAYOUT_DISCRIMINATOR, SplitMode, getClaimRecordEncoder, getPacketEncoder } from '@bao/sdk';
import { payoutClaim } from '@/lib/claims';
import type { Store } from '@/lib/db';
import { base64Account, fakeRpc } from './fake-rpc';
import { A, freshStore } from './helpers';

let store: Store;
beforeAll(async () => {
  store = await freshStore();
});
afterAll(() => store.sql.close());

const CLAIM = address(A.p2);
const b64 = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString('base64');

function rpcWith(status: ClaimStatus | null) {
  const accounts = new Map<string, string>();
  if (status !== null) {
    accounts.set(
      CLAIM,
      b64(
        getClaimRecordEncoder().encode({
          packet: address(A.p1),
          claimer: address(A.bob),
          deviceKey: address(A.carol),
          index: 0,
          amount: 42n,
          status,
          requestedSlot: 5n,
          bump: 255,
        }),
      ),
    );
  }
  accounts.set(
    A.p1,
    b64(
      getPacketEncoder().encode({
        sender: address(A.alice),
        id: 1n,
        mint: address(A.mint),
        tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        totalAmount: 100n,
        remainingAmount: 58n,
        totalShares: 2,
        reserved: 1,
        resolved: 1,
        openClaims: 1,
        mode: SplitMode.Lucky,
        audience: { __kind: 'Open' },
        seekerOnly: true,
        sgtGroup: address(A.dave),
        crankReward: 0n,
        createdAt: 1n,
        startsAt: 1n,
        expiresAt: 9_999_999_999n,
        messageHash: new Uint8Array(32),
        parent: none(),
        chainRoot: address(A.p1),
        chainDepth: 0,
        luckKing: none(),
        luckKingAmount: 0n,
        crowned: false,
        bump: 255,
        vaultBump: 255,
        gasBump: 255,
      }),
    ),
  );
  return fakeRpc({ getAccountInfo: (a) => ({ value: accounts.has(a as string) ? base64Account(accounts.get(a as string)!) : null }) });
}

const crank = { address: address(A.dave) } as never;

describe('instant payout', () => {
  it('pays a won claim with the crank key', async () => {
    const sent: Instruction[][] = [];
    const send = (async (_r: unknown, ixs: Instruction[]) => (sent.push(ixs), 'paysig')) as never;
    await store.applyGrab({ packet: A.p1, deviceKey: A.carol, claimer: A.bob, index: 0, status: 'won', amount: '42', at: 1 });
    expect(await payoutClaim({ store, rpc: rpcWith(ClaimStatus.Won), crank, send }, CLAIM)).toEqual({ status: 'paid', signature: 'paysig' });
    expect([...sent[0][0].data!.subarray(0, 8)]).toEqual([...PAYOUT_DISCRIMINATOR]);
    expect((await store.grabsOf(A.p1))[0]).toMatchObject({ status: 'paid', payoutSignature: 'paysig' });
  });

  it('is idempotent and honest about other states', async () => {
    expect(await payoutClaim({ store, rpc: rpcWith(ClaimStatus.Paid), crank }, CLAIM)).toEqual({ status: 'already-paid', signature: 'paysig' });
    expect(await payoutClaim({ store, rpc: rpcWith(ClaimStatus.Pending), crank }, CLAIM)).toEqual({ status: 'not-won', signature: null });
    await expect(payoutClaim({ store, rpc: rpcWith(null), crank }, CLAIM)).rejects.toMatchObject({ status: 404 });
    await expect(payoutClaim({ store, rpc: rpcWith(ClaimStatus.Won), crank: null }, CLAIM)).rejects.toMatchObject({ status: 503 });
  });
});
