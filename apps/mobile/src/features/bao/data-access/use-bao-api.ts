import { useStore } from '@nanostores/react'
import { createBaoApi } from '@bao/sdk'
import { useQuery } from '@tanstack/react-query'

import { API_URL } from './bao-config'
import { $session, getToken } from './session-store'

export const baoApi = createBaoApi(API_URL, getToken)

export function useSession() {
  return useStore($session)
}

export function useMe() {
  const session = useSession()
  return useQuery({
    queryKey: ['me', session?.address],
    queryFn: () => baoApi.call('GET /api/me'),
    enabled: !!session,
  })
}

export function useFeed() {
  const session = useSession()
  return useQuery({
    queryKey: ['feed', session?.address ?? null],
    queryFn: () => baoApi.call('GET /api/feed'),
    refetchInterval: 5_000,
  })
}

export function usePacketDetail(address: string | undefined) {
  return useQuery({
    queryKey: ['packet', address],
    queryFn: () => baoApi.call('GET /api/packets/:address', { params: { address: address! } }),
    enabled: !!address,
    refetchInterval: 3_000,
  })
}

export function useCircles() {
  const session = useSession()
  return useQuery({
    queryKey: ['circles', session?.address],
    queryFn: () => baoApi.call('GET /api/circles'),
    enabled: !!session,
  })
}

export function useCircle(id: string | undefined) {
  return useQuery({
    queryKey: ['circle', id],
    queryFn: () => baoApi.call('GET /api/circles/:id', { params: { id: id! } }),
    enabled: !!id,
    refetchInterval: 10_000,
  })
}

export function useUserProfile(address: string | undefined) {
  return useQuery({
    queryKey: ['user', address],
    queryFn: () => baoApi.call('GET /api/users/:address', { params: { address: address! } }),
    enabled: !!address,
  })
}
