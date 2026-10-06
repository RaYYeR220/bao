/**
 * Instruction builders for the app's three money moments: dropping a packet, grabbing a
 * share, and paying a won share out. Shared by the mobile app and the API (Solana Actions).
 */
import { address, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token-2022';
import { sha256 } from '@noble/hashes/sha256';
import {
  SplitMode,
  getCreatePacketInstructionAsync,
  getGrabEqualInstructionAsync,
  getGrabLuckyInstructionAsync,
  getPayoutInstructionAsync,
  findCrownPda,
} from './generated';
import { codeHash, normalizeCode } from './merkle';
import { findClaimPda, findPacketPda } from './pda';

export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export type AudienceInput =
  | { kind: 'open' }
  | { kind: 'circle'; root: Uint8Array }
  | { kind: 'code'; code: string };

/** sha256(utf-8) of the packet message; all zeros when there is none. */
export function messageHash(message?: string | null): Uint8Array {
  if (!message) return new Uint8Array(32);
  return sha256(new TextEncoder().encode(message));
}

async function ataOf(owner: Address, mint: Address, tokenProgram: Address) {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return ata;
}

export interface CreatePacketParams {
  sender: TransactionSigner;
  mint: Address;
  tokenProgram?: Address;
  /** `config.treasury`; its token account receives the fee on open packets. */
  treasury: Address;
  total: bigint;
  shares: number;
  mode: 'lucky' | 'equal';
  audience: AudienceInput;
  seekerOnly: boolean;
  expiresIn: bigint;
  /** Unix seconds a scheduled rain opens; 0 or omitted opens immediately. */
  startsAt?: bigint;
  message?: string | null;
  /** Defaults to the current time in milliseconds, unique per sender in practice. */
  id?: bigint;
  maxFeeBps?: number;
  /** Continue a Luck-King chain: the parent packet whose crown the sender holds. */
  parentPacket?: Address;
  parentCrownRefund?: Address;
}

export async function buildCreatePacket(p: CreatePacketParams) {
  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM;
  const id = p.id ?? BigInt(Date.now());
  const [packet] = await findPacketPda(p.sender.address, id);
  const audience =
    p.audience.kind === 'open'
      ? ({ __kind: 'Open' } as const)
      : p.audience.kind === 'circle'
        ? ({ __kind: 'Circle', merkleRoot: p.audience.root } as const)
        : ({ __kind: 'Code', codeHash: codeHash(p.audience.code, packet) } as const);
  const parentCrown = p.parentPacket ? (await findCrownPda({ packet: p.parentPacket }))[0] : undefined;
  const instruction = await getCreatePacketInstructionAsync({
    sender: p.sender,
    packet,
    mint: p.mint,
    senderToken: await ataOf(p.sender.address, p.mint, tokenProgram),
    treasuryToken: await ataOf(p.treasury, p.mint, tokenProgram),
    parentCrown,
    parentCrownRefund: parentCrown ? p.parentCrownRefund : undefined,
    tokenProgram,
    id,
    total: p.total,
    shares: p.shares,
    mode: p.mode === 'lucky' ? SplitMode.Lucky : SplitMode.Equal,
    audience,
    seekerOnly: p.seekerOnly,
    expiresIn: p.expiresIn,
    messageHash: messageHash(p.message),
    maxFeeBps: p.maxFeeBps ?? 100,
    startsAt: p.startsAt ?? 0n,
  });
  return { packet, id, instructions: [instruction] as Instruction[] };
}

export interface GrabPacketInfo {
  address: Address;
  mint: Address;
  tokenProgram: Address;
  mode: 'lucky' | 'equal';
  seekerOnly: boolean;
}

export interface GrabParams {
  claimer: TransactionSigner;
  packet: GrabPacketInfo;
  /** The claimer's Seeker Genesis Token (required for Seeker-only packets). */
  genesis?: { mint: Address; tokenAccount: Address } | null;
  proof?: Uint8Array[];
  code?: string;
}

export async function buildGrab(p: GrabParams) {
  if (p.packet.seekerOnly && !p.genesis) {
    throw new Error('This packet is Seeker-only and the wallet holds no Seeker Genesis Token');
  }
  const deviceKey = p.packet.seekerOnly ? p.genesis!.mint : p.claimer.address;
  const [claim] = await findClaimPda(p.packet.address, deviceKey);
  const common = {
    claimer: p.claimer,
    packet: p.packet.address,
    mint: p.packet.mint,
    claim,
    claimerToken: await ataOf(p.claimer.address, p.packet.mint, p.packet.tokenProgram),
    sgtMint: p.packet.seekerOnly ? p.genesis!.mint : undefined,
    sgtToken: p.packet.seekerOnly ? p.genesis!.tokenAccount : undefined,
    tokenProgram: p.packet.tokenProgram,
    args: {
      deviceKey,
      proof: p.proof ?? [],
      code: p.code !== undefined ? normalizeCode(p.code) : null,
    },
  };
  const instruction =
    p.packet.mode === 'lucky' ? await getGrabLuckyInstructionAsync(common) : await getGrabEqualInstructionAsync(common);
  return { instruction: instruction as Instruction, claim, deviceKey };
}

export interface PayoutParams {
  payer: TransactionSigner;
  packet: Address;
  claim: Address;
  claimer: Address;
  mint: Address;
  tokenProgram: Address;
}

export async function buildPayout(p: PayoutParams): Promise<Instruction> {
  return getPayoutInstructionAsync({
    payer: p.payer,
    packet: p.packet,
    claim: p.claim,
    mint: p.mint,
    claimer: p.claimer,
    claimerToken: await ataOf(p.claimer, p.mint, p.tokenProgram),
    tokenProgram: p.tokenProgram,
  });
}
