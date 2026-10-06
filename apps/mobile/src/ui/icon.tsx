import { useId } from 'react'
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { color, foilPositions, foilStops } from './tokens'

/** Foil line pictograms (24 × 24, 1.25 stroke). No boxes, no fills. */
const glyphs = {
  feed: (
    <>
      <Rect x="5" y="4" width="12" height="17" rx="1.2" />
      <Path d="M5 9 Q11 12.5 17 9" />
      <Path d="M8.5 2 H19.5 V18" />
    </>
  ),
  circles: (
    <>
      <Circle cx="8" cy="9" r="5" />
      <Circle cx="16" cy="9" r="5" />
      <Circle cx="12" cy="16" r="5" />
    </>
  ),
  box: (
    <>
      <Path d="M3 10 H21 V21 H3 Z" />
      <Path d="M2 6.5 H22 V10 H2 Z" />
      <Path d="M9 14.5 H15" />
    </>
  ),
  seeker: (
    <>
      <Circle cx="12" cy="12" r="9.5" />
      <Circle cx="12" cy="10" r="3.2" />
      <Path d="M6.5 17.5 c2-3.4 9-3.4 11 0" />
    </>
  ),
  envelope: (
    <>
      <Rect x="5" y="2.5" width="14" height="19" rx="1.3" />
      <Path d="M5 8.5 Q12 13 19 8.5" />
      <Circle cx="12" cy="11" r="2.2" />
    </>
  ),
  close: <Path d="M6 6 L18 18 M18 6 L6 18" />,
  back: <Path d="M15 5 L8 12 L15 19" />,
  chevron: <Path d="M9 5 L16 12 L9 19" />,
  arrow: <Path d="M4 12 H20 M14 6 L20 12 L14 18" />,
  external: <Path d="M9 5 H19 V15 M19 5 L6 18" />,
  scan: (
    <>
      <Path d="M3 8 V3 H8 M16 3 H21 V8 M21 16 V21 H16 M8 21 H3 V16" />
      <Path d="M7 12 H17" />
    </>
  ),
  share: (
    <>
      <Path d="M12 3 V15 M7.5 7.5 L12 3 L16.5 7.5" />
      <Path d="M5 11 V20 H19 V11" />
    </>
  ),
  copy: (
    <>
      <Rect x="8" y="8" width="12" height="13" rx="1.2" />
      <Path d="M5 16 V3.5 H15" />
    </>
  ),
  nfc: (
    <>
      <Path d="M8 8.5 a5 5 0 0 1 0 7" />
      <Path d="M11 6 a8.5 8.5 0 0 1 0 12" />
      <Path d="M14 3.5 a12 12 0 0 1 0 17" />
      <Circle cx="5" cy="12" r="1" />
    </>
  ),
  qr: (
    <>
      <Rect x="3.5" y="3.5" width="6.5" height="6.5" />
      <Rect x="14" y="3.5" width="6.5" height="6.5" />
      <Rect x="3.5" y="14" width="6.5" height="6.5" />
      <Path d="M14 14 H17 V17 M20.5 14 V20.5 H14 M17 20.5 V17" />
    </>
  ),
  check: <Path d="M5 12.5 L10 17 L19 7" />,
  plus: <Path d="M12 4 V20 M4 12 H20" />,
  minus: <Path d="M4 12 H20" />,
  bell: (
    <>
      <Path d="M6 17 V11 a6 6 0 0 1 12 0 V17 H5.5 H18.5" />
      <Path d="M10 20 a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  sound: (
    <>
      <Path d="M4 9.5 H8 L13 5 V19 L8 14.5 H4 Z" />
      <Path d="M16.5 9 a4 4 0 0 1 0 6 M19 6.5 a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  haptic: (
    <>
      <Rect x="8" y="3" width="8" height="18" rx="1.5" />
      <Path d="M4.5 8 V16 M19.5 8 V16 M2 10 V14 M22 10 V14" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7 V12 L15.5 14" />
    </>
  ),
  rain: (
    <>
      <Path d="M5 9 Q12 2 19 9" />
      <Path d="M12 5.5 V9" />
      <Path d="M7 13 L6 16 M12 13 L11 16 M17 13 L16 16 M9.5 18 L8.5 21 M14.5 18 L13.5 21" />
    </>
  ),
  crown: <Path d="M4 17 L5 8 L9.5 12.5 L12 6.5 L14.5 12.5 L19 8 L20 17 Z M4 20 H20" />,
  refresh: (
    <>
      <Path d="M19.5 12 a7.5 7.5 0 1 1 -2.2 -5.3" />
      <Path d="M18 3 V7.5 H13.5" />
    </>
  ),
  wallet: (
    <>
      <Path d="M3.5 7 H20.5 V20 H3.5 Z" />
      <Path d="M3.5 7 L16 3.5 V7" />
      <Circle cx="16.5" cy="13.5" r="1.3" />
    </>
  ),
  drop: <Path d="M12 3 C12 3 5.5 10.5 5.5 14.5 a6.5 6.5 0 0 0 13 0 C18.5 10.5 12 3 12 3 Z" />,
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.3 5.3 L7.4 7.4 M16.6 16.6 L18.7 18.7 M5.3 18.7 L7.4 16.6 M16.6 7.4 L18.7 5.3" />
    </>
  ),
  info: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 11 V16.5 M12 7.5 V8.3" />
    </>
  ),
  lock: (
    <>
      <Rect x="5" y="10.5" width="14" height="10" rx="1.2" />
      <Path d="M8 10.5 V7.5 a4 4 0 0 1 8 0 V10.5" />
      <Path d="M12 14.5 V16.5" />
    </>
  ),
  link: (
    <>
      <Path d="M10 14 L14 10" />
      <Path d="M8.5 11.5 L6 14 a3.2 3.2 0 0 0 4.5 4.5 L13 16" />
      <Path d="M15.5 12.5 L18 10 a3.2 3.2 0 0 0 -4.5 -4.5 L11 8" />
    </>
  ),
  seal: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Circle cx="12" cy="12" r="6" />
    </>
  ),
  shield: (
    <>
      <Path d="M12 3 L19.5 6 V11.5 C19.5 16 16 19.5 12 21 C8 19.5 4.5 16 4.5 11.5 V6 Z" />
      <Path d="M8.8 12 L11 14.2 L15.5 9.6" />
    </>
  ),
  shake: (
    <>
      <Rect x="8" y="4" width="8" height="16" rx="1.5" />
      <Path d="M4.5 7.5 Q3 12 4.5 16.5 M19.5 7.5 Q21 12 19.5 16.5" />
    </>
  ),
  edit: <Path d="M4 20 L5 15.5 L15.5 5 L19 8.5 L8.5 19 Z M13.5 7 L17 10.5" />,
  logout: (
    <>
      <Path d="M14 4 H20 V20 H14" />
      <Path d="M3.5 12 H15 M8 7.5 L3.5 12 L8 16.5" />
    </>
  ),
} as const

export type IconName = keyof typeof glyphs

export function Icon({
  name,
  size = 22,
  tone = 'foil',
  strokeWidth = 1.25,
}: {
  name: IconName
  size?: number
  tone?: 'foil' | 'muted' | 'text' | 'jade' | 'shu' | 'ink' | string
  strokeWidth?: number
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const stroke =
    tone === 'foil'
      ? `url(#f${id})`
      : tone === 'muted'
        ? color.gofun44
        : tone === 'text'
          ? color.gofun
          : tone === 'jade'
            ? color.jade300
            : tone === 'shu'
              ? color.shu500
              : tone === 'ink'
                ? color.kuro900
                : tone
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {tone === 'foil' ? (
        <Defs>
          <LinearGradient id={`f${id}`} x1="0" y1="0" x2="1" y2="1">
            {foilStops.map((c, i) => (
              <Stop key={i} offset={foilPositions[i]} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
      ) : null}
      {glyphs[name]}
    </Svg>
  )
}
