import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia'
import { useEffect, useRef, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { Lacquer, Seal, sealCenter, sealSize } from '@/ui/envelope/envelope'
import { ENV } from '@/ui/envelope/lacquer-shader'
import { buzz, play } from '@/ui/feedback'
import { hinge, useReducedMotion, weighty } from '@/ui/motion'
import { color, type EnvelopeTone } from '@/ui/tokens'

import { ShakeLines } from './shake-lines'

export type StageMode = 'sealed' | 'peek' | 'out' | 'static-out' | 'refused'

export interface StageGeometry {
  screenW: number
  envW: number
  /** Top of the sealed envelope. */
  sealedTop: number
  /** Final card frame (screen coordinates). */
  card: { left: number; top: number; width: number; height: number }
}

const CARD_RATIO = 0.7

export function stageGeometry(screenW: number, screenH: number, headerBottom: number): StageGeometry {
  // Fit the opened object (flap up) plus the card under it on one screen.
  const envW = Math.min(screenW * 0.6, ((screenH - headerBottom - 230) / ENV.H) * ENV.W)
  const envH = (envW * ENV.H) / ENV.W
  const flapH = (ENV.F / ENV.W) * envW
  const cardW = screenW - 48
  const cardH = cardW * CARD_RATIO
  const cardTop = headerBottom + 0.58 * (flapH + envH) - 30
  return { screenW, envW, sealedTop: headerBottom + 6, card: { left: 24, top: cardTop, width: cardW, height: cardH } }
}

const halfL = Skia.Path.MakeFromSVGString('M50 19 a31 31 0 0 0 0 62 l4 -14 -6 -9 5 -12 -5 -11 z')!
const halfR = Skia.Path.MakeFromSVGString('M50 19 a31 31 0 0 1 0 62 l4 -14 -6 -9 5 -12 -5 -11 z')!

/**
 * The grab's single object, in layers: interior, card, pocket, hinged flap, seal. Modes drive a
 * fixed choreography: crack → flap hinges open (rotateX −170°, perspective) → card peeks while
 * the proof is pending → card slides out, the object steps back and the card comes forward.
 */
export function GrabStage({
  geo,
  tone,
  gleam,
  ring,
  ticks,
  mode,
  face,
  renderCard,
  shimmer,
  time,
  trembleKey,
  onSealPress,
  sealLabel,
  onSettled,
}: {
  geo: StageGeometry
  tone: EnvelopeTone
  gleam: SharedValue<number>
  ring: SharedValue<number>
  ticks?: { total: number; left: number }
  mode: StageMode
  face?: ReactNode
  /** The result card, drawn twice: inside the envelope while it rises, then in front. */
  renderCard?: (where: 'inside' | 'front') => ReactNode
  shimmer: SharedValue<number>
  time: SharedValue<number>
  trembleKey: number
  onSealPress?: () => void
  sealLabel?: string
  onSettled?: () => void
}) {
  const reduced = useReducedMotion()
  const { envW, sealedTop, card: cf, screenW } = geo
  const s = envW / ENV.W
  const envH = ENV.H * s
  const flapH = ENV.A * s
  const envLeft = (screenW - envW) / 2
  const dOpen = ENV.F * s * 0.55

  const crack = useSharedValue(0)
  const flap = useSharedValue(0)
  const shift = useSharedValue(0)
  const cardY = useSharedValue(0)
  const settle = useSharedValue(0)
  const swapped = useSharedValue(0)
  const tremble = useSharedValue(0)
  const deny = useSharedValue(0)
  const lines = useSharedValue(0)
  const prevMode = useRef<StageMode>(mode)
  const settledCb = useRef(onSettled)
  useEffect(() => {
    settledCb.current = onSettled
  }, [onSettled])

  // card inside the envelope (unscaled, relative to the envelope box)
  const inW = envW * 0.84
  const k0 = inW / cf.width
  const inH = cf.height * k0
  const inLeft = (envW - inW) / 2
  const hiddenTop = (ENV.A - 22) * s
  const peekTop = ENV.F * s - inH * 0.46
  const outTop = -inH - 10 * s

  // envelope at rest when the card comes forward
  const envScaleF = 0.52
  const envTranslateF = cf.top + 34 - (sealedTop + dOpen + envH / 2 + (envScaleF * envH) / 2)

  function settled() {
    settledCb.current?.()
  }

  // tremble on every shake step: harder with each one
  useEffect(() => {
    if (!trembleKey || reduced) return
    const amp = 1.5 + Math.min(3, trembleKey) * 1.4
    tremble.value = withSequence(
      withTiming(amp, { duration: 55 }),
      withTiming(-amp, { duration: 75 }),
      withTiming(amp * 0.6, { duration: 70 }),
      withTiming(-amp * 0.3, { duration: 70 }),
      withTiming(0, { duration: 90 }),
    )
    lines.value = withSequence(withTiming(1, { duration: 80 }), withDelay(260, withTiming(0, { duration: 420 })))
  }, [trembleKey, reduced, tremble, lines])

  useEffect(() => {
    const from = prevMode.current
    prevMode.current = mode
    const openSeal = (after: () => void) => {
      if (flap.value > 0.99) return after()
      play('crack')
      buzz('heavy')
      if (reduced) {
        crack.value = withTiming(1, { duration: 200 })
        flap.value = withTiming(1, { duration: 250 })
        shift.value = withTiming(1, { duration: 250 }, (f) => {
          if (f) runOnJS(after)()
        })
        return
      }
      crack.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.quad) })
      shift.value = withDelay(80, withTiming(1, { duration: 700, easing: weighty }))
      flap.value = withDelay(
        140,
        withTiming(1, { duration: 760, easing: hinge }, (f) => {
          if (f) runOnJS(after)()
        }),
      )
    }

    if (mode === 'sealed') {
      crack.value = 0
      flap.value = 0
      shift.value = 0
      cardY.value = 0
      settle.value = 0
      swapped.value = 0
    } else if (mode === 'refused') {
      deny.value = reduced
        ? 0
        : withSequence(
            withTiming(-10, { duration: 70 }),
            withTiming(9, { duration: 90 }),
            withTiming(-6, { duration: 90 }),
            withTiming(3, { duration: 90 }),
            withTiming(0, { duration: 120 }),
          )
    } else if (mode === 'peek') {
      openSeal(() => {
        play('slide')
        cardY.value = withTiming(0.46, { duration: reduced ? 200 : 800, easing: weighty })
      })
    } else if (mode === 'out') {
      const rise = () => {
        play('slide')
        cardY.value = withTiming(1, { duration: reduced ? 150 : 520, easing: Easing.out(Easing.cubic) }, (f) => {
          if (!f) return
          swapped.value = 1
          settle.value = withTiming(1, { duration: reduced ? 200 : 820, easing: weighty }, (g) => {
            if (g) runOnJS(settled)()
          })
        })
      }
      openSeal(() => (from === 'peek' ? rise() : setTimeout(rise, reduced ? 0 : 120)))
    } else if (mode === 'static-out') {
      crack.value = 1
      flap.value = 1
      shift.value = 1
      cardY.value = 1
      swapped.value = 1
      settle.value = withTiming(1, { duration: 1 }, (f) => {
        if (f) runOnJS(settled)()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const envStyle = useAnimatedStyle(() => {
    const sc = interpolate(settle.value, [0, 1], [1, envScaleF])
    const ty = shift.value * dOpen + settle.value * (envTranslateF - 0)
    return {
      transform: [
        { translateX: deny.value },
        { translateY: ty },
        { scale: sc },
        { rotate: `${tremble.value - 2.5 * (1 - shift.value)}deg` },
      ],
      opacity: 1 - settle.value * 0.12,
    }
  })

  const flapTransform = () => {
    'worklet'
    return reduced
      ? [{ scaleY: interpolate(flap.value, [0, 0.5, 1], [1, 0.02, -0.78]) }]
      : [{ perspective: 900 }, { rotateX: `${-170 * flap.value}deg` }]
  }
  const flapFrontStyle = useAnimatedStyle(() => ({
    opacity: flap.value < 0.5 ? 1 : 0,
    transform: flapTransform(),
  }))
  const flapBackStyle = useAnimatedStyle(() => ({
    opacity: flap.value >= 0.5 ? 1 : 0,
    transform: flapTransform(),
  }))
  const faceStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, flap.value * 2.5) }))

  const sealStyle = useAnimatedStyle(() => ({
    opacity: crack.value > 0.02 ? 0 : 1,
    transform: [{ scale: 1 + (crack.value > 0 ? 0 : 0) }],
  }))
  const halfLStyle = useAnimatedStyle(() => ({
    opacity: crack.value <= 0.01 ? 0 : 1 - Math.max(0, crack.value - 0.55) / 0.45,
    transform: [
      { translateX: -crack.value * 28 },
      { translateY: crack.value * crack.value * 180 },
      { rotate: `${-crack.value * 38}deg` },
    ],
  }))
  const halfRStyle = useAnimatedStyle(() => ({
    opacity: crack.value <= 0.01 ? 0 : 1 - Math.max(0, crack.value - 0.55) / 0.45,
    transform: [
      { translateX: crack.value * 32 },
      { translateY: crack.value * crack.value * 200 },
      { rotate: `${crack.value * 44}deg` },
    ],
  }))

  const inCardStyle = useAnimatedStyle(() => {
    const top = interpolate(cardY.value, [0, 0.46, 1], [hiddenTop, peekTop, outTop])
    return {
      opacity: swapped.value ? 0 : cardY.value > 0.01 ? 1 : 0,
      transform: [
        { translateX: inLeft - (cf.width - inW) / 2 },
        { translateY: top - (cf.height - inH) / 2 },
        { scale: k0 },
      ],
    }
  })

  // the card in front: starts exactly where the inside card left off, ends in its final frame
  const startCx = envLeft + envW / 2
  const startCy = sealedTop + dOpen + outTop + inH / 2
  const endCx = cf.left + cf.width / 2
  const endCy = cf.top + cf.height / 2
  const frontStyle = useAnimatedStyle(() => {
    const t = settle.value
    return {
      opacity: swapped.value ? 1 : 0,
      transform: [
        { translateX: (startCx - endCx) * (1 - t) },
        { translateY: (startCy - endCy) * (1 - t) - Math.sin(t * Math.PI) * 18 },
        { scale: k0 + (1 - k0) * t },
        { rotate: `${-1.6 * t}deg` },
      ],
    }
  })

  const linesL = useAnimatedStyle(() => ({ opacity: lines.value, transform: [{ translateX: -lines.value * 4 }] }))
  const linesR = useAnimatedStyle(() => ({ opacity: lines.value, transform: [{ translateX: lines.value * 4 }] }))

  const sc = sealCenter(envW)
  const box = sealSize(envW) * (100 / 62)

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[{ position: 'absolute', left: envLeft, top: sealedTop, width: envW, height: envH }, envStyle]}
      >
        <View style={[styles.shadow, { width: envW, height: envH }]} />
        <Lacquer width={envW} tone={tone} part={4} gleam={gleam} style={StyleSheet.absoluteFill} art={false} />
        {/* flap lining: behind the card once the lid is past vertical */}
        <Animated.View style={[styles.flap, { width: envW, height: flapH }, flapBackStyle]}>
          <Lacquer width={envW} tone={tone} part={3} gleam={gleam} heightUnits={ENV.A} />
        </Animated.View>
        <Animated.View
          style={[styles.cardBox, { width: cf.width, height: cf.height }, inCardStyle]}
          pointerEvents="none"
        >
          {renderCard?.('inside')}
        </Animated.View>
        <Lacquer
          width={envW}
          tone={tone}
          part={1}
          gleam={gleam}
          shimmer={shimmer}
          time={time}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[StyleSheet.absoluteFill, faceStyle]} pointerEvents="none">
          {face}
        </Animated.View>
        <Animated.View style={[styles.flap, { width: envW, height: flapH }, flapFrontStyle]}>
          <Lacquer
            width={envW}
            tone={tone}
            part={2}
            gleam={gleam}
            ticks={ticks}
            heightUnits={ENV.A}
            shimmer={shimmer}
            time={time}
          />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: sc.x - box / 2, top: sc.y - box / 2 }, sealStyle]}>
          <Pressable
            onPress={onSealPress}
            disabled={!onSealPress}
            accessibilityRole="button"
            accessibilityLabel={sealLabel ?? 'The seal'}
            accessibilityHint="Shake the phone three times, or tap the seal three times, to open"
            hitSlop={10}
          >
            <Seal size={sealSize(envW)} ring={ring} muted={tone === 'ash'} />
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[{ position: 'absolute', left: sc.x - box / 2, top: sc.y - box / 2 }, halfLStyle]}
          pointerEvents="none"
        >
          <SealHalf box={box} path={halfL} />
        </Animated.View>
        <Animated.View
          style={[{ position: 'absolute', left: sc.x - box / 2, top: sc.y - box / 2 }, halfRStyle]}
          pointerEvents="none"
        >
          <SealHalf box={box} path={halfR} />
        </Animated.View>
        <ShakeLines side="left" envW={envW} style={linesL} />
        <ShakeLines side="right" envW={envW} style={linesR} />
      </Animated.View>
      <Animated.View
        style={[styles.cardBox, { left: cf.left, top: cf.top, width: cf.width, height: cf.height }, frontStyle]}
        pointerEvents="box-none"
      >
        {renderCard?.('front')}
      </Animated.View>
    </View>
  )
}

function SealHalf({ box, path }: { box: number; path: ReturnType<typeof Skia.Path.MakeFromSVGString> & object }) {
  return (
    <Canvas style={{ width: box, height: box }}>
      <Group transform={[{ scale: box / 100 }]}>
        <Path path={path} color={color.shu800} />
        <Path path={path} color={color.kin500} style="stroke" strokeWidth={0.8} />
      </Group>
    </Canvas>
  )
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', left: 0, top: 0, borderRadius: 6, boxShadow: '0px 30px 40px -16px rgba(0,0,0,0.9)' },
  flap: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top' },
  cardBox: { position: 'absolute', left: 0, top: 0 },
})
