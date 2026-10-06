/**
 * A real crank pass on devnet (run with LIVE_TESTS=1). Setup: a one-share Lucky packet that a
 * holder of a fresh test Genesis token grabs; once the VRF callback lands, the crank must select
 * the won share for payout (and nothing for cancel), pay it, and on the next pass close the
 * finished packet (open packets also pay the protocol fee on top of the total). Needs ~/.config/solana/id.json (tSKR + Genesis authority, funds the wallets)
 * and keys/crank.json.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { address, createKeyPairSignerFromBytes, generateKeyPairSigner, lamports, type KeyPairSigner } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaimStatus, DEVNET, buildCreatePacket, buildGrab, fetchMaybeClaimRecord, findGenesisToken } from '@bao/sdk';
import { genesisMemberRentSpace, getMintGenesisMemberInstructions, getMintTestTokenInstructions } from '@bao/sdk/devnet-admin';
import { fetchPacketAccount } from '@/lib/chain';
import { loadChainSnapshot, planCrank, runCrank } from '@/lib/crank';
import type { Store } from '@/lib/db';
import { createRpc, devnetUrl, sendAndConfirm } from '@/lib/rpc';
import { freshStore } from './helpers';

const rpc = createRpc(devnetUrl());
const TSKR = address(DEVNET.tskrMint!);
const GROUP = address(DEVNET.genesisGroup!);
const load = async (path: string) => createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))));

let store: Store;
let admin: KeyPairSigner;
let crank: KeyPairSigner;
let packet: string;
let claim: string;

beforeAll(async () => {
  store = await freshStore();
  admin = await load(`${homedir()}/.config/solana/id.json`);
  crank = await load(new URL('../../../keys/crank.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const sender = await generateKeyPairSigner();
  const grabber = await generateKeyPairSigner();
  await sendAndConfirm(
    rpc,
    [
      getTransferSolInstruction({ source: admin, destination: sender.address, amount: lamports(30_000_000n) }),
      getTransferSolInstruction({ source: admin, destination: grabber.address, amount: lamports(5_000_000n) }),
    ],
    admin,
  );
  const tskr = await getMintTestTokenInstructions({ authority: admin, mint: TSKR, owner: sender.address, amount: 2_000_000n });
  await sendAndConfirm(rpc, tskr.instructions, admin);
  const member = await generateKeyPairSigner();
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(genesisMemberRentSpace(admin.address, member.address, GROUP))).send();
  const sgt = await getMintGenesisMemberInstructions({ authority: admin, member, group: GROUP, owner: grabber.address, lamports: rent });
  await sendAndConfirm(rpc, sgt.instructions, admin);

  const created = await buildCreatePacket({
    sender,
    mint: TSKR,
    treasury: address(DEVNET.treasury!),
    total: 1_000_000n,
    shares: 1,
    mode: 'lucky',
    audience: { kind: 'open' },
    seekerOnly: true,
    expiresIn: 3_600n,
  });
  await sendAndConfirm(rpc, created.instructions, sender);
  packet = created.packet;
  const genesis = await findGenesisToken(rpc, grabber.address, GROUP);
  const grab = await buildGrab({
    claimer: grabber,
    packet: { address: created.packet, mint: TSKR, tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), mode: 'lucky', seekerOnly: true },
    genesis,
  });
  await sendAndConfirm(rpc, [grab.instruction], grabber);
  claim = grab.claim;
  for (let i = 0; i < 60; i++) {
    const record = await fetchMaybeClaimRecord(rpc, grab.claim);
    if (record.exists && record.data.status === ClaimStatus.Won) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('VRF callback did not arrive');
}, 240_000);

afterAll(() => store?.sql.close());

describe('crank on devnet', () => {
  it('selects the won share for payout and does not cancel a fresh grab', async () => {
    const snapshot = await loadChainSnapshot(rpc);
    expect(snapshot.packets.some((p) => p.address === packet)).toBe(true);
    const plan = planCrank(snapshot, { payouts: 1_000, cancels: 1_000, closes: 1_000 });
    expect(plan.payouts.map((p) => p.claim)).toContain(claim);
    expect(plan.cancels.map((c) => c.claim)).not.toContain(claim);
    expect(plan.closes.map((c) => c.packet)).not.toContain(packet);
  }, 60_000);

  it('pays the share, then closes the finished packet', async () => {
    const first = await runCrank({ store, rpc, crank, skipIndexer: true, limits: { payouts: 50, cancels: 0, closes: 0 } });
    expect(first.steps.payouts.result?.done.map((d) => d.target)).toContain(claim);
    const record = await fetchMaybeClaimRecord(rpc, address(claim));
    expect(record.exists && record.data.status).toBe(ClaimStatus.Paid);

    const second = await runCrank({ store, rpc, crank, skipIndexer: true, limits: { payouts: 0, cancels: 0, closes: 20 } });
    expect(second.steps.closes.result?.done.map((d) => d.target)).toContain(packet);
    expect(await fetchPacketAccount(rpc, address(packet))).toBeNull();
  }, 180_000);
});
