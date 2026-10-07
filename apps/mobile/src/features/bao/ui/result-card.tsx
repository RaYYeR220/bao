import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'

import { buzz, play } from '@/ui/feedback'
import { useReducedMotion } from '@/ui/motion'
import { T } from '@/ui/text'
import { color, font } from '@/ui/tokens'

import { formatAmount } from '../format'
import { LuckKingSeal } from './luck-king-seal'

/** Counts a Bodoni amount up from zero with a decelerating ease; ticks a haptic as it lands. */
function CountUp({ amount, decimals, run, size }: { amount: bigint; decimals: number; run: boolean; size: number }) {
  const reduced = useReducedMotion()
  // stays at zero until the card has landed, then counts up to the drawn share
  const [shown, setShown] = useState<bigint>(0n)
  useEffect(() => {
    if (!run || reduced) return
    let raf = 0
    const start = Date.now()
    const dur = 950
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      setShown((amount * BigInt(Math.round(e * 10000))) / 10000n)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [amount, reduced, run])
  const value = run && reduced ? amount : shown
  return (
    <T
      style={{
        fontFamily: font.numerals,
        fontSize: size,
        lineHeight: size * 1.08,
        letterSpacing: -1,
        paddingLeft: 2,
        color: color.kuro950,
        fontVariant: ['tabular-nums', 'lining-nums'],
      }}
      maxFontSizeMultiplier={1}
      numberOfLines={1}
      adjustsFontSizeToFit
      accessibilityLabel={`${formatAmount(amount, decimals)}`}
    >
      {run ? formatAmount(value, decimals) : ' '}
    </T>
  )
}

export interface ResultCardProps {
  width: number
  height: number
  amount: bigint
  decimals: number
  symbol: string
  /** Start the count-up and the stamp (the card has landed). */
  landed: boolean
  isKing: boolean
  headline: string
  detail: string
  postmark: string
  rightAction?: { label: string; onPress: () => void }
  kicker?: string
}

/** Gofun card with a double foil frame: the amount, the rank, the postmark, the 運氣王 stamp. */
export function ResultCard({
  width,
  height,
  amount,
  decimals,
  symbol,
  landed,
  isKing,
  headline,
  detail,
  postmark,
  rightAction,
  kicker = 'You grabbed',
}: ResultCardProps) {
  const k = width / 338
  const reduced = useReducedMotion()
  const stamp = useSharedValue(0)
  useEffect(() => {
    if (!landed || !isKing) return
    if (reduced) {
      stamp.value = 1
      return
    }
    stamp.value = withDelay(
      1050,
      withTiming(1, { duration: 230, easing: Easing.in(Easing.cubic) }, (f) => {
        if (f) stamp.value = withSpring(1, { damping: 8 })
      }),
    )
    const t = setTimeout(() => {
      play('stamp')
      buzz('heavy')
      setTimeout(() => buzz('success'), 140)
    }, 1270)
    return () => clearTimeout(t)
  }, [isKing, landed, reduced, stamp])
  const stampStyle = useAnimatedStyle(() => ({
    opacity: stamp.value > 0.02 ? 1 : 0,
    transform: [{ scale: 1.9 - 0.9 * stamp.value }, { rotate: `${(1 - stamp.value) * -12}deg` }],
  }))

  return (
    <View style={[styles.card, { width, height }]}>
      <View style={styles.frame} pointerEvents="none">
        <View style={styles.frameInner} />
      </View>
      <View style={{ paddingHorizontal: 24 * k, paddingTop: 22 * k, flex: 1 }}>
        <T variant="caps" style={{ color: color.paperInk3, fontSize: 11 }}>
          {kicker}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2, maxWidth: width * 0.86 }}>
          <View style={{ flexShrink: 1 }}>
            <CountUp amount={amount} decimals={decimals} run={landed} size={74 * k} />
          </View>
          <T style={{ fontFamily: font.textSemi, fontSize: 14 * k, letterSpacing: 2, color: color.shu500 }}>
            {symbol.toUpperCase()}
          </T>
        </View>
        <View style={{ maxWidth: width * 0.6, marginTop: 2 }}>
          <T style={{ fontFamily: font.displayItalic, fontSize: 20 * k, lineHeight: 26 * k, color: color.shu500 }}>
            {headline}
          </T>
          <T style={{ fontFamily: font.text, fontSize: 13.5 * k, lineHeight: 18 * k, color: color.paperInk2 }}>
            {detail}
          </T>
        </View>
      </View>
      {isKing ? (
        <Animated.View
          style={[styles.seal, { right: 14 * k, top: height * 0.47, width: 96 * k, height: 96 * k }, stampStyle]}
          pointerEvents="none"
        >
          <LuckKingSeal size={96 * k} />
        </Animated.View>
      ) : null}
      <View style={[styles.post, { paddingHorizontal: 24 * k, paddingBottom: 20 * k }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <Svg width={13} height={13} viewBox="0 0 13 13">
            <Circle cx="6.5" cy="6.5" r="5.6" fill="none" stroke={color.jade500} />
            <Path d="M3.6 6.6 L5.6 8.4 L9.4 4.6" fill="none" stroke={color.jade500} strokeWidth={1.2} />
          </Svg>
          <T variant="capsSmall" style={{ color: color.jade500, fontSize: 10, letterSpacing: 0.9 }} numberOfLines={1}>
            {postmark}
          </T>
        </View>
        {rightAction ? (
          <Pressable
            onPress={() => {
              buzz('select')
              rightAction.onPress()
            }}
            accessibilityRole="button"
            accessibilityLabel={rightAction.label}
            hitSlop={12}
          >
            <T style={{ fontFamily: font.textSemi, fontSize: 13, color: color.shu500 }}>{rightAction.label} →</T>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/** The card before its amount is drawn: blank gofun, foil frame, a quiet 紅包 mark. */
export function SealedCard({ width, height }: { width: number; height: number }) {
  return (
    <View style={[styles.card, { width, height, alignItems: 'center', justifyContent: 'center', gap: 8 }]}>
      <View style={styles.frame} pointerEvents="none">
        <View style={styles.frameInner} />
      </View>
      <T style={{ fontFamily: font.cjk, fontSize: 30, letterSpacing: 10, color: color.shu500, opacity: 0.85 }}>紅包</T>
      <T variant="caps" style={{ color: color.paperInk3 }}>
        Your share is being drawn
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 4,
    overflow: 'hidden',
    experimental_backgroundImage: 'radial-gradient(circle at 30% 20%, #FBF7EF 0%, #F1EADD 70%, #E8DFCE 100%)',
    backgroundColor: '#F1EADD',
    boxShadow: '0px 30px 50px -18px rgba(0,0,0,0.85)',
  },
  frame: {
    position: 'absolute',
    left: 8,
    top: 8,
    right: 8,
    bottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,95,44,0.55)',
    borderRadius: 2,
  },
  frameInner: {
    position: 'absolute',
    left: 3,
    top: 3,
    right: 3,
    bottom: 3,
    borderWidth: 0.6,
    borderColor: 'rgba(127,95,44,0.35)',
  },
  seal: { position: 'absolute' },
  post: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
})
