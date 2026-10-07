import { focusManager } from '@tanstack/react-query'
import { router, usePathname } from 'expo-router'
import * as QuickActions from 'expo-quick-actions'
import { useEffect, useRef } from 'react'
import { AppState, Linking } from 'react-native'

import { listenToNotificationTaps, registerPush, setupNotifications } from '@/features/bao/data-access/push'
import { hrefFor, parseBaoLink } from '@/features/bao/links'
import { refreshWidget } from '@/widget/task-handler'

/** Launch links already followed by the fallback, for the app's lifetime. */
const followedLaunchLinks = new Set<string>()

/**
 * expo-router reads the link that launched the activity with a 150 ms timeout, then opens the
 * feed. A slow release start misses it, and so does a backgrounded Bao whose activity Android
 * destroyed and re-creates for the link (the warm path, onNewIntent, is a 'url' event the router
 * handles itself). Read the launch link again without the timeout and finish the job if the
 * router is not already there.
 */
function useLaunchLinkFallback() {
  const pathname = usePathname()
  const current = useRef(pathname)
  useEffect(() => {
    current.current = pathname
  }, [pathname])
  useEffect(() => {
    let live = true
    Linking.getInitialURL()
      .then((url) => {
        if (!live || !url || followedLaunchLinks.has(url)) return
        followedLaunchLinks.add(url)
        const link = parseBaoLink(url)
        if (!link) return
        const href = hrefFor(link)
        if (current.current !== href) router.push(href as never)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
}

/** App-wide side effects: launch links, notifications, app shortcuts, widget refresh, refetch on foreground. */
export function Bootstrap() {
  useLaunchLinkFallback()
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
