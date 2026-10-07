import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  Text as SkText,
  useFont,
  useTexture,
  vec,
  type Uniforms,
} from '@shopify/react-native-skia'
import { useMemo, type ReactNode } from 'react'
import { PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { color, foilPositions, foilStops, type EnvelopeTone } from '../tokens'
import { artFor, flapPath, framePath, outlinePath, pocketPath, seamPath, tickPaths } from './foil-art'
import { ENV, SEAM_Y, lacquerEffect, toneUniforms, tones } from './lacquer-shader'

const { W, H, A } = ENV
export const ENVELOPE_RATIO = H / W

/** Lacquer part: 0 closed · 1 pocket · 2 flap front · 3 flap lining · 4 interior. */
export type LacquerPart = 0 | 1 | 2 | 3 | 4

const FoilGradient = ({ horizontal = false, opacity = 1 }: { horizontal?: boolean; opacity?: number }) => (
  <LinearGradient
    start={vec(0, 0)}
    end={horizontal ? vec(W, 0) : vec(W, H)}
    colors={opacity < 1 ? foilStops.map((c) => withAlpha(c, opacity)) : foilStops}
    positions={foilPositions}
  />
)

const clamp01 = (v: number) => {
  'worklet'
  return Math.max(0, Math.min(1, v))
}

const withAlpha = (hex: string, a: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`

export interface LacquerProps {
  width: number
  tone: EnvelopeTone
  part: LacquerPart
  gleam: SharedValue<number>
  gleamA?: number
  /** 0..1 strength of the waiting shimmer; `time` drives it. */
  shimmer?: SharedValue<number>
  time?: SharedValue<number>
  ticks?: { total: number; left: number }
  /** Draw only the top `heightUnits` of the envelope (flap canvases). */
  heightUnits?: number
  art?: boolean
  /** Draw the shader every frame instead of baking it (layers that hinge and transform). */
  live?: boolean
  style?: StyleProp<ViewStyle>
}

/** One lacquer layer: baked into a texture for static faces, drawn live for the hinged grab layers. */
export function Lacquer(props: LacquerProps) {
  return props.live ? <LiveLacquer {...props} /> : <BakedLacquer {...props} />
}

function LiveLacquer({
  width,
  tone,
  part,
  gleam,
  gleamA = 0.26,
  shimmer,
  time,
  ticks,
  heightUnits = H,
  art = true,
  style,
}: LacquerProps) {
  const s = width / W
  const base = useMemo(() => toneUniforms(tone), [tone])
  const uniforms = useDerivedValue<Uniforms>(() => ({
    ...base,
    u_scale: s,
    u_gleam: gleam.value,
    u_gleamA: gleamA,
    u_part: part,
    u_shimmer: shimmer ? shimmer.value : 0,
    u_time: time ? time.value * 2.8 : 0,
  }))
  return (
    <Canvas style={[{ width, height: heightUnits * s }, style]} pointerEvents="none">
      <LacquerArt tone={tone} part={part} scale={s} ticks={ticks} art={art} uniforms={uniforms} />
    </Canvas>
  )
}

/**
 * One lacquer layer of the envelope. The urushi shader, deboss, grain and foil linework are
 * baked once into a texture; each frame only the specular band (and the waiting shimmer) is
 * drawn over it, so tilting the phone costs two gradients rather than a full shader pass.
 */
function BakedLacquer({
  width,
  tone,
  part,
  gleam,
  gleamA = 0.26,
  shimmer,
  time,
  ticks,
  heightUnits = H,
  art = true,
  style,
}: LacquerProps) {
  const s = width / W
  const height = heightUnits * s
  const pr = PixelRatio.get()
  const tickKey = ticks ? `${ticks.total}:${ticks.left}` : ''
  const size = useMemo(() => ({ width: Math.ceil(width * pr), height: Math.ceil(height * pr) }), [width, height, pr])

  const texture = useTexture(<LacquerArt tone={tone} part={part} scale={s * pr} ticks={ticks} art={art} />, size, [
    tone,
    part,
    s,
    pr,
    tickKey,
    art,
    size,
  ])

  const clip = part === 1 ? pocketPath : part === 2 ? flapPath : outlinePath
  const strength = part >= 3 ? 0.35 : 1
  const glossColors = useMemo(
    () => [
      'rgba(255,255,255,0)',
      `rgba(255,233,224,${0.1 * strength})`,
      `rgba(255,246,238,${gleamA * strength})`,
      `rgba(255,233,224,${0.08 * strength})`,
      'rgba(255,255,255,0)',
    ],
    [gleamA, strength],
  )
  const glossPositions = useDerivedValue(() => {
    const g = gleam.value
    return [clamp01(g - 0.2), clamp01(g - 0.05), clamp01(g), clamp01(g + 0.035), clamp01(g + 0.16)]
  })
  const shimmerPositions = useDerivedValue(() => {
    const t = time ? time.value : 0
    const centre = ((t * 0.98) % 1) * 1.6 - 0.3
    return [clamp01(centre - 0.09), clamp01(centre), clamp01(centre + 0.09)]
  })
  const shimmerColors = useDerivedValue(() => {
    const a = (shimmer ? shimmer.value : 0) * 0.22 * strength
    return ['rgba(255,240,230,0)', `rgba(255,240,230,${a})`, 'rgba(255,240,230,0)']
  })

  return (
    <Canvas style={[{ width, height }, style]} pointerEvents="none">
      <Image image={texture} x={0} y={0} width={width} height={height} fit="fill" />
      <Group transform={[{ scale: s }]} clip={clip}>
        <Rect x={0} y={0} width={W} height={H} blendMode="screen">
          <LinearGradient start={vec(0, 0)} end={vec(W, H)} colors={glossColors} positions={glossPositions} />
        </Rect>
        {shimmer ? (
          <Rect x={0} y={0} width={W} height={H} blendMode="screen">
            <LinearGradient start={vec(0, 0)} end={vec(W, H)} colors={shimmerColors} positions={shimmerPositions} />
          </Rect>
        ) : null}
      </Group>
    </Canvas>
  )
}

/** The static part of a lacquer layer, rendered once into a texture. */
function LacquerArt({
  tone,
  part,
  scale,
  ticks,
  art,
  uniforms,
}: {
  tone: EnvelopeTone
  part: LacquerPart
  scale: number
  ticks?: { total: number; left: number }
  art: boolean
  uniforms?: SharedValue<Uniforms>
}) {
  const spec = tones[tone]
  const staticUniforms = {
    ...toneUniforms(tone),
    u_scale: scale,
    u_gleam: -5,
    u_gleamA: 0,
    u_part: part,
    u_shimmer: 0,
    u_time: 0,
  }
  const tickSet = ticks ? tickPaths(ticks.total, ticks.left) : null
  const showPocketArt = part === 0 || part === 1
  const showFlapArt = part === 0 || part === 2
  const foilA = spec.foilOpacity
  return (
    <Group transform={[{ scale }]}>
      <RoundedRect x={0} y={0} width={W} height={H} r={6}>
        <Shader source={lacquerEffect!} uniforms={uniforms ?? staticUniforms} />
      </RoundedRect>
      {showPocketArt && art ? (
        <>
          <Path
            path={artFor(tone)}
            style="stroke"
            strokeWidth={0.9}
            strokeCap="round"
            opacity={tone === 'ash' ? 0.35 : 0.85}
          >
            <FoilGradient />
          </Path>
          <Path path={framePath} style="stroke" strokeWidth={0.7} opacity={tone === 'ash' ? 0.25 : 0.55}>
            <FoilGradient />
          </Path>
        </>
      ) : null}
      {showFlapArt ? (
        <>
          <Path path={seamPath} style="stroke" strokeWidth={1.1} opacity={foilA}>
            <FoilGradient horizontal />
          </Path>
          {tickSet ? (
            <>
              <Path path={tickSet.gold} style="stroke" strokeWidth={1.2} color={color.kin300} opacity={foilA} />
              <Path path={tickSet.dark} style="stroke" strokeWidth={1} color="rgba(0,0,0,0.4)" />
            </>
          ) : null}
        </>
      ) : null}
      {part === 3 ? (
        <Path path={liningEdge} style="stroke" strokeWidth={0.7} opacity={0.5}>
          <FoilGradient horizontal />
        </Path>
      ) : null}
      {part !== 4 && part !== 3 ? (
        <Path path={outlinePath} style="stroke" strokeWidth={1} color="rgba(255,205,195,0.16)" />
      ) : null}
    </Group>
  )
}

const liningEdge = (() => {
  const p = Skia.Path.MakeFromSVGString(`M8 8 H${W - 8} V${ENV.F - 4} Q115 ${A - 8} 8 ${ENV.F - 4} Z`)!
  return p
})()

/** The round 開 seal with an optional foil progress ring for the shake. */
export function Seal({
  size,
  ring,
  cracked = false,
  muted = false,
  glyph = '開',
}: {
  /** Diameter of the seal disc in dp. */
  size: number
  ring?: SharedValue<number>
  cracked?: boolean
  muted?: boolean
  glyph?: string
}) {
  // Work in a 100-unit box: disc r=31, ring r=38 (v01 proportions), padding for the shadow.
  const box = size * (100 / 62)
  const k = box / 100
  const font = useFont(require('../../../assets/fonts/NotoSerifTC-SemiBold.ttf'), 29)
  const glyphW = font ? font.measureText(glyph).width : 0
  const ringEnd = useDerivedValue(() => (ring ? ring.value : 0))
  const nodes = [0, 1, 2].map((i) => {
    const a = ((-90 + i * 120) * Math.PI) / 180
    return { x: 50 + 38 * Math.cos(a), y: 50 + 38 * Math.sin(a), i }
  })

  return (
    <Canvas style={{ width: box, height: box }} pointerEvents="none">
      <Group transform={[{ scale: k }]}>
        {ring ? (
          <>
            <Circle cx={50} cy={50} r={38} style="stroke" strokeWidth={1} color="rgba(235,213,166,0.16)" />
            <Path path={ringPath} style="stroke" strokeWidth={2.4} strokeCap="round" start={0} end={ringEnd}>
              <LinearGradient start={vec(0, 0)} end={vec(100, 100)} colors={foilStops} positions={foilPositions} />
            </Path>
            {nodes.map((n) => (
              <RingNode key={n.i} x={n.x} y={n.y} threshold={(n.i + 1) / 3 - 0.01} progress={ringEnd} />
            ))}
          </>
        ) : null}
        {cracked ? (
          <Group>
            <Path
              path={halfLeft}
              color={muted ? '#4A4241' : color.shu800}
              transform={[{ translateX: -5 }, { translateY: 3 }]}
            />
            <Path
              path={halfRight}
              color={muted ? '#4A4241' : color.shu800}
              transform={[{ translateX: 6 }, { translateY: 6 }]}
            />
          </Group>
        ) : (
          <>
            <Circle cx={50} cy={53} r={32} color="rgba(0,0,0,0.45)">
              <BlurMask blur={3.2} style="normal" />
            </Circle>
            <Circle cx={50} cy={50} r={31}>
              <RadialGradient
                c={vec(44, 42)}
                r={44}
                colors={muted ? ['#6B6362', '#4A4241', '#2E2928'] : ['#7A2024', '#50070F', '#320509']}
                positions={[0, 0.7, 1]}
              />
            </Circle>
            <Circle cx={50} cy={50} r={31} style="stroke" strokeWidth={1.3}>
              <LinearGradient start={vec(19, 19)} end={vec(81, 81)} colors={foilStops} positions={foilPositions} />
            </Circle>
            <Circle cx={50} cy={50} r={26.5} style="stroke" strokeWidth={0.6} opacity={0.8}>
              <LinearGradient start={vec(19, 19)} end={vec(81, 81)} colors={foilStops} positions={foilPositions} />
            </Circle>
            {font ? (
              <SkText x={50 - glyphW / 2} y={60.5} text={glyph} font={font}>
                <LinearGradient start={vec(36, 36)} end={vec(64, 64)} colors={foilStops} positions={foilPositions} />
              </SkText>
            ) : null}
          </>
        )}
      </Group>
    </Canvas>
  )
}

function RingNode({
  x,
  y,
  threshold,
  progress,
}: {
  x: number
  y: number
  threshold: number
  progress: SharedValue<number>
}) {
  const fill = useDerivedValue(() => (progress.value >= threshold ? color.kin200 : color.kuro700))
  return (
    <>
      <Circle cx={x} cy={y} r={2.6} color={fill} />
      <Circle cx={x} cy={y} r={2.6} style="stroke" strokeWidth={0.7} color={color.kin400} />
    </>
  )
}

// starts at 12 o'clock, clockwise
const ringPath = Skia.PathBuilder.Make()
  .addArc(Skia.XYWHRect(12, 12, 76, 76), -90, 359.9)
  .build()

const halfLeft = Skia.Path.MakeFromSVGString('M50 19 a31 31 0 0 0 0 62 l4 -14 -6 -9 5 -12 -5 -11 z')!
const halfRight = Skia.Path.MakeFromSVGString('M50 19 a31 31 0 0 1 0 62 l4 -14 -6 -9 5 -12 -5 -11 z')!

/** Seal centre within the envelope, in dp, for a given envelope width. */
export const sealCenter = (width: number) => ({ x: width / 2, y: (SEAM_Y / W) * width })
export const sealSize = (width: number) => (62 / W) * width

/**
 * The closed envelope as one object: lacquer, foil art, seal, plus whatever text the
 * caller lays over the face (amount, labels). Used by the feed, share, send and onboarding.
 */
export function EnvelopeFace({
  width,
  tone,
  gleam,
  gleamA,
  ticks,
  sealState = 'closed',
  ring,
  children,
  style,
}: {
  width: number
  tone: EnvelopeTone
  gleam: SharedValue<number>
  gleamA?: number
  ticks?: { total: number; left: number }
  sealState?: 'closed' | 'cracked' | 'none'
  ring?: SharedValue<number>
  children?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const height = width * ENVELOPE_RATIO
  const c = sealCenter(width)
  const box = sealSize(width) * (100 / 62)
  return (
    <View style={[{ width, height }, style]}>
      <View style={[styles.shadow, { width, height, borderRadius: (6 * width) / W }]} />
      <Lacquer width={width} tone={tone} part={0} gleam={gleam} gleamA={gleamA} ticks={ticks} />
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
      </View>
      {sealState !== 'none' ? (
        <View style={{ position: 'absolute', left: c.x - box / 2, top: c.y - box / 2 }} pointerEvents="none">
          <Seal size={sealSize(width)} ring={ring} cracked={sealState === 'cracked'} muted={tone === 'ash'} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    boxShadow: '0px 24px 36px -14px rgba(0,0,0,0.9)',
  },
})
