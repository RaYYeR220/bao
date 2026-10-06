import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { BAO_PROGRAM_ADDRESS } from './generated';

// Config, vault, gas tank and crown PDAs come from the generated client;
// these are the ones whose seeds include instruction arguments.
const addressBytes = getAddressEncoder();
const u64 = getU64Encoder();
const text = new TextEncoder();

const derive = (seeds: (string | ReadonlyUint8Array)[]) =>
  getProgramDerivedAddress({
    programAddress: BAO_PROGRAM_ADDRESS,
    seeds: seeds.map((s) => (typeof s === 'string' ? text.encode(s) : s)),
  });

export const findPacketPda = (sender: Address, id: bigint) => derive(['packet', addressBytes.encode(sender), u64.encode(id)]);
export const findClaimPda = (packet: Address, deviceKey: Address) =>
  derive(['claim', addressBytes.encode(packet), addressBytes.encode(deviceKey)]);
