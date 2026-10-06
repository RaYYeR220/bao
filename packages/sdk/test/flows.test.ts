import { generateKeyPairSigner, isSome, type Address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { sha256 } from '@noble/hashes/sha256';
import { describe, expect, it } from 'vitest';
import {
  BAO_PROGRAM_ADDRESS,
  GRAB_EQUAL_DISCRIMINATOR,
  GRAB_LUCKY_DISCRIMINATOR,
  SplitMode,
  getCreatePacketInstructionDataDecoder,
  getGrabEqualInstructionDataDecoder,
  getGrabLuckyInstructionDataDecoder,
} from '../src/generated';
import { buildCreatePacket, buildGrab, buildPayout, messageHash, TOKEN_PROGRAM } from '../src/flows';
import { codeHash, normalizeCode } from '../src/merkle';
import { findClaimPda, findPacketPda } from '../src/pda';

const hex = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b)).toString('hex');
const ata = async (owner: Address, mint: Address, tokenProgram: Address = TOKEN_PROGRAM) =>
  (await findAssociatedTokenPda({ owner, mint, tokenProgram }))[0];

async function setup() {
  const sender = await generateKeyPairSigner();
  const claimer = await generateKeyPairSigner();
  const mint = (await generateKeyPairSigner()).address;
  const treasury = (await generateKeyPairSigner()).address;
  return { sender, claimer, mint, treasury };
}

describe('buildCreatePacket', () => {
  it('derives the packet, hashes the message and points at the right token accounts', async () => {
    const { sender, mint, treasury } = await setup();
    const out = await buildCreatePacket({
      sender,
      mint,
      treasury,
      id: 42n,
      total: 88_000_000n,
      shares: 8,
      mode: 'lucky',
      audience: { kind: 'open' },
      seekerOnly: true,
      expiresIn: 86_400n,
      message: '恭喜發財',
    });
    expect(out.packet).toBe((await findPacketPda(sender.address, 42n))[0]);
    const ix = out.instructions[out.instructions.length - 1];
    expect(ix.programAddress).toBe(BAO_PROGRAM_ADDRESS);
    const data = getCreatePacketInstructionDataDecoder().decode(ix.data!);
    expect(data.id).toBe(42n);
    expect(data.total).toBe(88_000_000n);
    expect(data.shares).toBe(8);
    expect(data.mode).toBe(SplitMode.Lucky);
    expect(data.seekerOnly).toBe(true);
    expect(data.startsAt).toBe(0n);
    expect(hex(data.messageHash)).toBe(hex(sha256(new TextEncoder().encode('恭喜發財'))));
    const accounts = ix.accounts!.map((a) => a.address);
    expect(accounts).toContain(await ata(sender.address, mint));
    expect(accounts).toContain(await ata(treasury, mint));
  });

  it('binds a code word to the packet address', async () => {
    const { sender, mint, treasury } = await setup();
    const out = await buildCreatePacket({
      sender, mint, treasury, id: 7n, total: 1_000n, shares: 2, mode: 'equal',
      audience: { kind: 'code', code: ' Gongxi Facai ' }, seekerOnly: false, expiresIn: 3_600n,
    });
    const data = getCreatePacketInstructionDataDecoder().decode(out.instructions.at(-1)!.data!);
    expect(data.audience.__kind).toBe('Code');
    if (data.audience.__kind === 'Code') expect(hex(data.audience.codeHash)).toBe(hex(codeHash('gongxi facai', out.packet)));
  });

  it('uses an all-zero message hash when there is no message', async () => {
    const { sender, mint, treasury } = await setup();
    const out = await buildCreatePacket({
      sender, mint, treasury, id: 1n, total: 10n, shares: 1, mode: 'equal',
      audience: { kind: 'circle', root: new Uint8Array(32).fill(3) }, seekerOnly: false, expiresIn: 3_600n,
    });
    const data = getCreatePacketInstructionDataDecoder().decode(out.instructions.at(-1)!.data!);
    expect(hex(data.messageHash)).toBe('00'.repeat(32));
    expect(data.audience.__kind).toBe('Circle');
  });
});

