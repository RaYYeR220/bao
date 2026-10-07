import type { PacketView } from '@bao/sdk'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Countdown } from '@/ui/countdown'
import { buzz } from '@/ui/feedback'
import { Icon } from '@/ui/icon'
import { T } from '@/ui/text'
import { color, font, radius, space } from '@/ui/tokens'

import { $reminders } from '../data-access/prefs'
import { formatAmount } from '../format'

/** Upcoming public rains: amount, shares and a live countdown; tap to wait at the door. */
export function RainStrip({ rains }: { rains: PacketView[] }) {
  const reminders = useStore($reminders)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {rains.map((r) => (
        <Pressable
          key={r.address}
          accessibilityRole="button"
          accessibilityLabel={`Rain of ${formatAmount(r.total, r.token.decimals)} ${r.token.symbol} for ${r.shares} Seekers`}
          accessibilityHint="Opens the rain"
          onPress={() => {
            buzz('select')
            router.push(`/grab/${r.address}`)
          }}
          style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Icon name="rain" size={20} />
          <View style={{ gap: 2 }}>
            <T variant="capsSmall" style={{ color: color.kin400 }}>
              Rain in
            </T>
            <Countdown to={r.startsAt} variant="bodyStrong" style={styles.cd} done="now" />
          </View>
          <View style={styles.sep} />
          <View style={{ gap: 2 }}>
            <T style={styles.amt}>
              {formatAmount(r.total, r.token.decimals)} <T style={styles.sym}>{r.token.symbol}</T>
            </T>
            <T variant="meta" style={{ fontSize: 12 }}>
              {r.shares} Seekers
            </T>
          </View>
          {reminders[r.address] ? <Icon name="bell" size={16} tone="jade" /> : null}
        </Pressable>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: space[5], gap: 10, paddingTop: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 14,
    paddingRight: 16,
    paddingVertical: 9,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(221,187,122,0.28)',
    backgroundColor: 'rgba(33,24,25,0.7)',
    minHeight: 52,
  },
  cd: { fontFamily: font.numerals, fontSize: 18, lineHeight: 22, color: color.gofun, fontVariant: ['tabular-nums', 'lining-nums'] },
  sep: { width: 1, alignSelf: 'stretch', backgroundColor: color.kuro600 },
  amt: { fontFamily: font.numerals, fontSize: 18, lineHeight: 22, color: color.gofun },
  sym: { fontFamily: font.caps, fontSize: 10, letterSpacing: 1.6, color: color.kin300 },
})
