import { useStore } from '@nanostores/react'
import type { Endpoints } from '@bao/sdk'
import { useQuery } from '@tanstack/react-query'
import { atom } from 'nanostores'
import { AppState } from 'react-native'

import { isAppActive, untilActive } from './app-state'
import { API_URL } from './bao-config'
import { $session, getToken, saveSession } from './session-store'

/** Whether the Bao server answered recently. The app keeps working on-chain when it is down. */
export const $api = atom<{ state: 'unknown' | 'up' | 'down'; checkedAt: number }>({ state: 'unknown', checkedAt: 0 })

export class ApiUnavailableError extends Error {
  constructor() {
    super('The Bao server is unreachable right now.')
  }
}

/** How long calls skip a server found unreachable before one of them asks it again. */
const RECHECK_MS = 10_000
/** A request's deadline when the caller names none. */
const TIMEOUT_MS = 12_000
/** A read's first try while the connection is in doubt, and the second try that follows a timeout. */
const FIRST_TRY_MS = 5_000
const SECOND_TRY_MS = 8_000
/** No answer for this long, or Bao back in front this recently: the connection is in doubt. */
const QUIET_MS = 20_000
const RESUMED_MS = 15_000
/** How long requests keep to the second door after the first one hung. */
const SECOND_DOOR_MS = 60_000
/** Pauses before retrying a request that never reached the server. */
const RETRY_MS = [400, 1200]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// when Bao last came back to the front: pooled connections may have died meanwhile, and a
// "server down" mark from before says nothing about now
let resumedAt = 0
AppState.addEventListener('change', (state) => {
  if (state === 'active') resumedAt = Date.now()
})
// refreshes the user asked for that are still running (see refreshNow)
let asked = 0
// 0 while the first door is trusted, else the time until which requests leave by the second
let secondDoorUntil = 0

/** No answer came back: the request ran out of time, or never reached the server at all. */
class NoAnswerError extends Error {
  constructor(
    readonly timedOut: boolean,
    detail = '',
  ) {
    super(timedOut ? 'Request timed out' : `Network request failed${detail && `: ${detail}`}`)
  }
}

/**
 * Two ways out, each with its own HTTP client and connection pool on Android: the global fetch
 * (Expo's) and React Native's XMLHttpRequest. Neither client has a timeout of its own, and a
 * request aborted here leaves its connection in the pool: one that stopped answering (say, left
 * over from before a network loss) takes the next request down with it. A second try through
 * the other door opens a new connection.
 */
type Door = 'fetch' | 'xhr'
type Wire = { method: string; headers: Record<string, string>; body: string | undefined }
type Answer = { status: number; text: string }

async function viaFetch(url: string, wire: Wire, timeoutMs: number): Promise<Answer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...wire, signal: controller.signal })
    return { status: res.status, text: await res.text() }
  } catch (e) {
    throw new NoAnswerError(controller.signal.aborted, e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

function viaXhr(url: string, wire: Wire, timeoutMs: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // the native deadline, and a later one here in case it never reports
    const timer = setTimeout(() => xhr.abort(), timeoutMs + 1_000)
    const settle = (run: () => void) => {
      clearTimeout(timer)
      run()
    }
    xhr.open(wire.method, url)
    for (const [name, value] of Object.entries(wire.headers)) xhr.setRequestHeader(name, value)
    xhr.timeout = timeoutMs
    xhr.onload = () => settle(() => resolve({ status: xhr.status, text: xhr.responseText }))
    xhr.onerror = () => settle(() => reject(new NoAnswerError(false)))
    xhr.ontimeout = () => settle(() => reject(new NoAnswerError(true)))
    xhr.onabort = () => settle(() => reject(new NoAnswerError(true)))
    xhr.send(wire.body)
  })
}

type Path<K> = K extends `${string} ${infer P}` ? P : never

/** The SDK's typed contract over HTTP, with a deadline so a slow call never holds a connection. */
async function rawCall<K extends keyof Endpoints>(
  key: K,
  opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown },
  timeoutMs: number,
  door: Door,
): Promise<Endpoints[K]['res']> {
  const [method, rawPath] = (key as string).split(' ') as [string, Path<K>]
  let path: string = rawPath
  for (const [k, v] of Object.entries(opts.params ?? {})) path = path.replace(`:${k}`, encodeURIComponent(v))
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : ''
  const token = getToken()
  const wire: Wire = {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
  }
  const { status, text } = await (door === 'xhr' ? viaXhr : viaFetch)(`${API_URL}${path}${qs}`, wire, timeoutMs)
  if (status === 401 && token && getToken() === token) {
    // the session expired or was revoked: forget it (the wallet stays connected; sign in again)
    await saveSession(null).catch(() => undefined)
  }
  if (status < 200 || status > 299) throw new Error(`${key} → ${status}: ${text}`)
  return JSON.parse(text) as Endpoints[K]['res']
}

function looksUnavailable(error: unknown) {
  if (error instanceof NoAnswerError) return true
  const text = error instanceof Error ? error.message : String(error)
  const m = /→ (\d{3}): ([\s\S]*)$/.exec(text)
  // not an HTTP status: the body was not the API's JSON
  if (!m) return true
  const status = Number(m[1])
  if (status >= 500) return true
  // a missing deployment or route answers with HTML or plain text, the API answers with JSON
  if (status === 404 && !m[2].trim().startsWith('{')) return true
  return false
}

/** Whether the next request may meet a connection that died without saying so. */
function inDoubt() {
  const { state, checkedAt } = $api.get()
  const now = Date.now()
  return state !== 'up' || now - checkedAt > QUIET_MS || now - resumedAt < RESUMED_MS || secondDoorUntil !== 0
}

