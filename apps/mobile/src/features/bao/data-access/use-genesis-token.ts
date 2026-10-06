import { address } from '@solana/kit'
import { findGenesisToken } from '@bao/sdk'
import { useQuery } from '@tanstack/react-query'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'

import { GENESIS_GROUP } from './bao-config'

/** The wallet's Seeker Genesis Token in the group the devnet program checks (null if none). */
export function useGenesisToken(owner: string | undefined) {
  const { client } = useAppCluster()
  return useQuery({
    queryKey: ['genesis', owner],
    queryFn: () => findGenesisToken(client.rpc as never, address(owner!), GENESIS_GROUP),
    enabled: !!owner,
    staleTime: 60_000,
  })
}
