import AsyncStorage from '@react-native-async-storage/async-storage'
import { isAddress } from '@solana/kit'
import type { WalletAuthorization, WalletAuthorizationCache } from '@wallet-ui/react-native-kit'
import * as SecureStore from 'expo-secure-store'

const KEY = 'bao.wallet-authorization'
/** Where @wallet-ui keeps the authorization by default (plain AsyncStorage). */
const LEGACY_KEY = 'authorization-cache'

type Account = WalletAuthorization['accounts'][number]

// wallet icons are data URIs (kilobytes); the keystore entry only needs addresses and the token
const slim = ({ address, addressBase64, label }: Account): Account => ({ address, addressBase64, label })

function parse(raw: string | null): WalletAuthorization | undefined {
  if (!raw) return undefined
  try {
    const auth = JSON.parse(raw) as WalletAuthorization
    const ok = (a: Account | undefined) => !!a && isAddress(a.address) && typeof a.addressBase64 === 'string'
    if (typeof auth.authToken !== 'string' || !ok(auth.selectedAccount) || !auth.accounts.every(ok)) return undefined
    return auth
  } catch {
    return undefined
  }
}

async function clear() {
  await SecureStore.deleteItemAsync(KEY)
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined)
}

async function set(value: WalletAuthorization | undefined) {
  if (!value) return clear()
  const auth: WalletAuthorization = {
    authToken: value.authToken,
    accounts: value.accounts.map(slim),
    selectedAccount: slim(value.selectedAccount),
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(auth))
}

async function get() {
  const stored = parse(await SecureStore.getItemAsync(KEY).catch(() => null))
  if (stored) return stored
  const legacy = parse(await AsyncStorage.getItem(LEGACY_KEY).catch(() => null))
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined)
  if (legacy) await set(legacy).catch(() => undefined)
  return legacy
}

/**
 * The Mobile Wallet Adapter authorization (auth token + accounts) lives in the device keystore
 * (expo-secure-store), next to the Bao session, instead of @wallet-ui's default AsyncStorage.
 * A token left in AsyncStorage by an earlier build is moved over once and deleted there.
 */
export const secureWalletAuthorizationCache: WalletAuthorizationCache = { get, set, clear }
