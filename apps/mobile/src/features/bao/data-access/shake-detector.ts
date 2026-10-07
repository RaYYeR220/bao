/** One accelerometer reading: acceleration in g, sensor time in seconds. */
export interface Motion {
  x: number
  y: number
  z: number
  timestamp: number
}

export interface ShakeTuning {
  /** Change of acceleration between two readings that reads as a jolt (any direction, in g). */
  joltG: number
  /** A raw reading this strong also counts (a flick sampled right at its peak, in g). */
  spikeG: number
  /** Jolts closer together than this belong to the same shake (seconds). */
  stepGapS: number
  /** Readings further apart than this are not compared: the sensor paused in between (seconds). */
  maxSampleGapS: number
}

export const SHAKE: ShakeTuning = { joltG: 1.1, spikeG: 1.8, stepGapS: 0.3, maxSampleGapS: 0.5 }

/**
 * Turns accelerometer readings into shake steps. A step is a jolt: how much the acceleration
 * vector changed since the previous reading, so it works in any orientation and at the 5 Hz
 * Android falls back to without the high sampling rate permission. Steps are spaced by sensor
 * time, not wall time, so readings that reach a busy JS thread in a burst still count one each.
 */
export function createShakeDetector(tuning: ShakeTuning = SHAKE) {
  let prev: Motion | null = null
  let lastStep = -Infinity
  return (m: Motion): boolean => {
    const p = prev
    prev = m
    const dt = p ? m.timestamp - p.timestamp : Infinity
    const jolt = dt > 0 && dt <= tuning.maxSampleGapS ? Math.hypot(m.x - p!.x, m.y - p!.y, m.z - p!.z) : 0
    const spike = Math.hypot(m.x, m.y, m.z)
    if (jolt < tuning.joltG && spike < tuning.spikeG) return false
    if (m.timestamp - lastStep < tuning.stepGapS) return false
    lastStep = m.timestamp
    return true
  }
}
