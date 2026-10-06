import { useQuickActionRouting } from 'expo-quick-actions/router'
import { Tabs } from 'expo-router/tabs'

import { LacquerTabBar } from '@/shell/tab-bar'
import { color } from '@/ui/tokens'

export default function TabsLayout() {
  // App shortcuts ("Send a packet", "Scan") carry an href; route them once the tabs exist.
  useQuickActionRouting()
  return (
    <Tabs
      tabBar={(props) => <LacquerTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.kuro950 }, animation: 'fade' }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="circles" />
      <Tabs.Screen name="box" />
      <Tabs.Screen name="seeker" />
    </Tabs>
  )
}
