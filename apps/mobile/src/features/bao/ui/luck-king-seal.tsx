import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Skia,
  Text as SkText,
  useFont,
  vec,
} from '@shopify/react-native-skia'

import { color, foilPositions, foilStops } from '@/ui/tokens'

const crown = Skia.Path.MakeFromSVGString('M30 21 L36 28 L42 19 L48 28 L54 19 L60 28 L66 21')!

/** The red 運氣王 seal: lacquer disc, double foil ring, a hairline crown. */
export function LuckKingSeal({ size = 96 }: { size?: number }) {
  const font = useFont(require('../../../../assets/fonts/NotoSerifTC-Black.ttf'), 20)
  const text = '運氣王'
  const w = font ? font.measureText(text).width : 0
  const k = size / 96
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Group transform={[{ scale: k }, { rotate: (-9 * Math.PI) / 180 }]} origin={vec(48, 48)}>
        <Circle cx={48} cy={50} r={42} color="rgba(80,7,15,0.25)" />
        <Circle cx={48} cy={48} r={42}>
          <RadialGradient
            c={vec(36, 31)}
            r={70}
            colors={['#CF3338', color.shu500, color.shu700]}
            positions={[0, 0.6, 1]}
          />
        </Circle>
        <Circle cx={48} cy={48} r={42} style="stroke" strokeWidth={1.2}>
          <LinearGradient start={vec(6, 6)} end={vec(90, 90)} colors={foilStops} positions={foilPositions} />
        </Circle>
        <Circle cx={48} cy={48} r={37} style="stroke" strokeWidth={0.6}>
          <LinearGradient start={vec(6, 6)} end={vec(90, 90)} colors={foilStops} positions={foilPositions} />
        </Circle>
        <Path path={crown} style="stroke" strokeWidth={1} strokeJoin="round">
          <LinearGradient start={vec(30, 19)} end={vec(66, 28)} colors={foilStops} positions={foilPositions} />
        </Path>
        {font ? <SkText x={48 - w / 2} y={55} text={text} font={font} color={color.gofun} /> : null}
      </Group>
    </Canvas>
  )
}
