import { StyleSheet, View } from 'react-native'

import { T } from '@/ui/text'
import { color, font } from '@/ui/tokens'

/** Glyphs a circle can wear as its seal (Traditional forms in the bundled serif). */
export const SEAL_GLYPHS = ['福', '運', '紅', '圈', '朱', '翠', '漆', '雨']

/** A circle's round seal: lacquer disc, foil ring, its glyph (or the emoji another client chose). */
export function CircleSeal({ glyph, size = 52 }: { glyph: string | null; size?: number }) {
  const g = glyph || '圈'
  const cjk = SEAL_GLYPHS.includes(g)
  return (
    <View style={[styles.seal, { width: size, height: size, borderRadius: size / 2 }]} accessible={false}>
      <View style={[styles.inner, { borderRadius: size / 2 - 4, top: 3, left: 3, right: 3, bottom: 3 }]} />
      <T
        style={{ fontFamily: cjk ? font.cjk : undefined, fontSize: size * (cjk ? 0.42 : 0.44), lineHeight: size * 0.6, color: color.kin200 }}
        maxFontSizeMultiplier={1}
      >
        {g}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  seal: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.shu800,
    borderWidth: 1,
    borderColor: color.kin400,
    experimental_backgroundImage: 'radial-gradient(circle at 38% 32%, #7A2024 0%, #50070F 70%, #320509 100%)',
  },
  inner: { position: 'absolute', borderWidth: 0.6, borderColor: 'rgba(221,187,122,0.55)' },
})
