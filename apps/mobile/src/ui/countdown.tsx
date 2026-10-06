import { useEffect, useState } from 'react'
import type { StyleProp, TextStyle } from 'react-native'

import { countdown } from '@/features/bao/format'

import { T } from './text'

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Self-ticking Bodoni countdown so only this text re-renders each second. */
export function Countdown({
  to,
  variant = 'display',
  style,
  done = '00:00',
}: {
  to: number
  variant?: 'display' | 'meta' | 'caps' | 'bodyStrong' | 'amount'
  style?: StyleProp<TextStyle>
  done?: string
}) {
  const now = useNow()
  const left = to - now
  return (
    <T variant={variant} style={style} accessibilityLabel={left > 0 ? `${countdown(left)} left` : done}>
      {left > 0 ? countdown(left) : done}
    </T>
  )
}
