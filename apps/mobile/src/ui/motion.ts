import { useEffect } from 'react'
import {
  Easing,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
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
  const sensor = useAnimatedSensor(SensorType.ACCELEROMETER, { interval: 40 })
  const drift = useSharedValue(0)
  const gleam = useSharedValue(base)

  useEffect(() => {
    if (reduced) return
    drift.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true)
  }, [drift, reduced])

  useAnimatedReaction(
    () => (reduced ? null : { x: sensor.sensor.value.x, y: sensor.sensor.value.y, d: drift.value }),
    (v) => {
      if (!v) return
      // Android reports m/s²; tilting left/right moves x, forward/back moves y.
      const tx = Math.max(-1, Math.min(1, v.x / 9.81))
      const ty = Math.max(-1, Math.min(1, (v.y - 6.5) / 9.81))
      const target = base - tx * 0.32 + ty * 0.18 + (v.d - 0.5) * 0.08
      const next = gleam.value + (target - gleam.value) * 0.18
      // skip sub-pixel moves: every write repaints each lacquer canvas on screen
      if (Math.abs(next - gleam.value) > 0.0015) gleam.value = next
    },
    [reduced, base],
  )

  return gleam
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
