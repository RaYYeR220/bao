import { address, getCompiledTransactionMessageDecoder, getTransactionDecoder, type Address } from '@solana/kit';
import { AccountState, TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getTokenEncoder } from '@solana-program/token';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BAO_PROGRAM_ADDRESS,
  CREATE_PACKET_DISCRIMINATOR,
  SplitMode,
  findConfigPda,
  findPacketPda,
  getConfigEncoder,
  getCreatePacketInstructionDataDecoder,
} from '@bao/sdk';
import { GET as actionsJson } from '@/app/actions.json/route';
import { GET, OPTIONS, POST } from '@/app/api/actions/create/route';
import { CREATE_EXPIRES_IN, MAX_EXPIRY_SECS, MAX_SHARES, MIN_EXPIRY_SECS, parseCreateInput } from '@/lib/actions';
import { setStore, type Store } from '@/lib/db';
import { resetRateLimits } from '@/lib/http';
import { setRpcs } from '@/lib/rpc';
import { parseUi } from '@/lib/tokens';
import { base64Account, fakeRpc } from './fake-rpc';
import { A, freshStore } from './helpers';

const TSKR = address(A.mint);
const TREASURY = address(A.dave);
/** Not the SDK default of 100, so the test shows the fee ceiling is read from the config. */
const FEE_BPS = 150;
const URL = 'http://localhost:3000/api/actions/create';

