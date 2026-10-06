import { useFonts } from 'expo-font'
import { Stack } from 'expo-router/stack'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

import { loadSession } from '@/features/bao/data-access/session-store'
import { Bootstrap } from '@/shell/bootstrap'
import { Providers } from '@/shell/providers'
import { preloadSounds } from '@/ui/feedback'
import { color, fontAssets } from '@/ui/tokens'

void SplashScreen.preventAutoHideAsync().catch(() => undefined)
void loadSession()

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets)
  const ready = fontsLoaded || !!fontError

  useEffect(() => {
    if (!ready) return
    void SplashScreen.hideAsync().catch(() => undefined)
    preloadSounds()
  }, [ready])

  if (!ready) return null

  return (
    <Providers>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.kuro950 },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="grab/[address]" options={{ animation: 'fade_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="send" options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="share/[address]" options={{ animation: 'fade' }} />
        <Stack.Screen name="packet/[address]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="circle/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="join/[code]" options={{ animation: 'fade', presentation: 'transparentModal' }} />
        <Stack.Screen name="scan" options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="preferences" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <Bootstrap />
    </Providers>
  )
}
