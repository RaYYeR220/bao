import type { PacketView } from '@bao/sdk'
import { StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { EnvelopeFace } from '@/ui/envelope/envelope'
import { tones } from '@/ui/envelope/lacquer-shader'
import { T } from '@/ui/text'
import { font, isSkin, type EnvelopeTone } from '@/ui/tokens'

import { clockTime, formatAmount, sharesLeft } from '../format'

export function toneFor(p: Pick<PacketView, 'skin' | 'status'>): EnvelopeTone {
  if (p.status === 'emptied' || p.status === 'expired' || p.status === 'closed') return 'ash'
  return isSkin(p.skin) ? p.skin : 'shu'
}

/** A packet as a closed lacquer envelope: total in Bodoni, token and shares in foil caps. */
export function PacketEnvelope({
  packet,
  width,
  gleam,
  grabbed,
  label,
}: {
  packet: PacketView
  width: number
  gleam: SharedValue<number>
  /** This phone's share if it already grabbed (base units). */
  grabbed?: string | null
  label?: string
}) {
  const tone = toneFor(packet)
  const spec = tones[tone]
  const s = width / 230
  const amountSize = (packet.total.length > 9 ? 56 : 74) * s
  const spent = tone === 'ash'
  const rainAt = packet.startsAt > Math.floor(Date.now() / 1000) ? packet.startsAt : null
  const sub = grabbed
    ? width < 150
      ? 'OPENED'
      : `YOU GOT ${formatAmount(grabbed, packet.token.decimals)}`
    : spent
      ? packet.status === 'expired'
        ? 'EXPIRED'
        : 'ALL GRABBED'
      : rainAt && width >= 150
        ? `RAIN AT ${clockTime(rainAt)} · ${packet.shares} SHARES`
        : width < 150
        ? packet.token.symbol
        : `${packet.token.symbol} · ${packet.shares} ${packet.shares === 1 ? 'SHARE' : 'SHARES'}`
  return (
    <EnvelopeFace
      width={width}
      tone={tone}
      gleam={gleam}
      ticks={{ total: packet.shares, left: sharesLeft(packet) }}
      sealState={spent || grabbed ? 'cracked' : 'closed'}
    >
      <View style={[styles.face, { top: (212 / 230) * width }]} pointerEvents="none">
        <T
          style={{
            fontFamily: font.numerals,
            fontSize: amountSize,
            lineHeight: amountSize * 1.12,
            letterSpacing: -1,
            color: spec.text,
            fontVariant: ['lining-nums', 'tabular-nums'],
          }}
          maxFontSizeMultiplier={1}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatAmount(packet.total, packet.token.decimals)}
        </T>
        <T
          variant="capsSmall"
          maxFontSizeMultiplier={1.2}
          style={{ color: grabbed ? '#8FC1AE' : spec.sub, fontSize: Math.max(10, 9.5 * s), letterSpacing: 2.6 * s, marginTop: 2 }}
          numberOfLines={1}
        >
          {label ?? sub}
        </T>
      </View>
    </EnvelopeFace>
  )
}

const styles = StyleSheet.create({
  face: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
})
