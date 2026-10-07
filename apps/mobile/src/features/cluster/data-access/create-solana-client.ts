import {
  createClient,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  extendClient,
  type RpcTransport,
} from '@solana/kit'
import { solanaRpcConnection } from '@solana/kit-plugin-rpc'
import type { SolanaCluster } from '@wallet-ui/react-native-kit'

import { isAppActive } from '@/features/bao/data-access/app-state'
import { BAO_CHAIN, DEVNET_RPC_PROXY_URL } from '@/features/bao/data-access/bao-config'
import { createFailoverTransport } from '@/features/cluster/data-access/failover-transport'

/**
 * How JSON-RPC requests reach the cluster. `cluster.url` is the cluster's own endpoint: the
 * public devnet RPC, the cluster the wallet is authorized for. On devnet, Bao's server proxy is
 * asked first: a devnet-only front for that same cluster, which forwards allowlisted reads and
 * simulations to a keyed devnet endpoint the app does not ship. It changes how reliably an answer
 * comes, never which chain answers; when it fails, the same request goes to `cluster.url` (see
 * createFailoverTransport).
 */
function clusterTransport(cluster: SolanaCluster): RpcTransport {
  const direct = createDefaultRpcTransport({ url: cluster.url })
  if (cluster.id !== BAO_CHAIN || !DEVNET_RPC_PROXY_URL) return direct
  return createFailoverTransport(createDefaultRpcTransport({ url: DEVNET_RPC_PROXY_URL }), direct, {
    // a request fired while a wallet covers Bao says nothing about the proxy
    canJudge: isAppActive,
    onFailover: __DEV__
      ? ({ method, reason }) => console.log('rpc: %s went to %s, the proxy failed: %s', method, cluster.url, reason)
      : undefined,
  })
}

export function createSolanaClient(cluster: SolanaCluster) {
  return (
    createClient()
      // the cluster's own endpoints; subscriptions stay on its websocket
      .use(
        solanaRpcConnection({
          rpcSubscriptionsUrl: cluster.urlWs,
          rpcUrl: cluster.url,
        }),
      )
      // same cluster, same API: only the HTTP transport tries the proxy before `cluster.url`
      .use((client) => extendClient(client, { rpc: createSolanaRpcFromTransport(clusterTransport(cluster)) }))
  )
}

export type SolanaClient = ReturnType<typeof createSolanaClient>