describe('buildGrab', () => {
  it('lucky + seeker-only uses grab_lucky keyed by the genesis mint', async () => {
    const { claimer, mint } = await setup();
    const packet = (await generateKeyPairSigner()).address;
    const genesis = { mint: (await generateKeyPairSigner()).address, tokenAccount: (await generateKeyPairSigner()).address };
    const { instruction, claim } = await buildGrab({
      claimer, packet: { address: packet, mint, tokenProgram: TOKEN_PROGRAM, mode: 'lucky', seekerOnly: true }, genesis,
    });
    expect(hex(instruction.data!.slice(0, 8))).toBe(hex(GRAB_LUCKY_DISCRIMINATOR));
    const data = getGrabLuckyInstructionDataDecoder().decode(instruction.data!);
    expect(data.args.deviceKey).toBe(genesis.mint);
    expect(claim).toBe((await findClaimPda(packet, genesis.mint))[0]);
    const accounts = instruction.accounts!.map((a) => a.address);
    expect(accounts).toContain(genesis.tokenAccount);
    expect(accounts).toContain(await ata(claimer.address, mint));
  });

  it('equal circle grab sends the proof and keys the claim by wallet', async () => {
    const { claimer, mint } = await setup();
    const packet = (await generateKeyPairSigner()).address;
    const proof = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    const { instruction, claim } = await buildGrab({
      claimer, packet: { address: packet, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS, mode: 'equal', seekerOnly: false }, proof,
    });
    expect(hex(instruction.data!.slice(0, 8))).toBe(hex(GRAB_EQUAL_DISCRIMINATOR));
    const data = getGrabEqualInstructionDataDecoder().decode(instruction.data!);
    expect(data.args.deviceKey).toBe(claimer.address);
    expect(data.args.proof.map((p) => hex(p))).toEqual(proof.map((p) => hex(p)));
    expect(claim).toBe((await findClaimPda(packet, claimer.address))[0]);
    expect(instruction.accounts!.map((a) => a.address)).toContain(await ata(claimer.address, mint, TOKEN_2022_PROGRAM_ADDRESS));
  });

  it('normalizes the code word the same way the hash was built', async () => {
    const { claimer, mint } = await setup();
    const packet = (await generateKeyPairSigner()).address;
    const { instruction } = await buildGrab({
      claimer, packet: { address: packet, mint, tokenProgram: TOKEN_PROGRAM, mode: 'equal', seekerOnly: false }, code: '  GONGXI facai',
    });
    const data = getGrabEqualInstructionDataDecoder().decode(instruction.data!);
    expect(isSome(data.args.code) && hex(data.args.code.value)).toBe(hex(normalizeCode('gongxi facai')));
  });

  it('refuses a seeker-only grab without a genesis token', async () => {
    const { claimer, mint } = await setup();
    const packet = (await generateKeyPairSigner()).address;
    await expect(
      buildGrab({ claimer, packet: { address: packet, mint, tokenProgram: TOKEN_PROGRAM, mode: 'equal', seekerOnly: true } }),
    ).rejects.toThrow(/Genesis/);
  });
});

describe('buildPayout', () => {
  it('pays the claimer ATA from the packet vault', async () => {
    const { claimer, mint } = await setup();
    const payer = await generateKeyPairSigner();
    const packet = (await generateKeyPairSigner()).address;
    const claim = (await generateKeyPairSigner()).address;
    const ix = await buildPayout({ payer, packet, claim, claimer: claimer.address, mint, tokenProgram: TOKEN_PROGRAM });
    expect(ix.accounts!.map((a) => a.address)).toContain(await ata(claimer.address, mint));
  });
});

describe('messageHash', () => {
  it('is sha256 of utf-8, zeros when empty', () => {
    expect(hex(messageHash(''))).toBe('00'.repeat(32));
    expect(hex(messageHash('hi'))).toBe(hex(sha256(new TextEncoder().encode('hi'))));
  });
});
