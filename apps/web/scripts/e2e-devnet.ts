/**
 * End to end against a running API (local Postgres) and real devnet:
 *   sign in two fresh wallets -> faucet -> circle + snapshot -> a Lucky circle packet created
 *   with the SDK -> registered -> grabbed by the other member -> VRF -> /api/cron/tick pays it
 *   -> the grab shows up indexed and paid, and the feed shows the packet.
 *
 *   BASE_URL=http://localhost:3000 CRON_SECRET=... pnpm --filter web e2e
 */
import { createSignInMessageText } from '@solana/wallet-standard-util';
import { address, generateKeyPairSigner, signBytes, type KeyPairSigner } from '@solana/kit';
import {
  ClaimStatus,
  DEVNET,
  buildCreatePacket,
  buildGrab,
  createBaoApi,
  fetchMaybeClaimRecord,
  findGenesisToken,
  hexToBytes,
} from '@bao/sdk';
import { createRpc, devnetUrl, explorerTx, sendAndConfirm } from '../src/lib/rpc';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const rpc = createRpc(devnetUrl());
const log: Record<string, unknown> = {};
const record = (key: string, value: unknown) => {
  log[key] = value;
  const text = typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value) ? `${value}\n    ${explorerTx(value)}` : JSON.stringify(value);
  console.log(`${key}: ${text}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(wallet: KeyPairSigner) {
  let token: string | null = null;
  const api = createBaoApi(BASE_URL, () => token);
  const input = await api.call('POST /api/auth/nonce', { body: { address: wallet.address } });
  const message = new TextEncoder().encode(createSignInMessageText(input));
  const signature = await signBytes(wallet.keyPair.privateKey, message);
  const res = await api.call('POST /api/auth/verify', {
    body: {
      input,
      output: {
        address: wallet.address,
        signedMessage: Buffer.from(message).toString('base64'),
        signature: Buffer.from(signature).toString('base64'),
      },
    },
  });
  token = res.token;
  return api;
}

async function tick() {
  const res = await fetch(`${BASE_URL}/api/cron/tick`, { method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}` } });
  const body = (await res.json()) as {
    ok: boolean;
    steps: Record<string, { ok: boolean; error?: string; result?: { done?: { target: string; signature: string }[]; processed?: number } }>;
  };
  return { status: res.status, body };
}

