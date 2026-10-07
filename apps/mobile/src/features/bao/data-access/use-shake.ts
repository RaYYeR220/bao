import { Accelerometer } from 'expo-sensors'
import { useEffect, useRef } from 'react'

import { createShakeDetector } from './shake-detector'

/**
 * Asked-for spacing of accelerometer readings. expo-sensors only throttles with it: the sensor
 * itself runs at SENSOR_DELAY_FASTEST when the app declares HIGH_SAMPLING_RATE_SENSORS
 * (app.json) and at 200 ms otherwise (Android 12+), which is too coarse to catch a shake.
 */
const INTERVAL_MS = 40

/**
 * Reports each deliberate shake (one jolt per shake, see createShakeDetector) so the screen can
 * fill the foil ring a third at a time and make the envelope tremble harder with every one.
 */
export function useShakeSteps(enabled: boolean, onStep: () => void) {
  const cb = useRef(onStep)
  useEffect(() => {
    cb.current = onStep
  }, [onStep])

  useEffect(() => {
    if (!enabled) return
    const isStep = createShakeDetector()
    Accelerometer.setUpdateInterval(INTERVAL_MS)
    const sub = Accelerometer.addListener(({ x, y, z, timestamp }) => {
      if (isStep({ x, y, z, timestamp: timestamp ?? Date.now() / 1000 })) cb.current()
    })
    return () => sub.remove()
  }, [enabled])
}
