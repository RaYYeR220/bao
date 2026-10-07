import { address, getBase64Encoder, type Address, type Rpc, type SolanaRpcApi } from '@solana/kit'
import {
  ClaimStatus,
  fetchMaybeCrown,
  findClaimPda,
  findCrownPda,
  getClaimRecordDecoder,
  type FeedView,
  type GrabView,
  type PacketDetail,
  type PacketView,
} from '@bao/sdk'
import { useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

import {
  fetchBalances,
  fetchChainCrowns,
  fetchChainFeed,
  fetchChainGrabs,
  fetchChainPacketDetail,
  fetchChainSent,
  fetchMyClaim,
  fetchPackets,
} from './chain'
import { baoApi, useSession } from './use-bao-api'
import { useGenesisToken } from './use-genesis-token'

export type Source = 'api' | 'chain'

/** Live packets and upcoming rains: from the API, or decoded from the chain when it is down. */
export function useFeedData() {
  const { client } = useAppCluster()
  const session = useSession()
  return useQuery({
    queryKey: ['feed', session?.address ?? null],
    queryFn: async (): Promise<FeedView & { source: Source }> => {
      try {
        return { ...(await baoApi.call('GET /api/feed')), source: 'api' }
      } catch {
        return { ...(await fetchChainFeed(client.rpc as never)), source: 'chain' }
      }
    },
    refetchInterval: 8_000,
    placeholderData: (prev) => prev,
  })
}

export function usePacketData(packet: string | undefined) {
  const { client } = useAppCluster()
  return useQuery({
    queryKey: ['packet', packet],
    queryFn: async (): Promise<{ detail: PacketDetail | null; source: Source }> => {
      try {
        return {
          detail: await baoApi.call('GET /api/packets/:address', { params: { address: packet! } }),
          source: 'api',
        }
      } catch {
        return { detail: await fetchChainPacketDetail(client.rpc as never, address(packet!)), source: 'chain' }
      }
    },
    enabled: !!packet,
    refetchInterval: 5_000,
    placeholderData: (prev) => prev,
  })
}

export interface History {
  sent: PacketView[]
  grabs: { grab: GrabView; packet: PacketView | null }[]
  crowns: number
  source: Source
}

/** What a wallet sent and grabbed, and its crowns. */
export function useHistory(owner: string | undefined) {
  const { client } = useAppCluster()
  return useQuery({
    queryKey: ['history', owner],
    queryFn: async (): Promise<History> => {
      try {
        const res = await baoApi.call('GET /api/users/:address', { params: { address: owner! } }, { timeoutMs: 25_000 })
        const packets = await fetchPackets(
          client.rpc as never,
          res.grabs.map((g) => g.packet as Address),
        ).catch(() => new Map<string, PacketView>())
        const known = new Map(res.sent.map((p) => [p.address, p]))
        return {
          sent: res.sent,
          grabs: res.grabs.map((g) => ({ grab: g, packet: known.get(g.packet) ?? packets.get(g.packet) ?? null })),
          crowns: res.crowns,
          source: 'api',
        }
      } catch {
        const rpc = client.rpc as never
        const me = address(owner!)
        const [sent, grabs, crowns] = await Promise.all([
          fetchChainSent(rpc, me),
          fetchChainGrabs(rpc, me),
          fetchChainCrowns(rpc, me),
        ])
        return { sent, grabs, crowns: crowns.length, source: 'chain' }
      }
    },
    enabled: !!owner,
    refetchInterval: 20_000,
    placeholderData: (prev) => prev,
  })
}

export function useBalances(owner: string | undefined) {
  const { client } = useAppCluster()
  return useQuery({
    queryKey: ['balances', owner],
    queryFn: () => fetchBalances(client.rpc as never, address(owner!)),
    enabled: !!owner,
    refetchInterval: 15_000,
  })
}

/** Which of these packets this phone already grabbed, and for how much (one RPC call). */
export function useMyClaims(packets: PacketView[] | undefined) {
  const { client } = useAppCluster()
  const { account } = useMobileWallet()
  const genesis = useGenesisToken(account?.address)
  const keys = (packets ?? []).map((p) => p.address).join(',')
  return useQuery({
    queryKey: ['my-claims', keys, account?.address, genesis.data?.mint ?? null],
    queryFn: async () => {
      const out: Record<string, string | null> = {}
      const list = packets ?? []
      const pdas = await Promise.all(
        list.map(async (p) => {
          const device = p.seekerOnly ? genesis.data?.mint : account?.address
          if (!device) return null
          const [pda] = await findClaimPda(address(p.address), device as Address)
          return pda
        }),
      )
      const targets = pdas.map((p, i) => ({ p, i })).filter((x): x is { p: Address; i: number } => !!x.p)
      if (!targets.length) return out
      const { value } = await (client.rpc as never as BaoRpcLike)
        .getMultipleAccounts(
          targets.map((t) => t.p),
          { encoding: 'base64', commitment: 'confirmed' },
        )
        .send()
      value.forEach((acc, k) => {
        if (!acc) return
        try {
          const rec = claimDecoder.decode(b64.encode((acc.data as unknown as [string, string])[0]))
          out[list[targets[k].i].address] = rec.status === ClaimStatus.Pending ? null : rec.amount.toString()
        } catch {
          // ignore
        }
      })
      return out
    },
    enabled: !!account && !!packets?.length && !genesis.isLoading,
    staleTime: 10_000,
  })
}

type BaoRpcLike = Rpc<SolanaRpcApi>
const claimDecoder = getClaimRecordDecoder()
const b64 = getBase64Encoder()

/**
 * Whether this phone already grabbed a packet. The device key is the Genesis token for
 * Seeker-only packets and the wallet otherwise, exactly as the program derives it.
 */
export function useMyClaim(packet: string | undefined, seekerOnly: boolean | undefined) {
  const { client } = useAppCluster()
  const { account } = useMobileWallet()
  const genesis = useGenesisToken(account?.address)
  const deviceKey = seekerOnly ? genesis.data?.mint : account?.address
  return useQuery({
    queryKey: ['my-claim', packet, deviceKey],
    queryFn: () => fetchMyClaim(client.rpc as never, address(packet!), deviceKey as Address),
    enabled: !!packet && !!deviceKey && seekerOnly !== undefined,
  })
}

/**
 * The Luck King crown of a packet. It exists once every share is settled (or the packet was
 * closed); until then the biggest grab is only "Luck King so far" and cannot extend the chain.
 */
export function useCrown(packet: string | undefined) {
  const { client } = useAppCluster()
  return useQuery({
    queryKey: ['crown', packet],
    queryFn: async () => {
      const [pda] = await findCrownPda({ packet: address(packet!) })
      const crown = await fetchMaybeCrown(client.rpc as never, pda)
      return crown.exists ? crown.data : null
    },
    enabled: !!packet,
    refetchInterval: 10_000,
  })
}