async function main() {
  if (!CRON_SECRET) throw new Error('set CRON_SECRET to the value the server uses');
  const sender = await generateKeyPairSigner();
  const grabber = await generateKeyPairSigner();
  record('sender', sender.address);
  record('grabber', grabber.address);

  // 1. sign in
  const senderApi = await signIn(sender);
  const grabberApi = await signIn(grabber);
  record('signed_in', (await senderApi.call('GET /api/me')).address === sender.address);

  // 2. faucet: SOL, tSKR and a test Genesis token for both
  const senderFaucet = await senderApi.call('POST /api/faucet');
  const grabberFaucet = await grabberApi.call('POST /api/faucet');
  record('faucet_sender', senderFaucet);
  record('faucet_grabber', grabberFaucet);
  if (!senderFaucet.sol || !senderFaucet.tskr || !grabberFaucet.sol || !grabberFaucet.genesis) throw new Error('faucet incomplete');

  // 3. circle + snapshot
  const circle = await senderApi.call('POST /api/circles', { body: { name: 'E2E crew', emoji: '🧧' } });
  await grabberApi.call('POST /api/circles/join', { body: { inviteCode: circle.inviteCode } });
  const snapshot = await senderApi.call('POST /api/circles/:id/snapshot', { params: { id: circle.id } });
  record('circle', { id: circle.id, invite: circle.inviteCode, root: snapshot.root, members: snapshot.members.length });

  // 4. a Lucky, Seeker-only circle packet, created on devnet with the SDK
  const message = 'e2e: happy grabbing';
  const created = await buildCreatePacket({
    sender,
    mint: address(DEVNET.tskrMint!),
    treasury: address(DEVNET.treasury!),
    total: 2_000_000n,
    shares: 2,
    mode: 'lucky',
    audience: { kind: 'circle', root: hexToBytes(snapshot.root) },
    seekerOnly: true,
    expiresIn: 3_600n,
    message,
  });
  record('packet', created.packet);
  record('create_packet', await sendAndConfirm(rpc, created.instructions, sender));

  // 5. register the app metadata
  const view = await senderApi.call('POST /api/packets', {
    body: { address: created.packet, message, skin: 'gold', circleId: circle.id, snapshotRoot: snapshot.root },
  });
  record('registered', { status: view.status, audience: view.audience, circleId: view.circleId, message: view.message });

  // 6. the other member grabs with their Merkle proof and test Genesis token
  const { proof } = await grabberApi.call('GET /api/packets/:address/proof', {
    params: { address: created.packet },
    query: { wallet: grabber.address },
  });
  const genesis = await findGenesisToken(rpc, grabber.address, address(DEVNET.genesisGroup!));
  if (!genesis) throw new Error('grabber has no test Genesis token');
  const grab = await buildGrab({
    claimer: grabber,
    packet: { address: created.packet, mint: address(DEVNET.tskrMint!), tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), mode: 'lucky', seekerOnly: true },
    genesis,
    proof: proof.map(hexToBytes),
  });
  record('grab_lucky', await sendAndConfirm(rpc, [grab.instruction], grabber));

  // 7. wait for the VRF callback
  const started = Date.now();
  for (;;) {
    const claim = await fetchMaybeClaimRecord(rpc, grab.claim);
    if (claim.exists && claim.data.status !== ClaimStatus.Pending) {
      record('vrf_ms', Date.now() - started);
      record('lucky_amount', claim.data.amount.toString());
      break;
    }
    if (Date.now() - started > 60_000) throw new Error('no VRF callback within 60s');
    await sleep(1_000);
  }

  // 8. the crank pays the won share and the indexer catches up
  let paid = false;
  for (let i = 1; i <= 4 && !paid; i++) {
    const { status, body } = await tick();
    const payout = body.steps.payouts?.result?.done?.find((d) => d.target === grab.claim);
    if (payout) record('crank_payout', payout.signature);
    record(`tick_${i}`, {
      status,
      ok: body.ok,
      payouts: body.steps.payouts?.result?.done?.length ?? 0,
      indexed: body.steps.indexer?.result?.processed ?? 0,
      failed: Object.entries(body.steps).filter(([, s]) => !s.ok).map(([k, s]) => `${k}: ${s.error}`),
    });
    const detail = await grabberApi.call('GET /api/packets/:address', { params: { address: created.packet } });
    const mine = detail.grabs.find((g) => g.claimer === grabber.address);
    paid = mine?.status === 'paid' && !!mine.grabSignature && !!mine.callbackSignature && !!mine.payoutSignature;
    if (paid) record('grab_indexed', mine);
  }
  if (!paid) throw new Error('grab was not indexed as paid after 4 ticks');

  // 9. the sender's feed still shows the packet (one share left), the grabber's no longer does
  const senderFeed = await senderApi.call('GET /api/feed');
  const grabberFeed = await grabberApi.call('GET /api/feed');
  const inSender = senderFeed.packets.find((p) => p.address === created.packet);
  record('feed_sender', inSender ? { status: inSender.status, reserved: inSender.reserved, resolved: inSender.resolved } : null);
  record('feed_grabber_hides_grabbed', !grabberFeed.packets.some((p) => p.address === created.packet));
  if (!inSender) throw new Error('packet missing from the sender feed');
  record('widget_sender', await senderApi.call('GET /api/widget'));
  console.log('\ne2e OK');
}

main().catch((e) => {
  console.error('\ne2e FAILED:', e);
  console.error(JSON.stringify(log, null, 2));
  process.exit(1);
});
