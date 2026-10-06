/**
 * End-to-end on devnet with the real MagicBlock VRF:
 *   1. a sender drops a Lucky, Open, Seeker-only packet of tSKR
 *   2. a wallet holding a test Genesis token grabs it; the VRF callback pays it
 *   3. a wallet with no Genesis token is refused by the program
 *   4. the same Genesis token moved to a second wallet is refused by the program
 * Every signature is written to out/smoke-<timestamp>.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  findAssociatedTokenPda as findAta2022,
  getCreateAssociatedTokenIdempotentInstruction as createAta2022,
  getTransferCheckedInstruction as transfer2022,
} from '@solana-program/token-2022';
import {
  Audience,
  ClaimStatus,
  SplitMode,
  fetchMaybeClaimRecord,
  findClaimPda,
  findGenesisToken,
  findPacketPda,
  getCreatePacketInstructionAsync,
  getGrabLuckyInstructionAsync,
  getPayoutInstructionAsync,
} from '@bao/sdk';
import { airdropIfLow, explorer, loadKeypair, readOut, rpc, send, sendExpectingFailure } from './env';
import { mintGenesisMember } from './genesis-group';
import { mintTskr } from './tskr';

const log: Record<string, string | number> = {};
const record = (key: string, value: string | number) => {
  log[key] = value;
  console.log(`${key}: ${typeof value === 'string' && value.length > 80 ? explorer(value) : value}`);
};

async function grabLucky(claimer: KeyPairSigner, packet: Address, mint: Address, sgt: { mint: Address; tokenAccount: Address } | null) {
  const deviceKey = sgt?.mint ?? claimer.address;
  const [claim] = await findClaimPda(packet, deviceKey);
  const [claimerToken] = await findAssociatedTokenPda({ owner: claimer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const ix = await getGrabLuckyInstructionAsync({
    claimer,
    packet,
    mint,
    claim,
    claimerToken,
    sgtMint: sgt?.mint,
    sgtToken: sgt?.tokenAccount,
    args: { deviceKey, proof: [], code: null },
  });
  return { ix, claim, claimerToken };
}

async function main() {
  const admin = await loadKeypair();
  const { genesisGroup, tskrMint } = readOut() as { genesisGroup: Address; tskrMint: Address };

  const sender = await generateKeyPairSigner();
  const grabber = await generateKeyPairSigner();
  const bot = await generateKeyPairSigner();
  const secondWallet = await generateKeyPairSigner();
  for (const w of [sender, grabber, bot, secondWallet]) await airdropIfLow(w.address, 30_000_000n, admin);
  await mintTskr(admin, tskrMint, sender.address, 100_000_000n);
  const minted = await mintGenesisMember(admin, genesisGroup, grabber.address);
  record('genesis_mint_to_grabber', minted.signature);

  // 1. drop a packet
  const id = BigInt(Date.now());
  const [packet] = await findPacketPda(sender.address, id);
  const [senderToken] = await findAssociatedTokenPda({ owner: sender.address, mint: tskrMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [treasuryToken] = await findAssociatedTokenPda({ owner: admin.address, mint: tskrMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const create = await getCreatePacketInstructionAsync({
    sender,
    packet,
    mint: tskrMint,
    senderToken,
    treasuryToken,
    id,
    total: 10_000_000n,
    shares: 2,
    mode: SplitMode.Lucky,
    audience: { __kind: 'Open' },
    seekerOnly: true,
    expiresIn: 3_600n,
    messageHash: new Uint8Array(32),
    maxFeeBps: 100,
  });
  record('packet', packet);
  record('create_packet', await send([create], sender));

  // 2. a Seeker grabs; the VRF callback assigns the share; payout moves the tokens
  const sgt = await findGenesisToken(rpc, grabber.address, genesisGroup);
  if (!sgt) throw new Error('grabber has no genesis token');
  const grab = await grabLucky(grabber, packet, tskrMint, sgt);
  const started = Date.now();
  record('grab_lucky', await send([grab.ix], grabber));
  let won = false;
  for (let i = 0; i < 60 && !won; i++) {
    const claim = await fetchMaybeClaimRecord(rpc, grab.claim);
    if (claim.exists && claim.data.status === ClaimStatus.Won) {
      won = true;
      record('vrf_latency_ms', Date.now() - started);
      record('lucky_amount', Number(claim.data.amount));
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!won) throw new Error('VRF callback did not arrive within 30s');
  const sigs = await rpc.getSignaturesForAddress(grab.claim, { limit: 5 }).send();
  const callback = sigs.find((s) => s.signature !== log.grab_lucky);
  if (callback) record('vrf_callback', callback.signature);
  record(
    'payout',
    await send(
      [await getPayoutInstructionAsync({ payer: grabber, packet, claim: grab.claim, mint: tskrMint, claimer: grabber.address, claimerToken: grab.claimerToken })],
      grabber,
    ),
  );
  const paid = await fetchMaybeClaimRecord(rpc, grab.claim);
  if (!paid.exists || paid.data.status !== ClaimStatus.Paid) throw new Error('payout did not settle the claim');

  // 3. a wallet with no genesis token is refused
  const botGrab = await grabLucky(bot, packet, tskrMint, null);
  const refused = await sendExpectingFailure([botGrab.ix], bot);
  record('refused_no_genesis', refused.signature);
  record('refused_no_genesis_error', JSON.stringify(refused.err, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  if (!refused.logs.some((l) => l.includes('NotASeeker'))) throw new Error(`expected NotASeeker:\n${refused.logs.join('\n')}`);

  // 4. the same genesis token in a second wallet is refused
  const [secondAta] = await findAta2022({ owner: secondWallet.address, mint: sgt.mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  record(
    'move_genesis_to_second_wallet',
    await send(
      [
        createAta2022({ payer: grabber, ata: secondAta, owner: secondWallet.address, mint: sgt.mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
        transfer2022({ source: sgt.tokenAccount, mint: sgt.mint, destination: secondAta, authority: grabber, amount: 1n, decimals: 0 }),
      ],
      grabber,
    ),
  );
  const replay = await grabLucky(secondWallet, packet, tskrMint, { mint: sgt.mint, tokenAccount: secondAta });
  const refusedReplay = await sendExpectingFailure([replay.ix], secondWallet);
  record('refused_same_device', refusedReplay.signature);
  if (!refusedReplay.logs.some((l) => l.includes('AlreadyGrabbedOnThisDevice'))) {
    throw new Error(`expected AlreadyGrabbedOnThisDevice:\n${refusedReplay.logs.join('\n')}`);
  }

  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  const file = new URL(`../out/smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(log, null, 2) + '\n');
  console.log(`\nsmoke OK -> ${file.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
