import { useEffect } from 'react'
import {
  Easing,
  SensorType,
  useAnimatedSensor,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

/** Heavy, no-bounce ease used for anything that should feel like lacquerware. */
export const weighty = Easing.bezier(0.22, 1, 0.36, 1)
export const hinge = Easing.bezier(0.65, 0, 0.35, 1)

export { useReducedMotion }

/**
 * Where the specular band sits on the lacquer (0..1 along the diagonal). It follows the
 * phone's tilt through the accelerometer, low-passed on the UI thread, with a slow drift
 * so the object never looks dead on a desk. Reduced motion pins it in place.
 */
export function useTiltGleam(base = 0.5): SharedValue<number> {
  const reduced = useReducedMotion()
  const sensor = useAnimatedSensor(SensorType.ACCELEROMETER, { interval: 16 })
  const drift = useSharedValue(0)
  const smooth = useSharedValue(base)

  useEffect(() => {
    if (reduced) return
    drift.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true)
  }, [drift, reduced])

  return useDerivedValue(() => {
    if (reduced) return base
    const { x, y } = sensor.sensor.value
    // Android reports m/s²; tilting left/right moves x, forward/back moves y.
    const tx = Math.max(-1, Math.min(1, x / 9.81))
    const ty = Math.max(-1, Math.min(1, (y - 6.5) / 9.81))
    const target = base - tx * 0.32 + ty * 0.18 + (drift.value - 0.5) * 0.08
    smooth.value += (target - smooth.value) * 0.12
    return smooth.value
  })
}

/** A 0..1 loop for idle shimmer (unsealing), paused under reduced motion. */
export function useLoop(active: boolean, duration = 2800) {
  const t = useSharedValue(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!active || reduced) {
      t.value = 0
      return
    }
    t.value = 0
    t.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false)
  }, [active, duration, reduced, t])
  return t
}
