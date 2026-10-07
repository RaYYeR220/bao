import * as SecureStore from 'expo-secure-store'
import { atom } from 'nanostores'

const KEY = 'bao.session'

export interface BaoSession {
  token: string
  address: string
}

/** Signed-in session (SIWS-backed JWT); persisted only in the device keystore (expo-secure-store). */
export const $session = atom<BaoSession | null>(null)

export async function loadSession() {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<BaoSession>) : null
    $session.set(
      parsed && typeof parsed.token === 'string' && typeof parsed.address === 'string'
        ? { token: parsed.token, address: parsed.address }
        : null,
    )
  } catch {
    $session.set(null)
  }
}

export async function saveSession(session: BaoSession | null) {
  $session.set(session)
  if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session))
  else await SecureStore.deleteItemAsync(KEY)
}

export const getToken = () => $session.get()?.token ?? null
