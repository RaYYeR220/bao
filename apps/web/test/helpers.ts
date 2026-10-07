import { connectPglite, Store } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import type { PacketMirror } from '@/lib/types';

process.env.BAO_SILENT_LOGS ??= '1';
process.env.BAO_OFFLINE ??= '1';

/** A migrated in-memory database. */
export async function freshStore(): Promise<Store> {
  const sql = await connectPglite();
  await migrate(sql);
  return new Store(sql);
}

export const TABLES = [
  'users',
  'auth_nonces',
  'circles',
  'circle_members',
  'circle_snapshots',
  'packets',
  'grabs',
  'push_tokens',
  'push_receipts',
  'faucet_claims',
  'indexer_cursor',
  'house_rain',
];

export async function wipe(store: Store) {
  await store.sql.exec(`truncate ${TABLES.join(', ')} cascade`);
}

// Fixed, valid base58 addresses for tests.
export const A = {
  alice: '4EtAFmWtCzMxyUku7NofttEPLDWniigFAEL7KmCeCYKo',
  bob: 'BuRJQxYkL43H3MmgmZmRuC1GCDFc1hSkEu2t1mxiDgwK',
  carol: 'aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr',
  dave: 'JCtfrDrv2ha714adGaRDQMj92txd24nucXWw7bA5FWTA',
  mint: 'aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr',
  p1: 'Emeadd17DtR5g5mfFxdrZG2Rtn4M9BHFurkECj6KZuKB',
  p2: 'ASRrZfbPcSoDjjJwuDGhghQyin8meXeb4HwTuEca8rXV',
  p3: 'DifXuyhEu3r7sgXQjgCokyikQFcYCYD2cwhjNyU7j6XR',
  p4: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te',
} as const;

export function mirror(over: Partial<PacketMirror> & { address: string }): PacketMirror {
  return {
    sender: A.alice,
    mint: A.mint,
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 6,
    totalAmount: '10000000',
    remainingAmount: '10000000',
    totalShares: 5,
    reserved: 0,
    resolved: 0,
    mode: 'lucky',
    audience: 'open',
    seekerOnly: true,
    createdAt: 1_000,
    startsAt: 1_000,
    expiresAt: 100_000,
    chainRoot: over.address,
    chainDepth: 0,
    ...over,
  };
}
