import { address } from '@solana/kit'
import { DEVNET } from '@bao/sdk'

const envAppUrl = process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, '')
/** Public https URL of the Bao API and link pages; also the wallet identity uri. */
export const APP_URL = envAppUrl && /^https:\/\/[^/]+$/i.test(envAppUrl) ? envAppUrl : 'https://getbao.vercel.app'
/** Host of APP_URL: the only https host whose links Bao opens, and the SIWS domain. */
export const APP_HOST = APP_URL.replace(/^[a-z]+:\/\//i, '')
  .split('/')[0]
  .toLowerCase()
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? APP_URL

export const DEVNET_RPC_URL = process.env.EXPO_PUBLIC_DEVNET_RPC ?? 'https://api.devnet.solana.com'
/** The cluster of DEVNET_RPC_URL, as the wallet (MWA authorize, SIWS chainId) names it. */
export const BAO_CHAIN = 'solana:devnet'
/**
 * Bao's server-side front for that same devnet cluster: it forwards reads and simulations to a
 * keyed devnet endpoint the app must not ship. The app asks it first and DEVNET_RPC_URL when it
 * fails. EXPO_PUBLIC_RPC_PROXY=off leaves DEVNET_RPC_URL alone (local development).
 */
export const DEVNET_RPC_PROXY_URL = /^(off|false|0)$/i.test(process.env.EXPO_PUBLIC_RPC_PROXY ?? '')
  ? null
  : `${API_URL}/api/rpc`

export const PROGRAM_ID = address(DEVNET.programId)
export const GENESIS_GROUP = address(DEVNET.genesisGroup ?? 'BuRJQxYkL43H3MmgmZmRuC1GCDFc1hSkEu2t1mxiDgwK')
export const TSKR_MINT = address(DEVNET.tskrMint ?? 'aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr')
export const TREASURY = address(DEVNET.treasury ?? '4EtAFmWtCzMxyUku7NofttEPLDWniigFAEL7KmCeCYKo')
export const TSKR_DECIMALS = 6

export const packetLink = (packet: string) => `${APP_URL}/p/${packet}`
export const packetDeepLink = (packet: string) => `bao://packet/${packet}`
