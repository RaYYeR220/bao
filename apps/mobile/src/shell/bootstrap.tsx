import { focusManager } from '@tanstack/react-query'
import * as QuickActions from 'expo-quick-actions'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { listenToNotificationTaps, registerPush, setupNotifications } from '@/features/bao/data-access/push'
import { refreshWidget } from '@/widget/task-handler'

/** App-wide side effects: notifications, app shortcuts, widget refresh, refetch on foreground. */
export function Bootstrap() {
  useEffect(() => {
    void setupNotifications()
    void registerPush()
    const stopTaps = listenToNotificationTaps()
    void QuickActions.setItems([
      { id: 'send', title: 'Send a packet', params: { href: '/send' } },
      { id: 'scan', title: 'Scan', params: { href: '/scan' } },
    ]).catch(() => undefined)
    void refreshWidget()
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active')
      if (state === 'active') void refreshWidget()
    })
    return () => {
      sub.remove()
      stopTaps()
    }
  }, [])
  return null
}
