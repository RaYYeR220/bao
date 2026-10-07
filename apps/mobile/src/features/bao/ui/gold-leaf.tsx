import { Canvas, Picture, Skia, createPicture } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'

interface Flake {
  vx: number
  vy: number
  spin: number
  flutter: number
  phase: number
  w: number
  h: number
  tint: number
  delay: number
}

const TINTS = ['#F6EBD2', '#EBD5A6', '#DDBB7A', '#C9A25C', '#A9823F']

/**
 * Gold-leaf flakes released from the mouth of the envelope: thin foil quads that rise, spin,
 * flutter and settle slowly. No coins. Drawn as one Skia picture per frame.
 */
export function GoldLeafBurst({
  origin,
  fire,
  count = 34,
}: {
  origin: { x: number; y: number }
  fire: number
  count?: number
}) {
  const { width, height } = useWindowDimensions()
  const t = useSharedValue(0)
  const flakes = useMemo<Flake[]>(() => {
    // deterministic per burst, so a re-render never reshuffles the leaf mid-air
    const rnd = (i: number) => {
      const x = Math.sin(i * 12.9898 + fire * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    return Array.from({ length: count }, (_, i) => {
      const k = i * 9
      const angle = -Math.PI / 2 + (rnd(k) - 0.5) * 2.2
      const speed = 380 + rnd(k + 1) * 520
      return {
        vx: Math.cos(angle) * speed * 0.8,
        vy: Math.sin(angle) * speed,
        spin: (rnd(k + 2) - 0.5) * 14,
        flutter: 14 + rnd(k + 3) * 26,
        phase: rnd(k + 4) * Math.PI * 2,
        w: 5 + rnd(k + 5) * 7,
        h: 2.4 + rnd(k + 6) * 3.2,
        tint: Math.floor(rnd(k + 7) * TINTS.length),
        delay: rnd(k + 8) * 0.12,
      }
    })
  }, [count, fire])

  useEffect(() => {
    if (!fire) return
    t.value = 0
    t.value = withTiming(1, { duration: 2200, easing: Easing.linear })
  }, [fire, t])

  const paints = useMemo(
    () =>
      TINTS.map((c) => {
        const p = Skia.Paint()
        p.setColor(Skia.Color(c))
        p.setAntiAlias(true)
        return p
      }),
    [],
  )

  const picture = useDerivedValue(() => {
    const time = t.value * 2.2
    return createPicture((canvas) => {
      if (t.value <= 0 || t.value >= 1) return
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i]
        const s = Math.max(0, time - f.delay)
        if (s <= 0) continue
        // fast rise, air drag, then a slow fall with a side-to-side flutter
        const drag = 1 - Math.exp(-s * 3.2)
        const x = origin.x + (f.vx / 3.2) * drag + Math.sin(s * 5 + f.phase) * f.flutter * Math.min(1, s)
        const y = origin.y + (f.vy / 3.2) * drag + 60 * s * s
        const alpha = Math.max(0, Math.min(1, s * 8)) * Math.max(0, 1 - Math.max(0, s - 1.3) / 0.8)
        if (alpha <= 0) continue
        const paint = paints[f.tint]
        paint.setAlphaf(alpha)
        canvas.save()
        canvas.translate(x, y)
        canvas.rotate((f.spin * s * 180) / Math.PI / 4, 0, 0)
        // the flake turns over as it falls: its visible height breathes
        const hh = f.h * Math.abs(Math.cos(s * 6 + f.phase))
        canvas.drawRect(Skia.XYWHRect(-f.w / 2, -hh / 2, f.w, Math.max(0.6, hh)), paint)
        canvas.restore()
      }
    })
  })

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  )
}
