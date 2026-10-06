import { Skia, type SkPath } from '@shopify/react-native-skia'

import type { EnvelopeTone } from '../tokens'
import { ENV } from './lacquer-shader'

const { W, H, F, A } = ENV

const svg = (d: string) => {
  const p = Skia.Path.MakeFromSVGString(d)
  if (!p) throw new Error(`bad path ${d}`)
  return p
}

const join = (...paths: SkPath[]) => {
  const out = Skia.PathBuilder.Make()
  for (const p of paths) out.addPath(p)
  return out.build()
}

/** Plum branch (梅) in foil line, after v01. */
function plum(): SkPath {
  const branch = svg(
    'M232 396 C206 384 188 370 164 366 C136 361 118 352 96 340 C80 331 66 330 46 334 M164 366 C160 352 166 342 176 334 M118 352 C112 340 116 330 108 322 M96 340 C92 350 84 358 72 362',
  )
  const flowers = Skia.PathBuilder.Make()
  const spots: [number, number][] = [
    [176, 331],
    [108, 320],
    [72, 364],
    [46, 334],
    [200, 378],
    [140, 360],
  ]
  spots.forEach(([x, y], k) => {
    const r = k % 3 ? 3.6 : 4.8
    for (const deg of [0, 72, 144, 216, 288]) {
      const a = ((deg + k * 17) * Math.PI) / 180
      flowers.addCircle(x + r * Math.cos(a), y + r * Math.sin(a), r * 0.62)
    }
  })
  flowers.addCircle(152, 352, 1.8)
  flowers.addCircle(88, 326, 1.5)
  return join(branch, flowers.build())
}

export const plumHearts: [number, number][] = [
  [176, 331],
  [108, 320],
  [72, 364],
  [46, 334],
  [200, 378],
  [140, 360],
]

/** Gold waves (波) for the black lacquer skin. */
function waves(): SkPath {
  const out = Skia.PathBuilder.Make()
  for (let i = 0; i < 4; i++) {
    out.addPath(
      svg(
        `M${-10 + i * 8} ${392 - i * 22} C30 ${360 - i * 22} 60 ${380 - i * 22} 90 ${352 - i * 22} S150 ${360 - i * 22} 240 ${330 - i * 22}`,
      ),
    )
  }
  return out.build()
}

/** Bamboo (竹) for the jade skin: two stalks with nodes and a few leaves. */
function bamboo(): SkPath {
  const stalks = svg('M182 400 Q186 330 197 252 M205 400 Q209 345 216 298 M44 400 Q40 362 30 330')
  const nodes = svg(
    'M180 372 L188 371 M183 336 L191 335 M188 298 L196 297 M192 266 L200 265 M204 368 L212 367 M207 334 L215 333 M37 374 L45 373 M33 350 L41 349',
  )
  const leaf = (x: number, y: number, dx: number, dy: number) => {
    const mx = x + dx * 0.5
    const my = y + dy * 0.5
    const nx = -dy * 0.18
    const ny = dx * 0.18
    return svg(`M${x} ${y} Q${mx + nx} ${my + ny} ${x + dx} ${y + dy} Q${mx - nx} ${my - ny} ${x} ${y} Z`)
  }
  return join(
    stalks,
    nodes,
    leaf(190, 297, -34, -14),
    leaf(190, 297, -28, 8),
    leaf(196, 266, -24, -22),
    leaf(212, 334, -38, -6),
    leaf(212, 334, -30, 14),
    leaf(36, 349, 30, -16),
    leaf(36, 349, 26, 6),
  )
}

const artCache: Partial<Record<EnvelopeTone, SkPath>> = {}
export function artFor(tone: EnvelopeTone): SkPath {
  if (!artCache[tone]) artCache[tone] = tone === 'shu' ? plum() : tone === 'jade' ? bamboo() : waves()
  return artCache[tone]!
}

export const seamPath = svg(`M0 ${F} Q115 ${A} ${W} ${F}`)
export const framePath = Skia.PathBuilder.Make()
  .addRRect(Skia.RRectXY(Skia.XYWHRect(11, 196, W - 22, H - 207), 1.5, 1.5))
  .build()
export const outlinePath = Skia.PathBuilder.Make()
  .addRRect(Skia.RRectXY(Skia.XYWHRect(0.5, 0.5, W - 1, H - 1), 6, 6))
  .build()
export const flapPath = svg(`M0 0 H${W} V${F} Q115 ${A} 0 ${F} Z`)
export const pocketPath = svg(`M0 ${F} Q115 ${A} ${W} ${F} V${H} H0 Z`)

/** Share ticks on the flap's top edge: gold = still in the packet, dark = taken. */
export function tickPaths(total: number, left: number) {
  const n = Math.max(1, Math.min(total, 24))
  const goldCount = total <= 24 ? left : Math.round((left / Math.max(1, total)) * n)
  const gold = Skia.PathBuilder.Make()
  const dark = Skia.PathBuilder.Make()
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? W / 2 : 52 + i * (126 / (n - 1))
    if (i < goldCount) {
      gold.moveTo(x, 14)
      gold.lineTo(x, 24)
    } else {
      dark.moveTo(x, 14)
      dark.lineTo(x, 20)
    }
  }
  return { gold: gold.build(), dark: dark.build() }
}
