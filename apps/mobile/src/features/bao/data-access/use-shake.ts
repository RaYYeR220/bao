import { Accelerometer } from 'expo-sensors'
import { useEffect, useRef } from 'react'

const SHAKE_G = 1.8
const DEBOUNCE_MS = 250

/**
 * Reports each deliberate shake (a spike above 1.8 g, debounced) so the screen can fill the
 * foil ring a third at a time and make the envelope tremble harder with every one.
 */
export function useShakeSteps(enabled: boolean, onStep: () => void) {
  const last = useRef(0)
  const cb = useRef(onStep)
  useEffect(() => {
    cb.current = onStep
  }, [onStep])

  useEffect(() => {
    if (!enabled) return
    Accelerometer.setUpdateInterval(50)
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z)
      if (g < SHAKE_G) return
      const now = Date.now()
      if (now - last.current < DEBOUNCE_MS) return
      last.current = now
      cb.current()
    })
    return () => sub.remove()
  }, [enabled])
}
