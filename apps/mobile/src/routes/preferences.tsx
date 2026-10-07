import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { requestPinWidget } from 'react-native-android-widget'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { APP_URL } from '@/features/bao/data-access/bao-config'
import { $haptics, $onboarded, $sound, usePref } from '@/features/bao/data-access/prefs'
import { useApiState } from '@/features/bao/data-access/use-bao-api'
import { Backdrop } from '@/ui/backdrop'
import { buzz, play } from '@/ui/feedback'
import { Icon, type IconName } from '@/ui/icon'
import { Hairline, RoundButton, Row } from '@/ui/kit'
import { useReducedMotion } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, space } from '@/ui/tokens'
import { WIDGET_NAME } from '@/widget/task-handler'

export default function Preferences() {
  const insets = useSafeAreaInsets()
  const sound = usePref($sound)
  const haptics = usePref($haptics)
  const reduced = useReducedMotion()
  const api = useApiState()

  return (
    <View style={{ flex: 1 }}>
      <Backdrop glowY={0.1} />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <RoundButton
          icon="back"
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/seeker'))}
        />
        <T variant="caps" style={{ flex: 1, textAlign: 'center' }}>
          Preferences
        </T>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
        <View>
          <Hairline />
          <Switch
            icon="sound"
            label="Sound"
            body="The seal cracking, gold leaf, the Luck King stamp."
            on={sound}
            onChange={(v) => {
              $sound.set(v)
              if (v) play('soft')
            }}
          />
          <Hairline />
          <Switch
            icon="haptic"
            label="Haptics"
            body="A tick for every shake, a thud for the crown."
            on={haptics}
            onChange={(v) => {
              $haptics.set(v)
              if (v) buzz('medium')
            }}
          />
          <Hairline />
          <Row icon="shake" label="Motion" value={reduced ? 'Reduced (system)' : 'Full'} />
          <T variant="meta" style={{ marginLeft: 34, marginTop: -4, marginBottom: 10 }}>
            Follows the system setting: with reduced motion the envelope crossfades instead of hinging open.
          </T>
          <Hairline />
          <Row icon="link" label="Network" value="Solana devnet" />
          <T variant="meta" style={{ marginLeft: 34, marginTop: -4, marginBottom: 10 }}>
            Test tokens only. The program, the Genesis check and the randomness are the real thing.
          </T>
          <Hairline />
          <Row
            icon="info"
            label="Bao server"
            value={api === 'down' ? 'Unreachable' : api === 'up' ? 'Connected' : 'Not checked yet'}
          />
          <T variant="meta" style={{ marginLeft: 34, marginTop: -4, marginBottom: 10 }}>
            {APP_URL.replace(/^https:\/\//, '')} · when it is down, Bao reads straight from the chain.
          </T>
          <Hairline />
          <Row
            icon="box"
            label="Add the home-screen widget"
            value="Packets waiting, next rain"
            onPress={() => void requestPinWidget({ widgetName: WIDGET_NAME }).catch(() => false)}
          />
          <Hairline />
          <Row
            icon="envelope"
            label="Replay the introduction"
            onPress={() => {
              $onboarded.set(false)
              router.replace('/onboarding')
            }}
          />
          <Hairline />
        </View>
        <T variant="meta" style={{ textAlign: 'center' }}>
          Bao {Constants.expoConfig?.version ?? ''} · 紅包
        </T>
      </ScrollView>
    </View>
  )
}

function Switch({
  icon,
  label,
  body,
  on,
  onChange,
}: {
  icon: IconName
  label: string
  body: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Pressable
      onPress={() => onChange(!on)}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={styles.row}
    >
      <Icon name={icon} size={20} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong">{label}</T>
        <T variant="meta">{body}</T>
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10 },
  track: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: color.kuro700,
    padding: 3,
    borderWidth: 1,
    borderColor: color.kuro600,
  },
  trackOn: { backgroundColor: color.jade700, borderColor: color.jade500 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: color.gofun44 },
  knobOn: { backgroundColor: color.jade300, transform: [{ translateX: 20 }] },
})
