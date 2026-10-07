import { createSolanaRpc } from '@solana/kit'
import type { WidgetView } from '@bao/sdk'
import * as SecureStore from 'expo-secure-store'

import { API_URL, DEVNET_RPC_URL } from '@/features/bao/data-access/bao-config'
import { fetchChainFeed } from '@/features/bao/data-access/chain'
import { formatAmount } from '@/features/bao/format'

/**
 * What the home-screen widget shows. Runs headless (no React tree), so it reads the session
 * token straight from the keystore and falls back to the chain when the API is unreachable.
 */
export async function loadWidgetData(): Promise<WidgetView & { source: 'api' | 'chain' }> {
  try {
    const raw = await SecureStore.getItemAsync('bao.session')
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : null
    const res = await Promise.race([
      fetch(`${API_URL}/api/widget`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 6000)),
    ])
    if (!res.ok) throw new Error(String(res.status))
    return { ...((await res.json()) as WidgetView), source: 'api' }
  } catch {
    // Bao's server just failed and the RPC proxy lives on it: read the public endpoint directly
    const rpc = createSolanaRpc(DEVNET_RPC_URL)
    const feed = await fetchChainFeed(rpc as never)
    const total = feed.packets.reduce((sum, p) => sum + BigInt(p.remaining), 0n)
    return {
      waiting: feed.packets.length,
      waitingAmountUi: formatAmount(total, 6, 0),
      symbol: 'tSKR',
      nextRainAt: feed.rains[0]?.startsAt ?? null,
      topPacket: feed.packets[0]?.address ?? feed.rains[0]?.address ?? null,
      source: 'chain',
    }
  }
}
