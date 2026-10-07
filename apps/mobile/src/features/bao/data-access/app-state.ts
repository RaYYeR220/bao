import { AppState } from 'react-native'

/** Bao is in front: anything but a reported background (no report yet is not a reason to wait). */
export const isAppActive = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'

/** Time Android takes to lift the background network block once Bao is in front again. */
const SETTLE_MS = 250

/**
 * Resolves once Bao is in the foreground, or after `timeoutMs` regardless. Android blocks the
 * network of an app in the background: while a wallet still covers Bao, and for a moment after
 * it closes, every request fails with "Network request failed" without reaching the server.
 */
export function untilActive(timeoutMs = 4000): Promise<boolean> {
  if (isAppActive()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (active: boolean) => {
      sub.remove()
      clearTimeout(timer)
      if (active) setTimeout(() => resolve(true), SETTLE_MS)
      else resolve(isAppActive())
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish(true)
    })
    const timer = setTimeout(() => finish(false), timeoutMs)
  })
}

/**
 * Awaits a wallet round trip (connect, sign in, sign and send), then Bao's return to the
 * foreground, so the request that follows is not fired into the background network block.
 */
export async function afterWallet<T>(roundTrip: Promise<T>): Promise<T> {
  const result = await roundTrip
  await untilActive()
  return result
}
