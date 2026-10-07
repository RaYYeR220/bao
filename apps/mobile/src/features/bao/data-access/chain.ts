/**
 * Reads Bao state straight from the chain. The API is the rich source (names, messages,
 * circles); this is the fallback that keeps the feed, packet detail and history honest and
 * working when the API cannot be reached. Everything here is decoded from program accounts.
 */
import {
  getBase58Decoder,
  getBase64Encoder,
  getAddressEncoder,
  isSome,
  type Address,
  type Base58EncodedBytes,
  type ReadonlyUint8Array,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit'
import {
  BAO_PROGRAM_ADDRESS,
  CLAIM_RECORD_DISCRIMINATOR,
  CROWN_DISCRIMINATOR,
  ClaimStatus,
  PACKET_DISCRIMINATOR,
  SplitMode,
  findClaimPda,
  getClaimRecordDecoder,
  getCrownDecoder,
  getPacketDecoder,
  messageHash,
  type ClaimRecord,
  type FeedView,
  type GrabView,
  type Packet,
  type PacketDetail,
  type PacketStatus,
  type PacketView,
  type TokenInfo,
} from '@bao/sdk'

import { TSKR_DECIMALS, TSKR_MINT } from './bao-config'
import { $localMeta } from './prefs'

type BaoRpc = Rpc<SolanaRpcApi>

const b58 = getBase58Decoder()
const b64 = getBase64Encoder()
const addr = getAddressEncoder()

const bytesFilter = (offset: number, bytes: ReadonlyUint8Array) => ({
  memcmp: { offset: BigInt(offset), bytes: b58.decode(bytes) as Base58EncodedBytes, encoding: 'base58' as const },
})

async function programAccounts(
  rpc: BaoRpc,
  discriminator: Uint8Array,
  extra: { offset: number; address: Address }[] = [],
) {
  const res = await rpc
    .getProgramAccounts(BAO_PROGRAM_ADDRESS, {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [bytesFilter(0, discriminator), ...extra.map((e) => bytesFilter(e.offset, addr.encode(e.address)))],
    })
    .send()
  return (res as unknown as { pubkey: Address; account: { data: [string, string] } }[]).map((a) => ({
    address: a.pubkey,
    bytes: b64.encode(a.account.data[0]),
  }))
}

export const TSKR: TokenInfo = { mint: TSKR_MINT, symbol: 'tSKR', decimals: TSKR_DECIMALS, usd: null }
export const tokenFor = (mint: string): TokenInfo | null => (mint === TSKR_MINT ? TSKR : null)

const nowSec = () => Math.floor(Date.now() / 1000)

export function packetStatus(
  p: Pick<Packet, 'reserved' | 'totalShares' | 'expiresAt' | 'startsAt'>,
  now = nowSec(),
): PacketStatus {
  if (p.reserved >= p.totalShares) return 'emptied'
  if (now >= Number(p.expiresAt)) return 'expired'
  if (now < Number(p.startsAt)) return 'scheduled'
  return 'live'
}

/** Message and skin this phone remembers for its own packets, if the message matches the chain. */
function localDress(address: string, p: Packet) {
  const meta = $localMeta.get()[address]
  if (!meta) return { message: null, skin: null }
  const hash = messageHash(meta.message ?? null)
  const same = hash.length === p.messageHash.length && hash.every((b, i) => b === p.messageHash[i])
  return { message: same ? (meta.message ?? null) : null, skin: meta.skin ?? null }
}

export function packetToView(address: Address, p: Packet): PacketView | null {
  const token = tokenFor(p.mint)
  if (!token) return null
  const dress = localDress(address, p)
  return {
    address,
    sender: p.sender,
    senderSkr: null,
    token,
    total: p.totalAmount.toString(),
    remaining: p.remainingAmount.toString(),
    shares: p.totalShares,
    reserved: p.reserved,
    resolved: p.resolved,
    mode: p.mode === SplitMode.Lucky ? 'lucky' : 'equal',
    audience: p.audience.__kind === 'Open' ? 'open' : p.audience.__kind === 'Circle' ? 'circle' : 'code',
    seekerOnly: p.seekerOnly,
    startsAt: Number(p.startsAt),
    expiresAt: Number(p.expiresAt),
    createdAt: Number(p.createdAt),
    status: packetStatus(p),
    message: dress.message,
    skin: dress.skin,
    circleId: null,
    codeHint: null,
    chainRoot: p.chainRoot,
    chainDepth: p.chainDepth,
    luckKing: isSome(p.luckKing) ? p.luckKing.value : null,
    luckKingSkr: null,
    luckKingAmount: isSome(p.luckKing) ? p.luckKingAmount.toString() : null,
    createSignature: null,
  }
}

const packetDecoder = getPacketDecoder()
const claimDecoder = getClaimRecordDecoder()
const crownDecoder = getCrownDecoder()

const WEEK = 8 * 86400

/** Rejects accounts written by an older program layout, which decode into nonsense. */
function plausible(p: Packet) {
  const created = Number(p.createdAt)
  const starts = Number(p.startsAt)
  const expires = Number(p.expiresAt)
  return (
    created > 1_700_000_000 &&
    created < nowSec() + 86400 &&
    starts >= created - 60 &&
    starts <= created + WEEK &&
    expires > starts &&
    expires <= starts + WEEK &&
    p.totalShares >= 1 &&
    p.totalShares <= 200 &&
    p.reserved <= p.totalShares &&
    p.remainingAmount <= p.totalAmount
  )
}

function decodePacket(bytes: ReadonlyUint8Array): Packet | null {
  try {
    const [data, read] = packetDecoder.read(bytes, 0)
    return read <= bytes.length && plausible(data) ? data : null
  } catch {
    return null
  }
}

function decodePackets(rows: { address: Address; bytes: ReadonlyUint8Array }[]) {
  const out: { address: Address; data: Packet }[] = []
  for (const r of rows) {
    const data = decodePacket(r.bytes)
    if (data) out.push({ address: r.address, data })
  }
  return out
}

/** The public feed from the chain: open tSKR packets that are live, plus scheduled rains. */
export async function fetchChainFeed(rpc: BaoRpc): Promise<FeedView> {
  const rows = decodePackets(await programAccounts(rpc, PACKET_DISCRIMINATOR))
  const views = rows
    .map((r) => packetToView(r.address, r.data))
    .filter((v): v is PacketView => !!v && v.audience === 'open')
  const live = views.filter((v) => v.status === 'live').sort((a, b) => a.expiresAt - b.expiresAt)
  const rains = views.filter((v) => v.status === 'scheduled').sort((a, b) => a.startsAt - b.startsAt)
  return { packets: live, rains }
}

const claimStatusName = (s: ClaimStatus) =>
  s === ClaimStatus.Pending ? 'pending' : s === ClaimStatus.Won ? 'won' : 'paid'

function claimToGrab(record: ClaimRecord, sigs: { signature: string; blockTime: number | null }[]): GrabView {
  // Oldest first: the grab, then (Lucky) the VRF callback, then the payout.
  const [grab, callback, payout] = sigs
  const lucky = sigs.length > 1 || record.status !== ClaimStatus.Paid
  return {
    packet: record.packet,
    claimer: record.claimer,
    claimerSkr: null,
    deviceKey: record.deviceKey,
    index: record.index,
    amount: record.status === ClaimStatus.Pending ? null : record.amount.toString(),
    status: claimStatusName(record.status),
    grabSignature: grab?.signature ?? null,
    callbackSignature: lucky ? (callback?.signature ?? null) : null,
    payoutSignature: lucky ? (payout?.signature ?? null) : null,
    randomness: null,
    at: grab?.blockTime ?? 0,
  }
}

async function oldestSignatures(rpc: BaoRpc, account: Address) {
  try {
    const sigs = await rpc.getSignaturesForAddress(account, { limit: 10, commitment: 'confirmed' }).send()
    return [...sigs]
      .filter((s) => !s.err)
      .reverse()
      .map((s) => ({ signature: s.signature as string, blockTime: s.blockTime == null ? null : Number(s.blockTime) }))
  } catch {
    return []
  }
}

/** Every grab of one packet, with the transactions that prove it. Null if the packet is closed. */
export async function fetchChainPacketDetail(rpc: BaoRpc, packet: Address): Promise<PacketDetail | null> {
  const { value } = await rpc.getAccountInfo(packet, { encoding: 'base64', commitment: 'confirmed' }).send()
  if (!value) return null
  const data = decodePacket(b64.encode((value.data as unknown as [string, string])[0]))
  if (!data) return null
  const view = packetToView(packet, data)
  if (!view) return null
  const rows = await programAccounts(rpc, CLAIM_RECORD_DISCRIMINATOR, [{ offset: 8, address: packet }])
  const claims = rows.map((r) => ({ address: r.address, data: claimDecoder.decode(r.bytes) }))
  const withSigs = await Promise.all(
    claims.slice(0, 40).map(async (c) => claimToGrab(c.data, await oldestSignatures(rpc, c.address))),
  )
  const created = await oldestSignatures(rpc, packet)
  return {
    ...view,
    createSignature: created[0]?.signature ?? null,
    grabs: withSigs.sort((a, b) => a.index - b.index),
  }
}

/** Packets a wallet dropped. */
export async function fetchChainSent(rpc: BaoRpc, sender: Address): Promise<PacketView[]> {
  const rows = decodePackets(await programAccounts(rpc, PACKET_DISCRIMINATOR, [{ offset: 8, address: sender }]))
  return rows
    .map((r) => packetToView(r.address, r.data))
    .filter((v): v is PacketView => !!v)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Grabs a wallet made (claim records still open on-chain), newest first, with their packets. */
export async function fetchChainGrabs(rpc: BaoRpc, claimer: Address) {
  const rows = await programAccounts(rpc, CLAIM_RECORD_DISCRIMINATOR, [{ offset: 40, address: claimer }])
  const claims = rows.map((r) => ({ address: r.address, data: claimDecoder.decode(r.bytes) }))
  const packets = await fetchPackets(
    rpc,
    claims.map((c) => c.data.packet),
  )
  const grabs = await Promise.all(
    claims.slice(0, 30).map(async (c) => ({
      grab: claimToGrab(c.data, await oldestSignatures(rpc, c.address)),
      packet: packets.get(c.data.packet) ?? null,
    })),
  )
  return grabs.sort((a, b) => b.grab.at - a.grab.at)
}

/** Live crowns a wallet holds (Luck King of a packet whose chain is still open). */
export async function fetchChainCrowns(rpc: BaoRpc, king: Address) {
  const rows = await programAccounts(rpc, CROWN_DISCRIMINATOR, [{ offset: 40, address: king }])
  return rows.map((r) => ({ address: r.address, data: crownDecoder.decode(r.bytes) }))
}

export async function fetchPackets(rpc: BaoRpc, addresses: Address[]) {
  const distinct = [...new Set(addresses)]
  const out = new Map<string, PacketView>()
  for (let i = 0; i < distinct.length; i += 100) {
    const chunk = distinct.slice(i, i + 100)
    const { value } = await rpc.getMultipleAccounts(chunk, { encoding: 'base64', commitment: 'confirmed' }).send()
    value.forEach((acc, k) => {
      if (!acc) return
      const data = decodePacket(b64.encode((acc.data as unknown as [string, string])[0]))
      const v = data ? packetToView(chunk[k], data) : null
      if (v) out.set(chunk[k], v)
    })
  }
  return out
}

/** This device's claim on a packet, if it already grabbed (device = Genesis mint or wallet). */
export async function fetchMyClaim(rpc: BaoRpc, packet: Address, deviceKey: Address) {
  const [claim] = await findClaimPda(packet, deviceKey)
  const { value } = await rpc.getAccountInfo(claim, { encoding: 'base64', commitment: 'confirmed' }).send()
  if (!value) return null
  return { address: claim, data: claimDecoder.decode(b64.encode((value.data as unknown as [string, string])[0])) }
}

/** tSKR and SOL held by a wallet, in base units. */
export async function fetchBalances(rpc: BaoRpc, owner: Address) {
  const [sol, tokens] = await Promise.all([
    rpc.getBalance(owner, { commitment: 'confirmed' }).send(),
    rpc.getTokenAccountsByOwner(owner, { mint: TSKR_MINT }, { encoding: 'jsonParsed', commitment: 'confirmed' }).send(),
  ])
  let tskr = 0n
  for (const t of tokens.value) {
    const amount = (t.account.data as unknown as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed
      ?.info?.tokenAmount?.amount
    if (amount) tskr += BigInt(amount)
  }
  return { lamports: BigInt(sol.value), tskr }
}

export type { Signature }
