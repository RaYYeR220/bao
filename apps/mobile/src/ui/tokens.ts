/**
 * Lacquer Box tokens. Dark is the default: a warm black box interior, urushi red,
 * gold only as hairline foil, jade for anything Seeker-verified.
 */
export const color = {
  kuro950: '#0F0B0B',
  kuro900: '#171112',
  kuro800: '#211819',
  kuro700: '#2C2122',
  kuro600: '#3A2E2F',
  kuroDeep: '#0A0707',

  gofun: '#F4EFE6',
  gofun64: '#A29D97',
  gofun44: '#746F6B',

  shu50: '#FBEAE6',
  shu100: '#F6D2CA',
  shu200: '#EBA597',
  shu300: '#DB6F5E',
  shu400: '#C0282D',
  shu500: '#A8262A',
  shu600: '#8E181C',
  shu700: '#6E1C1E',
  shu800: '#50070F',
  shu900: '#320509',

  kin100: '#F6EBD2',
  kin200: '#EBD5A6',
  kin300: '#DDBB7A',
  kin400: '#C9A25C',
  kin500: '#A9823F',
  kin600: '#7F5F2C',
  kin700: '#54401F',

  bengara: '#6E3C35',
  ash: '#7D7471',

  jade300: '#8FC1AE',
  jade500: '#3E7D69',
  jade700: '#24493E',

  // gofun card (result, QR)
  paper: '#F4EEE3',
  paperInk: '#171112',
  paperInk2: '#57504D',
  paperInk3: '#6B6460',
} as const

export const semantic = {
  canvas: color.kuro950,
  surface1: color.kuro900,
  surface2: color.kuro800,
  raised: color.kuro700,
  hairline: color.kuro600,
  text1: color.gofun,
  text2: color.gofun64,
  text3: color.gofun44,
  foil: color.kin300,
  verified: color.jade300,
} as const

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 40, 7: 64 } as const
export const radius = { envelope: 6, card: 14, sheet: 24, seal: 999 } as const

/** Foil gradient stops, diagonal and horizontal. */
export const foilStops = [color.kin600, color.kin300, color.kin100, color.kin400, color.kin600]
export const foilPositions = [0, 0.38, 0.5, 0.62, 1]

export const font = {
  display: 'BodoniModa-Medium',
  /** Optical size 28: sturdier hairlines, so amounts (a 4 is mostly hairline) stay legible. */
  numerals: 'BodoniModa28-Medium',
  displayRegular: 'BodoniModa-Regular',
  displayItalic: 'BodoniModa-MediumItalic',
  text: 'InstrumentSans-Regular',
  textMedium: 'InstrumentSans-Medium',
  textSemi: 'InstrumentSans-SemiBold',
  textNarrow: 'InstrumentSansSemiCondensed-Regular',
  caps: 'InstrumentSansCondensed-SemiBold',
  cjk: 'NotoSerifTC-SemiBold',
  cjkBlack: 'NotoSerifTC-Black',
} as const

export const fontAssets = {
  [font.display]: require('../../assets/fonts/BodoniModa-Medium.ttf'),
  [font.numerals]: require('../../assets/fonts/BodoniModa28-Medium.ttf'),
  [font.displayRegular]: require('../../assets/fonts/BodoniModa-Regular.ttf'),
  [font.displayItalic]: require('../../assets/fonts/BodoniModa-MediumItalic.ttf'),
  [font.text]: require('../../assets/fonts/InstrumentSans-Regular.ttf'),
  [font.textMedium]: require('../../assets/fonts/InstrumentSans-Medium.ttf'),
  [font.textSemi]: require('../../assets/fonts/InstrumentSans-SemiBold.ttf'),
  [font.textNarrow]: require('../../assets/fonts/InstrumentSansSemiCondensed-Regular.ttf'),
  [font.caps]: require('../../assets/fonts/InstrumentSansCondensed-SemiBold.ttf'),
  [font.cjk]: require('../../assets/fonts/NotoSerifTC-SemiBold.ttf'),
  [font.cjkBlack]: require('../../assets/fonts/NotoSerifTC-Black.ttf'),
}

/** Envelope skins a sender can pick; `ash` is the spent state. */
export type SkinName = 'shu' | 'kuro' | 'jade'
export type EnvelopeTone = SkinName | 'ash'

export const skins: Record<SkinName, { label: string; cjk: string; note: string }> = {
  shu: { label: 'Shu red', cjk: '朱', note: 'Urushi red, plum blossom in foil' },
  kuro: { label: 'Kuro black', cjk: '黑', note: 'Black lacquer, gold waves' },
  jade: { label: 'Jade', cjk: '翠', note: 'Deep jade, auspicious clouds' },
}

export const isSkin = (s: string | null | undefined): s is SkinName => s === 'shu' || s === 'kuro' || s === 'jade'
