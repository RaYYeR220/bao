import { StyleSheet, View } from 'react-native'
import Animated, { type AnimatedStyle } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import type { ViewStyle } from 'react-native'

import { color } from '@/ui/tokens'

/** Three foil arcs beside the envelope that say "it's shaking". */
export function ShakeLines({ side, envW, style }: { side: 'left' | 'right'; envW: number; style?: AnimatedStyle<ViewStyle> }) {
  const flip = side === 'right'
  const h = envW * 0.75
  return (
    <Animated.View style={[styles.lines, { top: envW * 0.45 }, flip ? { right: -48 } : { left: -48 }, style]} pointerEvents="none">
      <Svg width={40} height={h} viewBox="0 0 40 160" preserveAspectRatio="none" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
        {[0, 1, 2].map((i) => (
          <Path
            key={i}
            d={`M${34 - i * 11} ${20 + i * -6} Q${18 - i * 13} 80 ${34 - i * 11} ${140 + i * 6}`}
            stroke={color.kin400}
            strokeWidth={1.1}
            fill="none"
            opacity={0.7 - i * 0.22}
            strokeLinecap="round"
          />
        ))}
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({ lines: { position: 'absolute' } })
