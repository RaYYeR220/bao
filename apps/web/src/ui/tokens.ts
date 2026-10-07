/**
 * Lacquer Box colours, the same values as the app (apps/mobile/src/ui/tokens.ts): a warm black
 * box interior, urushi red, gold only as hairline foil, jade for anything Seeker-verified.
 * globals.css carries them as custom properties; this copy is for the Open Graph images and the
 * envelope drawing, which cannot read CSS variables.
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

  ash: '#7D7471',

  jade300: '#8FC1AE',
  jade500: '#3E7D69',
  jade700: '#24493E',

  paper: '#F4EEE3',
  paperInk: '#171112',
  paperInk2: '#57504D',
} as const;

/** Envelope skins a sender can pick in the app; `ash` is the spent state. */
export type SkinName = 'shu' | 'kuro' | 'jade';
export type EnvelopeTone = SkinName | 'ash';

export const isSkin = (s: string | null | undefined): s is SkinName => s === 'shu' || s === 'kuro' || s === 'jade';
