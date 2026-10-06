/** Instant payout of a won lucky share, sent by the crank key (the instruction is permissionless). */
import { type Address, type KeyPairSigner } from '@solana/kit';
import { ClaimStatus, buildPayout, fetchMaybeClaimRecord } from '@bao/sdk';
import { fetchPacketAccount } from './chain';
import type { Store } from './db';
import { errorMessage, log } from './log';
import { sendAndConfirm, type SolanaRpc } from './rpc';
import { HttpError } from './types';

export interface PayoutResult {
  status: 'paid' | 'already-paid' | 'not-won';
  signature: string | null;
}

const inFlight = new Map<string, Promise<PayoutResult>>();

export function payoutClaim(
  deps: { store: Store; rpc: SolanaRpc; crank: KeyPairSigner | null; send?: typeof sendAndConfirm },
  claim: Address,
): Promise<PayoutResult> {
  const running = inFlight.get(claim);
  if (running) return running;
  const job = doPayout(deps, claim).finally(() => inFlight.delete(claim));
  inFlight.set(claim, job);
  return job;
}

async function doPayout(
  deps: { store: Store; rpc: SolanaRpc; crank: KeyPairSigner | null; send?: typeof sendAndConfirm },
  claim: Address,
): Promise<PayoutResult> {
  const send = deps.send ?? sendAndConfirm;
  const record = await fetchMaybeClaimRecord(deps.rpc, claim, { commitment: 'confirmed' });
  if (!record.exists) throw new HttpError(404, 'claim not found (never made, cancelled or already closed)');
  const paidSignature = async () =>
    (await deps.store.grabsOf(record.data.packet)).find((g) => g.deviceKey === record.data.deviceKey)?.payoutSignature ?? null;
  if (record.data.status === ClaimStatus.Paid) return { status: 'already-paid', signature: await paidSignature() };
  if (record.data.status !== ClaimStatus.Won) return { status: 'not-won', signature: null };
  if (!deps.crank) throw new HttpError(503, 'payouts are not configured on this server; the share stays claimable');

  const packet = await fetchPacketAccount(deps.rpc, record.data.packet);
  if (!packet) throw new HttpError(409, 'packet already closed');
  try {
    const ix = await buildPayout({
      payer: deps.crank,
      packet: record.data.packet,
      claim,
      claimer: record.data.claimer,
      mint: packet.mint,
      tokenProgram: packet.tokenProgram,
    });
    const signature = await send(deps.rpc, [ix], deps.crank);
    await deps.store.markPaid(record.data.packet, record.data.claimer, record.data.amount.toString(), signature);
    return { status: 'paid', signature };
  } catch (e) {
    // another payer (the crank, the app) may have won the race
    const again = await fetchMaybeClaimRecord(deps.rpc, claim, { commitment: 'confirmed' });
    if (again.exists && again.data.status === ClaimStatus.Paid) return { status: 'already-paid', signature: await paidSignature() };
    log.error('claims.payout_failed', { claim, error: errorMessage(e) });
    throw new HttpError(502, `payout failed: ${errorMessage(e).slice(0, 200)}`);
  }
}
