import {
  address,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  none,
} from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BAO_PROGRAM_ADDRESS, GRAB_EQUAL_DISCRIMINATOR, SplitMode, getPacketEncoder, type Packet } from '@bao/sdk';
import { GET as actionsJson } from '@/app/actions.json/route';
import { GET, OPTIONS, POST } from '@/app/api/actions/grab/[packet]/route';
import { setStore, type Store } from '@/lib/db';
import { resetRateLimits } from '@/lib/http';
import { setRpcs } from '@/lib/rpc';
import { base64Account, fakeRpc, packetBytes } from './fake-rpc';
import { A, freshStore } from './helpers';

const NOW = Math.floor(Date.now() / 1000);
const accounts = new Map<string, string>();

function put(addr: string, over: Partial<Packet>) {
  const data = getPacketEncoder().encode({
    sender: address(A.alice),
    id: 1n,
    mint: address('aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr'),
    tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    totalAmount: 25_000_000n,
    remainingAmount: 25_000_000n,
    totalShares: 5,
    reserved: 1,
    resolved: 1,
    openClaims: 1,
    mode: SplitMode.Equal,
    audience: { __kind: 'Open' },
    seekerOnly: false,
    sgtGroup: address(A.dave),
    crankReward: 0n,
    createdAt: BigInt(NOW - 60),
    startsAt: BigInt(NOW - 60),
    expiresAt: BigInt(NOW + 3_600),
    messageHash: new Uint8Array(32),
    parent: none(),
    chainRoot: address(addr),
    chainDepth: 0,
    luckKing: none(),
    luckKingAmount: 0n,
    crowned: false,
    bump: 255,
    vaultBump: 255,
    gasBump: 255,
    ...over,
  } as never);
  accounts.set(addr, packetBytes(data));
}

let store: Store;
beforeAll(async () => {
  store = await freshStore();
  setStore(store);
  resetRateLimits();
  setRpcs({
    devnet: fakeRpc({
      getAccountInfo: (a) => ({ value: accounts.has(a as string) ? base64Account(accounts.get(a as string)!) : null }),
      getTokenAccountsByOwner: () => ({ value: [] }),
      getLatestBlockhash: () => ({ value: { blockhash: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn', lastValidBlockHeight: 100n } }),
    }),
  });
  put(A.p1, {});
  put(A.p2, { seekerOnly: true });
  put(A.p3, { audience: { __kind: 'Code', codeHash: new Uint8Array(32) } });
  put(A.p4, { expiresAt: BigInt(NOW - 1) });
});
afterAll(async () => {
  setStore(null);
  setRpcs({ devnet: null });
  await store.sql.close();
});

const ctx = (packet: string) => ({ params: Promise.resolve({ packet }) });
const post = (packet: string, account: string, qs = '') =>
  POST(
    new Request(`http://localhost:3000/api/actions/grab/${packet}${qs}`, {
      method: 'POST',
      body: JSON.stringify({ account }),
      headers: { 'content-type': 'application/json' },
    }),
    ctx(packet),
  );

describe('solana actions', () => {
  it('publishes actions.json rules with CORS', async () => {
    const res = await actionsJson();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect((await res.json()).rules[0]).toEqual({ pathPattern: '/p/*', apiPath: '/api/actions/grab/*' });
    expect((await OPTIONS()).headers.get('x-blockchain-ids')).toContain('solana:');
  });

  it('describes a packet', async () => {
    const res = await GET(new Request(`http://localhost:3000/api/actions/grab/${A.p1}`), ctx(A.p1));
    expect(res.headers.get('x-action-version')).toBe('2.4');
    expect(await res.json()).toMatchObject({
      type: 'action',
      title: 'Red packet: 25 tSKR',
      description: '4 of 5 shares left · equal split',
      label: 'Grab',
      links: { actions: [{ type: 'transaction', href: `http://localhost:3000/api/actions/grab/${A.p1}` }] },
    });
    const code = await (await GET(new Request('http://x'), ctx(A.p3))).json();
    expect(code.links.actions[0].parameters[0].name).toBe('code');
    const expired = await (await GET(new Request('http://x'), ctx(A.p4))).json();
    expect(expired).toMatchObject({ disabled: true, error: { message: 'This packet is expired' } });
  });

  it('returns an unsigned grab transaction paid by the grabber', async () => {
    const res = await post(A.p1, A.bob);
    expect(res.status).toBe(200);
    const body = await res.json();
    const tx = getTransactionDecoder().decode(Buffer.from(body.transaction, 'base64'));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
      staticAccounts: string[];
      instructions: { programAddressIndex: number; data?: Uint8Array }[];
    };
    expect(message.staticAccounts[0]).toBe(A.bob);
    expect(Object.values(tx.signatures)).toEqual([null]);
    const ix = message.instructions[0];
    expect(message.staticAccounts[ix.programAddressIndex]).toBe(BAO_PROGRAM_ADDRESS);
    expect([...ix.data!.subarray(0, 8)]).toEqual([...GRAB_EQUAL_DISCRIMINATOR]);
  });

  it('refuses what the program would refuse', async () => {
    expect((await post(A.p2, A.bob)).status).toBe(403);
    expect((await post(A.p3, A.bob)).status).toBe(400);
    expect((await post(A.p4, A.bob)).status).toBe(400);
    expect((await post(A.p1, 'nope')).status).toBe(400);
    const missing = await post(A.alice, A.bob);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('access-control-allow-origin')).toBe('*');
  });
});
