import { Text, type TextProps, type TextStyle } from 'react-native'

import { color, font } from './tokens'

type Variant =
  | 'wordmark'
  | 'display'
  | 'amount'
  | 'title'
  | 'name'
  | 'body'
  | 'bodyStrong'
  | 'meta'
  | 'caps'
  | 'capsSmall'
  | 'button'
  | 'cjk'

const variants: Record<Variant, TextStyle> = {
  wordmark: { fontFamily: font.displayItalic, fontSize: 36, lineHeight: 42, letterSpacing: -0.5, color: color.gofun },
  display: { fontFamily: font.numerals, fontSize: 30, lineHeight: 36, color: color.gofun, fontVariant: ['tabular-nums', 'lining-nums'] },
  amount: { fontFamily: font.numerals, fontSize: 72, lineHeight: 80, letterSpacing: -2, color: color.gofun, fontVariant: ['tabular-nums', 'lining-nums'] },
  title: { fontFamily: font.display, fontSize: 26, lineHeight: 32, color: color.gofun },
  name: { fontFamily: font.displayItalic, fontSize: 17, lineHeight: 22, color: color.gofun },
  body: { fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.gofun64 },
  bodyStrong: { fontFamily: font.textMedium, fontSize: 15, lineHeight: 21, color: color.gofun },
  meta: { fontFamily: font.textNarrow, fontSize: 13, lineHeight: 17, color: color.gofun64 },
  caps: { fontFamily: font.caps, fontSize: 11, lineHeight: 14, letterSpacing: 2.2, color: color.gofun44, textTransform: 'uppercase' },
  capsSmall: { fontFamily: font.caps, fontSize: 9.5, lineHeight: 12, letterSpacing: 1.4, color: color.gofun44, textTransform: 'uppercase' },
  button: { fontFamily: font.textSemi, fontSize: 15, lineHeight: 20, letterSpacing: 0.3, color: color.kin200 },
  cjk: { fontFamily: font.cjk, fontSize: 13, lineHeight: 18, color: color.kin300, letterSpacing: 3 },
}

/** Display sizes stop growing past 1.3× so amounts never clip; body text scales freely. */
const maxScale: Partial<Record<Variant, number>> = { wordmark: 1.2, display: 1.3, amount: 1.15, title: 1.3, caps: 1.6, capsSmall: 1.6, cjk: 1.3 }

export function T({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <Text maxFontSizeMultiplier={maxScale[variant] ?? 2} {...props} style={[variants[variant], style]} />
}
