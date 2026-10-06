import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MobileWalletProvider, type AppIdentity } from '@wallet-ui/react-native-kit'
import type { ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { APP_URL, DEVNET_RPC_URL } from '@/features/bao/data-access/bao-config'
import { ClusterProvider, useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { createClusterProps } from '@/features/cluster/data-access/create-cluster-props'
import { color } from '@/ui/tokens'

/** How Bao introduces itself to the wallet (Seed Vault on a Seeker). */
export const identity: AppIdentity = { name: 'Bao', uri: APP_URL, icon: 'icon.png' }

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 4_000 },
  },
})
const clusterConfig = createClusterProps()
// Bao runs on devnet only; the program, test Genesis group and tSKR live there.
clusterConfig.store.updateClusterUrl('solana:devnet' as never, DEVNET_RPC_URL)
clusterConfig.store.setCluster('solana:devnet' as never)

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
  const { cluster } = useAppCluster()
  return (
    <MobileWalletProvider cluster={cluster} identity={identity}>
      {children}
    </MobileWalletProvider>
  )
}
