/**
 * Playground faucet (devnet only): test SOL, tSKR and a test Genesis token from our devnet
 * group, once per wallet per 24 h. Each grant is independent: one failing does not block the rest.
 */
import { address as toAddress, generateKeyPairSigner, lamports, type KeyPairSigner } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { findGenesisToken, type FaucetResult } from '@bao/sdk';
import { genesisMemberRentSpace, getMintGenesisMemberInstructions, getMintTestTokenInstructions } from '@bao/sdk/devnet-admin';
import type { Store } from './db';
import { env } from './env';
import { errorMessage, log } from './log';
import { sendAndConfirm, type SolanaRpc } from './rpc';
import { HttpError } from './types';

export interface FaucetDeps {
  store: Store;
  rpc: SolanaRpc;
  /** Pays the SOL drip. */
  faucet: KeyPairSigner | null;
  /** tSKR mint authority and Genesis group update authority. */
  authority: KeyPairSigner | null;
  send?: typeof sendAndConfirm;
}

export async function runFaucet(deps: FaucetDeps, wallet: string): Promise<FaucetResult> {
  const { store, rpc } = deps;
  const send = deps.send ?? sendAndConfirm;
  const e = env();
  const owner = toAddress(wallet);
  if (!(await store.reserveFaucet(wallet))) throw new HttpError(429, 'faucet already used by this wallet in the last 24 hours');

  const result: FaucetResult = { sol: null, tskr: null, genesis: null };
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${name}: ${errorMessage(err)}`);
      log.error('faucet.step_failed', { step: name, wallet, error: errorMessage(err) });
    }
  };

  await step('sol', async () => {
    if (!deps.faucet) return log.once('faucet.no_sol_key', { note: 'no faucet keypair; skipping SOL' });
    result.sol = await send(
      rpc,
      [getTransferSolInstruction({ source: deps.faucet, destination: owner, amount: lamports(e.FAUCET_SOL_LAMPORTS) })],
      deps.faucet,
    );
  });

  await step('tskr', async () => {
    if (!deps.authority) return log.once('faucet.no_authority', { note: 'no mint authority; skipping tSKR and Genesis' });
    const { instructions } = await getMintTestTokenInstructions({
      authority: deps.authority,
      mint: toAddress(e.TSKR_MINT),
      owner,
      amount: e.FAUCET_TSKR_UNITS,
    });
    result.tskr = await send(rpc, instructions, deps.authority);
  });

  await step('genesis', async () => {
    if (!deps.authority) return;
    const group = toAddress(e.GENESIS_GROUP);
    const held = await findGenesisToken(rpc, owner, group);
    if (held) {
      await store.saveDevnetGenesis(wallet, held.mint);
      return;
    }
    const member = await generateKeyPairSigner();
    const rent = await rpc
      .getMinimumBalanceForRentExemption(BigInt(genesisMemberRentSpace(deps.authority.address, member.address, group)))
      .send();
    const minted = await getMintGenesisMemberInstructions({ authority: deps.authority, member, group, owner, lamports: rent });
    const signature = await send(rpc, minted.instructions, deps.authority);
    result.genesis = { mint: minted.mint, signature };
    await store.saveDevnetGenesis(wallet, minted.mint);
  });

  const granted = result.sol || result.tskr || result.genesis;
  if (!granted && errors.length > 0) {
    await store.releaseFaucet(wallet);
    throw new HttpError(502, `faucet failed: ${errors.join('; ')}`);
  }
  await store.recordFaucet(wallet, {
    sol: result.sol,
    tskr: result.tskr,
    genesisMint: result.genesis?.mint ?? null,
    genesisSignature: result.genesis?.signature ?? null,
  });
  log.info('faucet.granted', { wallet, ...result, errors });
  return result;
}
