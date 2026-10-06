import { address } from '@solana/kit'
import { DEVNET } from '@bao/sdk'

/** Public URL of the Bao API and link pages (also the wallet identity domain). */
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://getbao.vercel.app').replace(/\/$/, '')
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? APP_URL

export const DEVNET_RPC_URL = process.env.EXPO_PUBLIC_DEVNET_RPC ?? 'https://api.devnet.solana.com'

export const PROGRAM_ID = address(DEVNET.programId)
export const GENESIS_GROUP = address(DEVNET.genesisGroup ?? 'BuRJQxYkL43H3MmgmZmRuC1GCDFc1hSkEu2t1mxiDgwK')
export const TSKR_MINT = address(DEVNET.tskrMint ?? 'aveV2LBQt6Bck1nsju3md5k223uxQNULjDvW6QcmCCr')
export const TREASURY = address(DEVNET.treasury ?? '4EtAFmWtCzMxyUku7NofttEPLDWniigFAEL7KmCeCYKo')
export const TSKR_DECIMALS = 6

export const packetLink = (packet: string) => `${APP_URL}/p/${packet}`
export const packetDeepLink = (packet: string) => `bao://packet/${packet}`
