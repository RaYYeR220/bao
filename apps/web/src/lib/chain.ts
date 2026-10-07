/**
 * Reading the Bao program: Anchor events out of transaction logs, and packet accounts
 * mirrored into database rows.
 */
import {
  fetchEncodedAccount,
  getAddressDecoder,
  getBooleanDecoder,
  getBytesDecoder,
  getI64Decoder,
  getOptionDecoder,
  getStructDecoder,
  getU16Decoder,
  getU64Decoder,
  fixDecoderSize,
  isSome,
  type Address,
  type Decoder,
  type Option,
} from '@solana/kit';
import { sha256 } from '@noble/hashes/sha256';
import {
  BAO_PROGRAM_ADDRESS,
  SplitMode,
  getAudienceDecoder,
  getPacketDecoder,
  getSplitModeDecoder,
  type Audience,
  type Packet,
  type PacketStatus,
} from '@bao/sdk';
import type { SolanaRpc } from './rpc';
import type { PacketMirror, PacketRecord } from './types';

/** Allocated size of a Packet account in the deployed layout (older devnet layouts differ). */
export const PACKET_SIZE = 379;
export const CLAIM_SIZE = 124;
export const CROWN_SIZE = 155;

/** The packet account in the current layout, or null when missing or from an older program version. */
export async function fetchPacketAccount(rpc: SolanaRpc, address: Address): Promise<Packet | null> {
  const account = await fetchEncodedAccount(rpc, address, { commitment: 'confirmed' });
  if (!account.exists || account.data.length !== PACKET_SIZE) return null;
  return getPacketDecoder().decode(account.data);
}

const addr = getAddressDecoder();
const u16 = getU16Decoder();
const u64 = getU64Decoder();
const i64 = getI64Decoder();
const bool = getBooleanDecoder();
const bytes32 = fixDecoderSize(getBytesDecoder(), 32);

export type BaoEvent =
  | {
      name: 'PacketCreated';
      data: {
        packet: Address;
        sender: Address;
        mint: Address;
        total: bigint;
        shares: number;
        mode: SplitMode;
        audience: Audience;
        seekerOnly: boolean;
        expiresAt: bigint;
        chainRoot: Address;
        chainDepth: number;
      };
    }
  | { name: 'GrabReserved'; data: { packet: Address; claimer: Address; deviceKey: Address; index: number } }
  | {
      name: 'Grabbed';
      data: {
        packet: Address;
        claimer: Address;
        deviceKey: Address;
        index: number;
        amount: bigint;
        remaining: bigint;
        randomness: Uint8Array;
      };
    }
  | { name: 'PaidOut'; data: { packet: Address; claimer: Address; amount: bigint } }
  | { name: 'ClaimForfeited'; data: { packet: Address; claimer: Address; amount: bigint } }
  | {
      name: 'LuckKingCrowned';
      data: { packet: Address; king: Address; amount: bigint; chainRoot: Address; chainDepth: number };
    }
  | { name: 'StaleCancelled'; data: { packet: Address; deviceKey: Address; index: number } }
  | { name: 'PacketClosed'; data: { packet: Address; refunded: bigint; luckKing: Option<Address> } };

type EventName = BaoEvent['name'];

const DECODERS: { [K in EventName]: Decoder<Extract<BaoEvent, { name: K }>['data']> } = {
  PacketCreated: getStructDecoder([
    ['packet', addr],
    ['sender', addr],
    ['mint', addr],
    ['total', u64],
    ['shares', u16],
    ['mode', getSplitModeDecoder()],
    ['audience', getAudienceDecoder()],
    ['seekerOnly', bool],
    ['expiresAt', i64],
    ['chainRoot', addr],
    ['chainDepth', u16],
  ]),
  GrabReserved: getStructDecoder([
    ['packet', addr],
    ['claimer', addr],
    ['deviceKey', addr],
    ['index', u16],
  ]),
  Grabbed: getStructDecoder([
    ['packet', addr],
    ['claimer', addr],
    ['deviceKey', addr],
    ['index', u16],
    ['amount', u64],
    ['remaining', u64],
    ['randomness', bytes32],
  ]) as unknown as Decoder<Extract<BaoEvent, { name: 'Grabbed' }>['data']>,
  PaidOut: getStructDecoder([
    ['packet', addr],
    ['claimer', addr],
    ['amount', u64],
  ]),
  ClaimForfeited: getStructDecoder([
    ['packet', addr],
    ['claimer', addr],
    ['amount', u64],
  ]),
  LuckKingCrowned: getStructDecoder([
    ['packet', addr],
    ['king', addr],
    ['amount', u64],
    ['chainRoot', addr],
    ['chainDepth', u16],
  ]),
  StaleCancelled: getStructDecoder([
    ['packet', addr],
    ['deviceKey', addr],
    ['index', u16],
  ]),
  PacketClosed: getStructDecoder([
    ['packet', addr],
    ['refunded', u64],
    ['luckKing', getOptionDecoder(addr)],
  ]),
};

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Anchor event discriminator: sha256("event:<Name>")[..8]. */
export const eventDiscriminator = (name: string) => sha256(new TextEncoder().encode(`event:${name}`)).subarray(0, 8);

