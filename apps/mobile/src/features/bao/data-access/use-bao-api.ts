import { useStore } from '@nanostores/react'
import type { Endpoints } from '@bao/sdk'
import { useQuery } from '@tanstack/react-query'
import { atom } from 'nanostores'

import { API_URL } from './bao-config'
import { $session, getToken } from './session-store'

/** Whether the Bao server answered recently. The app keeps working on-chain when it is down. */
export const $api = atom<{ state: 'unknown' | 'up' | 'down'; checkedAt: number }>({ state: 'unknown', checkedAt: 0 })

export class ApiUnavailableError extends Error {
  constructor() {
    super('The Bao server is unreachable right now.')
  }
}

const RECHECK_MS = 30_000

type Path<K> = K extends `${string} ${infer P}` ? P : never

/** The SDK's typed contract over fetch, with an abort on timeout so a slow call never holds a connection. */
async function rawCall<K extends keyof Endpoints>(
  key: K,
  opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown },
  timeoutMs: number,
): Promise<Endpoints[K]['res']> {
  const [method, rawPath] = (key as string).split(' ') as [string, Path<K>]
  let path: string = rawPath
  for (const [k, v] of Object.entries(opts.params ?? {})) path = path.replace(`:${k}`, encodeURIComponent(v))
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : ''
  const token = getToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_URL}${path}${qs}`, {
      method,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    })
    if (!res.ok) throw new Error(`${key} → ${res.status}: ${await res.text()}`)
    return (await res.json()) as Endpoints[K]['res']
  } catch (e) {
    if (controller.signal.aborted) throw new Error('Request timed out')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function looksUnavailable(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  if (/network request failed|failed to fetch|timed out|aborted/i.test(text)) return true
  const m = /→ (\d{3}): ([\s\S]*)$/.exec(text)
  if (!m) return true
  const status = Number(m[1])
  if (status >= 500) return true
  // a missing deployment or route answers with HTML or plain text, the API answers with JSON
  if (status === 404 && !m[2].trim().startsWith('{')) return true
  return false
}

/**
 * Typed API client. Fails fast for 30 s after the server was found unreachable so screens fall
 * back to the chain without waiting on timeouts; `force` skips that shortcut (pull-to-refresh).
 */
export const baoApi = {
  async call<K extends keyof Endpoints>(
    key: K,
    opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
    { timeoutMs = 12_000, force = false }: { timeoutMs?: number; force?: boolean } = {},
  ): Promise<Endpoints[K]['res']> {
    const status = $api.get()
    if (!force && status.state === 'down' && Date.now() - status.checkedAt < RECHECK_MS) throw new ApiUnavailableError()
    try {
      const res = await rawCall(key, opts, timeoutMs)
      $api.set({ state: 'up', checkedAt: Date.now() })
      return res
    } catch (error) {
      if (looksUnavailable(error)) {
        const text = String(error instanceof Error ? error.message : error)
        console.log(`api: ${key} unavailable: ${text.slice(0, 200)}`)
        // a slow endpoint timing out says nothing about the rest of the server
        const slowOnly = /timed out/i.test(text) && key === 'GET /api/users/:address'
        if (!slowOnly) $api.set({ state: 'down', checkedAt: Date.now() })
        throw new ApiUnavailableError()
      }
      $api.set({ state: 'up', checkedAt: Date.now() })
      throw error
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
