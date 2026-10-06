import { Accelerometer } from 'expo-sensors'
import { useEffect, useRef, useState } from 'react'

const SHAKE_G = 1.8
const SHAKES_TO_OPEN = 3
const WINDOW_MS = 1200

/**
 * Detects a deliberate shake: three spikes above 1.8 g within 1.2 s. Reports progress (0..1)
 * so the envelope can tremble harder with every shake before it opens.
 */
export function useShake(enabled: boolean, onShake: () => void) {
  const [progress, setProgress] = useState(0)
  const hits = useRef<number[]>([])
  const fired = useRef(false)

  useEffect(() => {
    if (!enabled) {
      hits.current = []
      fired.current = false
      setProgress(0)
      return
    }
    Accelerometer.setUpdateInterval(50)
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z)
      if (g < SHAKE_G || fired.current) return
      const now = Date.now()
      if (hits.current.length && now - hits.current[hits.current.length - 1] < 150) return
      hits.current = [...hits.current.filter((t) => now - t < WINDOW_MS), now]
      setProgress(Math.min(1, hits.current.length / SHAKES_TO_OPEN))
      if (hits.current.length >= SHAKES_TO_OPEN) {
        fired.current = true
        onShake()
      }
    })
    return () => sub.remove()
  }, [enabled, onShake])

  return progress
}
