import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createSolanaDevnet, MobileWalletProvider, type AppIdentity } from '@wallet-ui/react-native-kit'
import type { ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { APP_URL, DEVNET_RPC_URL } from '@/features/bao/data-access/bao-config'
import { ClusterProvider } from '@/features/cluster/data-access/cluster-provider'
import { createClusterProps } from '@/features/cluster/data-access/create-cluster-props'
import { color } from '@/ui/tokens'

/**
 * How Bao introduces itself to the wallet (Seed Vault on a Seeker): an https uri, a name and an
 * icon (relative to the uri, so https://getbao.vercel.app/icon.png).
 */
export const identity: AppIdentity = { name: 'Bao', uri: APP_URL, icon: 'icon.png' }

/**
 * The one cluster Bao uses: the wallet authorizes for `solana:devnet` (BAO_CHAIN, checked again
 * before every signature) and every RPC call goes to the devnet endpoint.
 */
export const BAO_CLUSTER = createSolanaDevnet({ label: 'Devnet', url: DEVNET_RPC_URL })

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 4_000 },
  },
})
const clusterConfig = createClusterProps()
// Bao runs on devnet only; the program, test Genesis group and tSKR live there. The RPC client
// (useAppCluster) reads the same endpoint the wallet is authorized for.
clusterConfig.store.updateClusterUrl(BAO_CLUSTER.id, BAO_CLUSTER.url)
clusterConfig.store.setCluster(BAO_CLUSTER.id)

export function Providers({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.kuro950 }}>
      <QueryClientProvider client={queryClient}>
        <ClusterProvider store={clusterConfig.store}>
          <WalletProvider>{children}</WalletProvider>
        </ClusterProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}

function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <MobileWalletProvider cluster={BAO_CLUSTER} identity={identity}>
      {children}
    </MobileWalletProvider>
  )
}
