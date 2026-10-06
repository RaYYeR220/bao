import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'

import { $haptics, $sound } from '@/features/bao/data-access/prefs'

const sources = {
  tick: require('../../assets/sounds/tick.wav'),
  crack: require('../../assets/sounds/crack.wav'),
  shimmer: require('../../assets/sounds/shimmer.wav'),
  stamp: require('../../assets/sounds/stamp.wav'),
  slide: require('../../assets/sounds/slide.wav'),
  soft: require('../../assets/sounds/soft.wav'),
}
export type Sfx = keyof typeof sources

const players: Partial<Record<Sfx, AudioPlayer>> = {}
let modeSet = false

function player(name: Sfx) {
  if (!players[name]) {
    players[name] = createAudioPlayer(sources[name])
    players[name]!.volume = name === 'tick' ? 0.5 : 0.8
  }
  return players[name]!
}

/** Short SFX, never louder than the moment deserves; silent when sound is off in Settings. */
export function play(name: Sfx) {
  if (!$sound.get()) return
  try {
    if (!modeSet) {
      modeSet = true
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined)
    }
    const p = player(name)
    void p.seekTo(0)
    p.play()
  } catch {
    // audio is decoration; never let it break a grab
  }
}

/** Warm the players so the first crack is not late. */
export function preloadSounds() {
  for (const k of Object.keys(sources) as Sfx[]) player(k)
}

type Buzz = 'select' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

export function buzz(kind: Buzz) {
  if (!$haptics.get()) return
  const run = () => {
    switch (kind) {
      case 'select':
        return Haptics.selectionAsync()
      case 'light':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      case 'heavy':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
  }
  void run().catch(() => undefined)
}
