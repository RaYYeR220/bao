import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { Platform } from 'react-native'

import { hrefFor, isPacketAddress, parseBaoLink } from '@/features/bao/links'
import { color } from '@/ui/tokens'

import { $pushAsked } from './prefs'
import { getToken } from './session-store'
import { baoApi } from './use-bao-api'

/**
 * Android channels, one per group of pushes. The ids must match CHANNELS in apps/web
 * src/lib/push.ts: a push naming a channel the app never made lands in a fallback channel.
 */
const CHANNELS = [
  { id: 'packets', name: 'Packets', description: 'A packet dropped in one of your circles or the public feed' },
  { id: 'rains', name: 'Rains', description: 'A public rain about to start' },
  {
    id: 'results',
    name: 'Your grabs and packets',
    description: 'Your share arrived, your Luck King crown, your packet emptied',
  },
] as const

/**
 * Pushes arrive as data-only FCM messages (title, message, channelId and tag in the data), so
 * the app is the only thing that shows them: expo-notifications draws them itself in the
 * background, and this handler lets them through in the foreground. Exactly one notification
 * per push either way, on its own channel, and a repeat with the same tag replaces it.
 */
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
    await Promise.all(
      CHANNELS.map(({ id, name, description }) =>
        Notifications.setNotificationChannelAsync(id, {
          name,
          description,
          importance: Notifications.AndroidImportance.HIGH,
          lightColor: color.shu400,
          vibrationPattern: [0, 60, 80, 120],
        }).catch(() => undefined),
      ),
    )
  }
}

/** Where a notification should take you: the packet it is about, or its (validated) Bao link. */
export function routeForNotification(data: Record<string, unknown> | undefined) {
  if (!data) return null
  if (isPacketAddress(data.packet)) return `/grab/${data.packet}`
  if (typeof data.url === 'string') {
    const link = parseBaoLink(data.url)
    if (link) return hrefFor(link)
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
