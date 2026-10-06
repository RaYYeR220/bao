import { useStore } from '@nanostores/react'
import { createBaoApi, type Endpoints } from '@bao/sdk'
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
const raw = createBaoApi(API_URL, getToken)

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

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms))

/**
 * Typed API client. Fails fast for 30 s after the server was found unreachable so screens fall
 * back to the chain without waiting on timeouts; `force` skips that shortcut (pull-to-refresh).
 */
export const baoApi = {
  async call<K extends keyof Endpoints>(
    key: K,
    opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
    { timeoutMs = 7000, force = false }: { timeoutMs?: number; force?: boolean } = {},
  ): Promise<Endpoints[K]['res']> {
    const status = $api.get()
    if (!force && status.state === 'down' && Date.now() - status.checkedAt < RECHECK_MS) throw new ApiUnavailableError()
    try {
      const res = await Promise.race([raw.call(key, opts), timeout(timeoutMs)])
      $api.set({ state: 'up', checkedAt: Date.now() })
      return res
    } catch (error) {
      if (looksUnavailable(error)) {
        $api.set({ state: 'down', checkedAt: Date.now() })
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