const BY_DISCRIMINATOR = new Map<string, EventName>(
  (Object.keys(DECODERS) as EventName[]).map((name) => [hex(eventDiscriminator(name)), name]),
);

export function decodeEvent(data: Uint8Array): BaoEvent | null {
  if (data.length < 8) return null;
  const name = BY_DISCRIMINATOR.get(hex(data.subarray(0, 8)));
  if (!name) return null;
  return { name, data: DECODERS[name].decode(data.subarray(8)) } as BaoEvent;
}

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT = /^Program (\w+) (success|failed)/;
const DATA = /^Program data: (.+)$/;

/**
 * Events emitted by `programId` in a transaction's logs. "Program data" lines are attributed
 * to the program on top of the invoke stack, so another program cannot forge Bao events.
 */
export function eventsFromLogs(logs: readonly string[], programId: string = BAO_PROGRAM_ADDRESS) {
  const stack: string[] = [];
  const events: BaoEvent[] = [];
  let truncated = false;
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    if (line === 'Log truncated') {
      truncated = true;
      continue;
    }
    const data = DATA.exec(line);
    if (data && stack[stack.length - 1] === programId) {
      try {
        const event = decodeEvent(new Uint8Array(Buffer.from(data[1], 'base64')));
        if (event) events.push(event);
      } catch {
        // an event from an older program layout; the account refetch covers it
      }
    }
  }
  return { events, truncated };
}

export const randomnessHex = (r: Uint8Array): string | null => (r.every((b) => b === 0) ? null : hex(r));

export const modeName = (m: SplitMode) => (m === SplitMode.Lucky ? 'lucky' : 'equal') as 'lucky' | 'equal';

export function audienceParts(a: Audience): { audience: 'open' | 'circle' | 'code'; merkleRoot: string | null } {
  if (a.__kind === 'Circle') return { audience: 'circle', merkleRoot: hex(new Uint8Array(a.merkleRoot)) };
  if (a.__kind === 'Code') return { audience: 'code', merkleRoot: null };
  return { audience: 'open', merkleRoot: null };
}

export function mirrorFromAccount(address: string, p: Packet, decimals?: number | null): PacketMirror {
  const { audience, merkleRoot } = audienceParts(p.audience);
  return {
    address,
    sender: p.sender,
    packetId: p.id.toString(),
    mint: p.mint,
    tokenProgram: p.tokenProgram,
    decimals: decimals ?? null,
    totalAmount: p.totalAmount.toString(),
    remainingAmount: p.remainingAmount.toString(),
    totalShares: p.totalShares,
    reserved: p.reserved,
    resolved: p.resolved,
    mode: modeName(p.mode),
    audience,
    merkleRoot,
    seekerOnly: p.seekerOnly,
    createdAt: Number(p.createdAt),
    startsAt: Number(p.startsAt),
    expiresAt: Number(p.expiresAt),
    messageHash: hex(new Uint8Array(p.messageHash)),
    parent: isSome(p.parent) ? p.parent.value : null,
    chainRoot: p.chainRoot,
    chainDepth: p.chainDepth,
    luckKing: isSome(p.luckKing) ? p.luckKing.value : null,
    luckKingAmount: isSome(p.luckKing) ? p.luckKingAmount.toString() : null,
    crowned: p.crowned,
  };
}

/** A packet seen only through its PacketCreated event (the account may already be closed). */
export function mirrorFromEvent(
  e: Extract<BaoEvent, { name: 'PacketCreated' }>['data'],
  blockTime: number,
  signature: string,
): PacketMirror {
  const { audience, merkleRoot } = audienceParts(e.audience);
  return {
    address: e.packet,
    sender: e.sender,
    mint: e.mint,
    totalAmount: e.total.toString(),
    remainingAmount: e.total.toString(),
    totalShares: e.shares,
    mode: modeName(e.mode),
    audience,
    merkleRoot,
    seekerOnly: e.seekerOnly,
    createdAt: blockTime,
    startsAt: blockTime,
    expiresAt: Number(e.expiresAt),
    chainRoot: e.chainRoot,
    chainDepth: e.chainDepth,
    createSignature: signature,
  };
}

type StatusInput = Pick<PacketRecord, 'startsAt' | 'expiresAt' | 'reserved' | 'totalShares'> & { status?: PacketStatus };

/** The status a viewer sees at `now`; `closed` is sticky once the account is gone. */
export function packetStatus(p: StatusInput, now: number): PacketStatus {
  if (p.status === 'closed') return 'closed';
  if (p.reserved >= p.totalShares) return 'emptied';
  if (now >= p.expiresAt) return 'expired';
  if (now < p.startsAt) return 'scheduled';
  return 'live';
}