/**
 * A refresh the user asked for (pull to refresh, "Try again"): the calls it makes ask the server
 * now, even when it was found unreachable a moment ago.
 */
export async function refreshNow<T>(refetch: () => Promise<T>): Promise<T> {
  asked++
  try {
    return await refetch()
  } finally {
    asked--
  }
}

/**
 * Typed API client. For 10 s after the server was found unreachable calls fail at once, so
 * screens fall back to the chain without waiting on timeouts; then the next call asks again.
 * `force`, and anything run inside refreshNow, skips that shortcut: a step the user asked for.
 *
 * Before the server is marked down a request gets more than one chance. One that never reached
 * the server is retried twice, each time once Bao is in front. A read that ran out of time is
 * asked once more through the other door (see Door); while the connection is in doubt (nothing
 * heard for a while, Bao just back in front, the server not known to be up) its first try is
 * short, so a dead connection costs 5 s and not the whole deadline. Writes, and calls with a
 * deadline of their own, are sent once. A failure seen while Bao was not in front never marks
 * the server down.
 */
export const baoApi = {
  async call<K extends keyof Endpoints>(
    key: K,
    opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
    { timeoutMs, force = false }: { timeoutMs?: number; force?: boolean } = {},
  ): Promise<Endpoints[K]['res']> {
    const status = $api.get()
    const down = status.state === 'down' && status.checkedAt >= resumedAt && Date.now() - status.checkedAt < RECHECK_MS
    if (down && !force && asked === 0) throw new ApiUnavailableError()
    const twice = (key as string).startsWith('GET ') && timeoutMs === undefined
    // after the first door hung, everything leaves by the second for a while; then reads try the
    // first again, and writes follow once one of them got through
    let door: Door = secondDoorUntil !== 0 && (Date.now() < secondDoorUntil || !twice) ? 'xhr' : 'fetch'
    let limit = twice && inDoubt() ? FIRST_TRY_MS : (timeoutMs ?? TIMEOUT_MS)
    let pauses = 0
    let second = false
    let fetchHung = false
    for (;;) {
      const activeAtStart = isAppActive()
      try {
        const res = await rawCall(key, opts, limit, door)
        $api.set({ state: 'up', checkedAt: Date.now() })
        if (door === 'fetch') secondDoorUntil = 0
        else if (fetchHung) secondDoorUntil = Date.now() + SECOND_DOOR_MS
        return res
      } catch (error) {
        if (error instanceof NoAnswerError && !error.timedOut && pauses < RETRY_MS.length) {
          await sleep(RETRY_MS[pauses++])
          await untilActive()
          continue
        }
        if (error instanceof NoAnswerError && error.timedOut && twice && !second) {
          second = true
          fetchHung = door === 'fetch'
          door = door === 'fetch' ? 'xhr' : 'fetch'
          limit = SECOND_TRY_MS
          continue
        }
        if (looksUnavailable(error)) {
          const text = String(error instanceof Error ? error.message : error)
          if (__DEV__) console.log('api: %s unavailable: %s', key, text.slice(0, 200))
          // a slow endpoint timing out says nothing about the rest of the server, and a request
          // made from the background (network blocked by Android) says nothing at all
          const slowOnly = /timed out/i.test(text) && key === 'GET /api/users/:address'
          const backgrounded = !activeAtStart || !isAppActive()
          if (!slowOnly && !backgrounded) $api.set({ state: 'down', checkedAt: Date.now() })
          throw new ApiUnavailableError()
        }
        $api.set({ state: 'up', checkedAt: Date.now() })
        throw error
      }
    }
  },
}

export const useApiState = () => useStore($api).state

export function useSession() {
  return useStore($session)
}

export function useMe() {
  const session = useSession()
  return useQuery({
    queryKey: ['me', session?.address],
    queryFn: () => baoApi.call('GET /api/me'),
    enabled: !!session,
    retry: false,
  })
}

export function useCircles() {
  const session = useSession()
  return useQuery({
    queryKey: ['circles', session?.address],
    queryFn: () => baoApi.call('GET /api/circles'),
    enabled: !!session,
    retry: false,
  })
}

export function useCircle(id: string | undefined) {
  return useQuery({
    queryKey: ['circle', id],
    queryFn: () => baoApi.call('GET /api/circles/:id', { params: { id: id! } }),
    enabled: !!id,
    refetchInterval: 15_000,
    retry: false,
  })
}

export function useUserProfile(address: string | undefined) {
  return useQuery({
    queryKey: ['user', address],
    queryFn: () => baoApi.call('GET /api/users/:address', { params: { address: address! } }),
    enabled: !!address,
    retry: false,
  })
}

/** The server's own message for a refused request ("faucet already used…"), else a short fallback. */
export function apiErrorMessage(error: unknown, fallback = 'The Bao server said no. Try again in a moment.'): string {
  if (error instanceof ApiUnavailableError) return error.message
  const text = error instanceof Error ? error.message : String(error)
  const m = /→ \d{3}: ([\s\S]*)$/.exec(text)
  if (!m) return fallback
  try {
    const body = JSON.parse(m[1]) as { error?: string; message?: string }
    const msg = body.error ?? body.message
    if (!msg) return fallback
    if (/faucet already used/i.test(msg))
      return 'You already collected today’s test tokens. Come back tomorrow, or grab a packet from the feed.'
    return msg.charAt(0).toUpperCase() + msg.slice(1).replace(/\.?$/, '.')
  } catch {
    return fallback
  }
}
