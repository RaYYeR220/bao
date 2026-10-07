import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { Platform } from 'react-native'

import { color } from '@/ui/tokens'

import { $pushAsked } from './prefs'
import { getToken } from './session-store'
import { baoApi } from './use-bao-api'

export async function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('packets', {
      name: 'Packets and rains',
      description: 'A packet dropped in your circle, a rain starting, your Luck King crown',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: color.shu400,
      vibrationPattern: [0, 60, 80, 120],
    }).catch(() => undefined)
  }
}

/** Where a notification should take you: its deep link, or the packet it is about. */
export function routeForNotification(data: Record<string, unknown> | undefined) {
  if (!data) return null
  if (typeof data.packet === 'string') return `/grab/${data.packet}`
  if (typeof data.url === 'string') {
    const m = /(?:packet|p)\/([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(data.url)
    if (m) return `/grab/${m[1]}`
    const j = /join\/([A-Za-z0-9_-]+)/.exec(data.url)
    if (j) return `/join/${j[1]}`
  }
  return null
}

export function listenToNotificationTaps() {
  const open = (r: Notifications.NotificationResponse | null) => {
    const href = routeForNotification(r?.notification.request.content.data as Record<string, unknown> | undefined)
    if (href) router.push(href as never)
  }
  void Notifications.getLastNotificationResponseAsync()
    .then(open)
    .catch(() => undefined)
  const sub = Notifications.addNotificationResponseReceivedListener(open)
  return () => sub.remove()
}

/** Registers this phone's FCM token with the API. Silent if Firebase is not configured yet. */
export async function registerPush() {
  if (!getToken()) return
  try {
    const { data } = await Notifications.getDevicePushTokenAsync()
    await baoApi.call('POST /api/push/register', { body: { fcmToken: String(data) } })
  } catch (e) {
    if (__DEV__) console.log('push: not registered: %s', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Asks for notification permission once, at a moment that explains itself (after the first
 * grab, or on joining a circle), never at launch.
 */
export async function maybeAskForPush() {
  if ($pushAsked.get()) {
    const current = await Notifications.getPermissionsAsync().catch(() => null)
    if (current?.granted) await registerPush()
    return
  }
  $pushAsked.set(true)
  const res = await Notifications.requestPermissionsAsync().catch(() => null)
  if (res?.granted) await registerPush()
}
