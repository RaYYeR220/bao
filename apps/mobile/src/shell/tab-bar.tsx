import type { BottomTabBarProps } from 'expo-router/tabs'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { buzz } from '@/ui/feedback'
import { Icon, type IconName } from '@/ui/icon'
import { T } from '@/ui/text'
import { color } from '@/ui/tokens'

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Feed', icon: 'feed' },
  circles: { label: 'Circles', icon: 'circles' },
  box: { label: 'My box', icon: 'box' },
  seeker: { label: 'Seeker', icon: 'seeker' },
}

/** Four foil line pictograms on a lacquer rail; the active one catches the light. */
export function LacquerTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, i) => {
        const tab = TABS[route.name]
        if (!tab) return null
        const focused = state.index === i
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!focused && !event.defaultPrevented) {
                buzz('select')
                navigation.navigate(route.name)
              }
            }}
            style={styles.tab}
          >
            <Icon name={tab.icon} size={24} tone={focused ? 'foil' : 'muted'} />
            <T variant="meta" style={[styles.label, { color: focused ? color.kin300 : color.gofun44 }]}>
              {tab.label}
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(58,46,47,0.8)',
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(15,11,11,0.92), #0B0808)',
  },
  tab: { alignItems: 'center', gap: 6, minWidth: 72, minHeight: 52, justifyContent: 'center' },
  label: { fontSize: 11.5, letterSpacing: 0.4, fontFamily: 'InstrumentSans-Medium' },
})