let store: Store;
let configPda: Address;
const chain = { paused: false, config: true, balances: new Map<string, bigint>() };
const ataOf = async (owner: string) =>
  (await findAssociatedTokenPda({ owner: address(owner), mint: TSKR, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

beforeAll(async () => {
  store = await freshStore();
  setStore(store);
  [configPda] = await findConfigPda();
  const owners = new Map<string, string>();
  for (const owner of [A.alice, A.bob, A.carol]) owners.set(await ataOf(owner), owner);
  setRpcs({
    devnet: fakeRpc({
      getAccountInfo: (a) => {
        if (a === configPda) {
          if (!chain.config) return { value: null };
          const config = getConfigEncoder().encode({
            admin: TREASURY,
            sgtGroup: address(A.bob),
            treasury: TREASURY,
            feeBps: FEE_BPS,
            crankRewardLamports: 10_000n,
            paused: chain.paused,
            bump: 255,
          });
          return { value: base64Account(Buffer.from(config).toString('base64')) };
        }
        const owner = owners.get(a as string);
        const amount = owner ? chain.balances.get(owner) : undefined;
        if (!owner || amount === undefined) return { value: null };
        const token = getTokenEncoder().encode({
          mint: TSKR,
          owner: address(owner),
          amount,
          delegate: null,
          state: AccountState.Initialized,
          isNative: null,
          delegatedAmount: 0n,
          closeAuthority: null,
        });
        return { value: base64Account(Buffer.from(token).toString('base64')) };
      },
      getLatestBlockhash: () => ({ value: { blockhash: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn', lastValidBlockHeight: 100n } }),
    }),
  });
});
afterAll(async () => {
  setStore(null);
  setRpcs({ devnet: null });
  await store.sql.close();
});
beforeEach(() => {
  resetRateLimits();
  chain.paused = false;
  chain.config = true;
  chain.balances = new Map([
    [A.alice, 1_000_000_000n],
    [A.bob, 50_000_000n],
  ]);
});

const post = (account: unknown, qs: string, data?: Record<string, unknown>) =>
  POST(
    new Request(`${URL}${qs}`, {
      method: 'POST',
      body: JSON.stringify(data ? { account, data } : { account }),
      headers: { 'content-type': 'application/json' },
    }),
  );
const refusal = async (res: Response) => ({ status: res.status, message: (await res.json()).message as string });

/** The one instruction of the returned transaction, with its accounts resolved. */
function decode(base64: string) {
  const tx = getTransactionDecoder().decode(Buffer.from(base64, 'base64'));
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
    staticAccounts: string[];
    instructions: { programAddressIndex: number; accountIndices: number[]; data: Uint8Array }[];
  };
  const [ix] = message.instructions;
  return {
    feePayer: message.staticAccounts[0],
    signatures: Object.values(tx.signatures),
    instructions: message.instructions.length,
    program: message.staticAccounts[ix.programAddressIndex],
    accounts: ix.accountIndices.map((i) => message.staticAccounts[i]),
    discriminator: [...ix.data.subarray(0, 8)],
    args: getCreatePacketInstructionDataDecoder().decode(ix.data),
  };
}

describe('create action: metadata', () => {
  it('describes the form, with the bounds of the program', async () => {
    const res = await GET(new Request(URL));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-action-version')).toBe('2.4');
    expect(res.headers.get('x-blockchain-ids')).toContain('solana:');
    const body = await res.json();
    expect(body).toMatchObject({
      type: 'action',
      icon: 'http://localhost:3000/icon.png',
      title: 'Drop a red packet',
      label: 'Drop',
      links: {
        actions: [
          {
            type: 'transaction',
            label: 'Drop the packet',
            href: `${URL}?amount={amount}&shares={shares}&mode={mode}`,
            parameters: [
              { name: 'amount', type: 'number', required: true, min: 0.000001 },
              { name: 'shares', type: 'number', required: true, min: 1, max: 200 },
              {
                name: 'mode',
                type: 'radio',
                required: true,
                options: [
                  { value: 'lucky', selected: true },
                  { value: 'equal' },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(body.description).toContain('Seeker Genesis Token');
    expect(body.description).toContain('24 hours');
    expect(body.description).toContain('1.5% fee');
    expect(body.disabled).toBeUndefined();
    // every placeholder in the href is a declared parameter
    const names = body.links.actions[0].parameters.map((p: { name: string }) => p.name);
    expect([...body.links.actions[0].href.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(names);
  });

  it('is covered by actions.json and answers preflight like the grab action', async () => {
    const { rules } = await (await actionsJson()).json();
    expect(rules).toContainEqual({ pathPattern: '/api/actions/**', apiPath: '/api/actions/**' });
    const preflight = await OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });

  it('shows as disabled while new packets are paused, and still renders when the config cannot be read', async () => {
    chain.paused = true;
    const paused = await (await GET(new Request(URL))).json();
    expect(paused).toMatchObject({ disabled: true, error: { message: 'New packets are paused right now' } });
    chain.config = false;
    const unread = await GET(new Request(URL));
    expect(unread.status).toBe(200);
    const body = await unread.json();
    expect(body.links.actions[0].parameters).toHaveLength(3);
    expect(body.description).not.toContain('fee');
  });
});

describe('create action: validation', () => {
  it('keeps the expiry inside the program bounds', () => {
    expect(CREATE_EXPIRES_IN).toBe(86_400n);
    expect(CREATE_EXPIRES_IN >= MIN_EXPIRY_SECS && CREATE_EXPIRES_IN <= MAX_EXPIRY_SECS).toBe(true);
    expect(MAX_SHARES).toBe(200);
  });

  it('parses amounts without floating point', () => {
    expect(parseUi('88', 6)).toBe(88_000_000n);
    expect(parseUi('0.1', 6)).toBe(100_000n);
    expect(parseUi(' 12,5 ', 6)).toBe(12_500_000n);
    expect(parseUi('.000001', 6)).toBe(1n);
    for (const bad of ['', '.', 'abc', '-1', '1e3', '1.0000001', '1 000', '0x10']) expect(parseUi(bad, 6)).toBeNull();
    expect(parseCreateInput({ amount: '88', shares: '8', mode: undefined }, 6)).toEqual({ total: 88_000_000n, shares: 8, mode: 'lucky' });
    expect(parseCreateInput({ amount: '0.000200', shares: '200', mode: 'EQUAL' }, 6)).toEqual({ total: 200n, shares: 200, mode: 'equal' });
  });

  it('refuses inputs the program would refuse, naming the field', async () => {
    const cases: [string, RegExp][] = [
      ['?shares=8&mode=lucky', /^amount: a number of tSKR/],
      ['?amount=abc&shares=8&mode=lucky', /^amount: a number of tSKR/],
      ['?amount=-5&shares=8&mode=lucky', /^amount: a number of tSKR/],
      ['?amount=1.0000001&shares=8&mode=lucky', /at most 6 decimals/],
      ['?amount=0&shares=8&mode=lucky', /^amount: must be more than 0/],
      ['?amount=18446744073710&shares=8&mode=lucky', /^amount: too large/],
      ['?amount=88&mode=lucky', /^shares: a whole number from 1 to 200/],
      ['?amount=88&shares=0&mode=lucky', /^shares: a whole number from 1 to 200/],
      ['?amount=88&shares=201&mode=lucky', /^shares: a whole number from 1 to 200/],
      ['?amount=88&shares=2.5&mode=lucky', /^shares: a whole number from 1 to 200/],
      ['?amount=88&shares=eight&mode=lucky', /^shares: a whole number from 1 to 200/],
      ['?amount=0.000007&shares=8&mode=lucky', /^amount: at least 0\.000001 tSKR for each of the 8 shares/],
      ['?amount=88&shares=8&mode=random', /^mode: lucky or equal/],
    ];
    for (const [qs, message] of cases) {
      const res = await post(A.alice, qs);
      expect(res.headers.get('access-control-allow-origin'), qs).toBe('*');
      const r = await refusal(res);
      expect(r.status, qs).toBe(400);
      expect(r.message, qs).toMatch(message);
    }
    // the largest amount a packet can hold is still an amount (and more than this wallet has)
    expect((await refusal(await post(A.alice, '?amount=18446744073709.551615&shares=200&mode=equal'))).message).toMatch(/^This wallet holds/);
  });

  it('refuses a missing or malformed account', async () => {
    expect(await refusal(await post('nope', '?amount=88&shares=8&mode=lucky'))).toEqual({ status: 400, message: 'account must be a wallet address' });
    expect((await post(undefined, '?amount=88&shares=8&mode=lucky')).status).toBe(400);
    const notJson = await POST(new Request(`${URL}?amount=88&shares=8`, { method: 'POST', body: '{' }));
    expect(notJson.status).toBe(400);
  });

  it('refuses a wallet that cannot fund the packet and its fee, before anything is signed', async () => {
    // 50 tSKR covers the packet but not the 1.5% fee on top
    expect(await refusal(await post(A.bob, '?amount=50&shares=5&mode=lucky'))).toEqual({
      status: 400,
      message:
        'This wallet holds 50 tSKR; the packet needs 50.75 tSKR (50 tSKR plus the 1.5% fee). On devnet, the Playground in the Bao app gives test tSKR.',
    });
    // no tSKR account at all
    expect((await refusal(await post(A.carol, '?amount=1&shares=1&mode=equal'))).message).toMatch(/^This wallet holds 0 tSKR; the packet needs 1\.015 tSKR/);
    expect((await post(A.bob, '?amount=49&shares=5&mode=lucky')).status).toBe(200);
  });

  it('refuses while paused or when the program has no config', async () => {
    chain.paused = true;
    expect(await refusal(await post(A.alice, '?amount=88&shares=8&mode=lucky'))).toEqual({ status: 409, message: 'New packets are paused right now' });
    chain.config = false;
    expect((await post(A.alice, '?amount=88&shares=8&mode=lucky')).status).toBe(503);
  });
});

describe('create action: the transaction', () => {
  it('is an unsigned create_packet for a public, Seeker-only, 24 h packet paid by the sender', async () => {
    const res = await post(A.alice, '?amount=88&shares=8&mode=lucky');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.type).toBe('transaction');

    const tx = decode(body.transaction);
    expect(tx.feePayer).toBe(A.alice);
    expect(tx.signatures).toEqual([null]);
    expect(tx.instructions).toBe(1);
    expect(tx.program).toBe(BAO_PROGRAM_ADDRESS);
    expect(tx.discriminator).toEqual([...CREATE_PACKET_DISCRIMINATOR]);
    expect(tx.args).toMatchObject({
      total: 88_000_000n,
      shares: 8,
      mode: SplitMode.Lucky,
      audience: { __kind: 'Open' },
      seekerOnly: true,
      expiresIn: 86_400n,
      maxFeeBps: FEE_BPS,
      startsAt: 0n,
    });
    expect([...tx.args.messageHash]).toEqual(new Array(32).fill(0));

    // sender, config, packet, mint, sender token, vault, gas tank, treasury token, no parent crown, programs
    const [packet] = await findPacketPda(address(A.alice), tx.args.id);
    expect(tx.accounts).toHaveLength(12);
    expect(tx.accounts.slice(0, 5)).toEqual([A.alice, configPda, packet, TSKR, await ataOf(A.alice)]);
    expect(tx.accounts[7]).toBe(await ataOf(TREASURY));
    expect(tx.accounts.slice(8)).toEqual([BAO_PROGRAM_ADDRESS, BAO_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, '11111111111111111111111111111111']);
    expect(body.message).toBe(`Packet sealed: 88 tSKR in 8 shares. Share it: http://localhost:3000/p/${packet}`);
  });

  it('takes Equal mode and the form values posted under data', async () => {
    const res = await post(A.alice, '', { amount: '12.5', shares: 1, mode: 'equal' });
    expect(res.status).toBe(200);
    const body = await res.json();
    const tx = decode(body.transaction);
    expect(tx.feePayer).toBe(A.alice);
    expect(tx.args).toMatchObject({ total: 12_500_000n, shares: 1, mode: SplitMode.Equal, audience: { __kind: 'Open' }, seekerOnly: true });
    expect(body.message).toContain('12.5 tSKR in 1 share.');
  });
});
