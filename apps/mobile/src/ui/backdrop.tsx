import { StyleSheet, View } from 'react-native'

/**
 * The box interior: warm lacquer black with a soft pool of light where the object sits.
 * Plain view gradients (no canvas), so every screen in the stack can keep one cheaply.
 */
export function Backdrop({ glowY = 0.46, variant = 'feed' }: { glowY?: number; variant?: 'feed' | 'stage' }) {
  const stage = variant === 'stage'
  const y = `${Math.round(glowY * 100)}%`
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: stage
              ? 'linear-gradient(180deg, #0D0909 0%, #0A0707 40%, #050404 100%)'
              : 'linear-gradient(180deg, #120D0D 0%, #0F0B0B 30%, #0B0808 100%)',
          },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: stage
              ? `radial-gradient(circle at 50% ${y}, rgba(38,23,24,0.95) 0%, rgba(22,14,15,0.5) 38%, rgba(10,7,7,0) 70%)`
              : `radial-gradient(circle at 50% ${y}, rgba(36,23,24,1) 0%, rgba(36,23,24,0) 55%)`,
          },
        ]}
      />
    </View>
  )
}
