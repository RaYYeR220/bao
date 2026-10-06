import { useStore } from '@nanostores/react'
import { atom, type WritableAtom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

const storage = createMMKV({ id: 'bao.prefs' })

function persistentAtom<T>(key: string, initial: T): WritableAtom<T> {
  let value = initial
  try {
    const raw = storage.getString(key)
    if (raw != null) value = JSON.parse(raw) as T
  } catch {
    value = initial
  }
  const store = atom<T>(value)
  store.listen((next) => storage.set(key, JSON.stringify(next)))
  return store
}

export const $sound = persistentAtom('sound', true)
export const $haptics = persistentAtom('haptics', true)
export const $onboarded = persistentAtom('onboarded', false)
/** Rains the user asked to be reminded of (packet → opens-at unix seconds). */
export const $reminders = persistentAtom<Record<string, number>>('reminders', {})
/** Whether we already asked for notification permission (we ask once, at a meaningful moment). */
export const $pushAsked = persistentAtom('pushAsked', false)

/**
 * Message and skin of packets dropped from this phone. The API stores them for everyone; this
 * copy keeps the sender's own packets dressed when the API is unreachable.
 */
export const $localMeta = persistentAtom<Record<string, { message?: string; skin?: string }>>('localMeta', {})

export function rememberPacketMeta(packet: string, meta: { message?: string; skin?: string }) {
  $localMeta.set({ ...$localMeta.get(), [packet]: meta })
}

export const usePref = <T,>(store: WritableAtom<T>) => useStore(store)
