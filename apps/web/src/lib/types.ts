import type { AudienceName, GrabStatus, PacketStatus, SplitModeName } from '@bao/sdk';

/** A packet row: the on-chain mirror plus app metadata. Amounts are base-unit strings. */
export interface PacketRecord {
  address: string;
  sender: string;
  packetId: string | null;
  mint: string;
  tokenProgram: string | null;
  decimals: number | null;
  totalAmount: string;
  remainingAmount: string;
  totalShares: number;
  reserved: number;
  resolved: number;
  mode: SplitModeName;
  audience: AudienceName;
  merkleRoot: string | null;
  seekerOnly: boolean;
  createdAt: number;
  startsAt: number;
  expiresAt: number;
  messageHash: string | null;
  parent: string | null;
  chainRoot: string;
  chainDepth: number;
  luckKing: string | null;
  luckKingAmount: string | null;
  crowned: boolean;
  status: PacketStatus;
  message: string | null;
  skin: string | null;
  circleId: string | null;
  snapshotRoot: string | null;
  codeHint: string | null;
  registered: boolean;
  createSignature: string | null;
  closeSignature: string | null;
  refunded: string | null;
  droppedPushed: boolean;
  rainPushed: boolean;
  emptiedPushed: boolean;
}

/** What the chain says about a packet (account fields, or event fields when the account is gone). */
export interface PacketMirror {
  address: string;
  sender: string;
  packetId?: string | null;
  mint: string;
  tokenProgram?: string | null;
  decimals?: number | null;
  totalAmount: string;
  remainingAmount: string;
  totalShares: number;
  reserved?: number;
  resolved?: number;
  mode: SplitModeName;
  audience: AudienceName;
  merkleRoot?: string | null;
  seekerOnly: boolean;
  createdAt: number;
  startsAt: number;
  expiresAt: number;
  messageHash?: string | null;
  parent?: string | null;
  chainRoot: string;
  chainDepth: number;
  luckKing?: string | null;
  luckKingAmount?: string | null;
  crowned?: boolean;
  createSignature?: string | null;
}

export interface GrabRecord {
  packet: string;
  deviceKey: string;
  claimer: string;
  index: number;
  amount: string | null;
  status: GrabStatus;
  grabSignature: string | null;
  callbackSignature: string | null;
  payoutSignature: string | null;
  randomness: string | null;
  slot: number;
  at: number;
}

/** A change to one claim, as learned from an event. Missing fields keep their stored value. */
export interface GrabPatch {
  packet: string;
  deviceKey: string;
  claimer: string;
  index: number;
  status: GrabStatus;
  amount?: string | null;
  grabSignature?: string | null;
  callbackSignature?: string | null;
  payoutSignature?: string | null;
  randomness?: string | null;
  /** Reservation slot; only grab events set it. */
  slot?: number;
  at: number;
}

export interface CircleRecord {
  id: string;
  name: string;
  emoji: string | null;
  inviteCode: string;
  owner: string;
  createdAt: number;
}

export interface IdentityRecord {
  address: string;
  skrName: string | null;
  skrCheckedAt: number | null;
  seekerMainnet: boolean;
  seekerCheckedAt: number | null;
  devnetGenesisMint: string | null;
  genesisCheckedAt: number | null;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
