import * as SecureStore from 'expo-secure-store'
import { atom } from 'nanostores'

const KEY = 'bao.session'

export interface BaoSession {
  token: string
  address: string
}

/** Signed-in session (SIWS-backed JWT); persisted in the device keystore. */
export const $session = atom<BaoSession | null>(null)

export async function loadSession() {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    $session.set(raw ? (JSON.parse(raw) as BaoSession) : null)
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
