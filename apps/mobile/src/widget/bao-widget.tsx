'use no memo'

import type { WidgetView } from '@bao/sdk'
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget'

/** A small lacquer envelope with a foil seal, drawn as SVG for the launcher. */
const envelopeSvg = (tone: 'shu' | 'ash') => {
  const c = tone === 'shu' ? ['#C0282D', '#A8262A', '#6E1C1E', '#3A0710'] : ['#8B8280', '#7D7471', '#5E5655', '#3D3736']
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 242 414">
  <defs>
    <radialGradient id="b" cx="46%" cy="40%" r="82%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".42" stop-color="${c[1]}"/><stop offset=".78" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></radialGradient>
    <linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7F5F2C"/><stop offset=".38" stop-color="#DDBB7A"/><stop offset=".5" stop-color="#F6EBD2"/><stop offset=".62" stop-color="#C9A25C"/><stop offset="1" stop-color="#7F5F2C"/></linearGradient>
    <linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient>
    <radialGradient id="s" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#7A2024"/><stop offset=".7" stop-color="#50070F"/><stop offset="1" stop-color="#320509"/></radialGradient>
  </defs>
  <rect width="230" height="402" rx="8" fill="url(#b)"/>
  <rect x="11" y="196" width="208" height="195" rx="2" fill="none" stroke="url(#f)" stroke-width="1.4" opacity=".55"/>
  <path d="M0 0 H230 V128 Q115 184 0 128 Z" fill="url(#fl)"/>
  <path d="M0 128 Q115 184 230 128" fill="none" stroke="url(#f)" stroke-width="2"/>
  <circle cx="115" cy="156" r="33" fill="url(#s)" stroke="url(#f)" stroke-width="2.4"/>
  <circle cx="115" cy="156" r="27" fill="none" stroke="url(#f)" stroke-width="1"/>
  <circle cx="115" cy="156" r="6" fill="url(#f)" opacity=".9"/>
  <path d="M232 396 C206 384 188 370 164 366 C136 361 118 352 96 340 C80 331 66 330 46 334" fill="none" stroke="url(#f)" stroke-width="1.6" opacity=".85"/>
</svg>`
}

function rainLine(nextRainAt: number | null) {
  if (!nextRainAt) return null
  const mins = Math.max(0, Math.round((nextRainAt - Date.now() / 1000) / 60))
  if (mins <= 0) return 'rain now'
  if (mins < 60) return `rain in ${mins} min`
  return `rain in ${Math.round(mins / 60)} h`
}

export function BaoWidget({ data }: { data: (WidgetView & { source?: string }) | null }) {
  const waiting = data?.waiting ?? 0
  const uri = data?.topPacket ? `bao://packet/${data.topPacket}` : 'bao://'
  const rain = rainLine(data?.nextRainAt ?? null)
  const line = data
    ? [waiting ? `${data.waitingAmountUi} ${data.symbol}` : null, rain].filter(Boolean).join(' · ') ||
      'Tap to drop the first one'
    : 'Opening the box…'
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 22,
        backgroundGradient: { from: '#1C1314', to: '#0B0808', orientation: 'TL_BR' },
        borderWidth: 1,
        borderColor: '#3A2E2F',
        paddingHorizontal: 18,
        paddingVertical: 12,
      }}
    >
      <SvgWidget svg={envelopeSvg(waiting ? 'shu' : 'ash')} style={{ height: 124, width: 72 }} />
      <FlexWidget style={{ flex: 1, marginLeft: 16, flexDirection: 'column', justifyContent: 'center' }}>
        <TextWidget
          text="BAO · 紅包"
          style={{ fontSize: 10, color: '#C9A25C', letterSpacing: 0.2, fontFamily: 'InstrumentSansCondensed-SemiBold' }}
        />
        <TextWidget
          text={waiting ? `${waiting} ${waiting === 1 ? 'packet' : 'packets'} waiting` : 'No packets right now'}
          style={{ fontSize: 26, color: '#F4EFE6', marginTop: 6, fontFamily: 'BodoniModa-Medium' }}
          maxLines={1}
        />
        <TextWidget
          text={line}
          style={{ fontSize: 14, color: '#A29D97', marginTop: 6, fontFamily: 'InstrumentSans-Regular' }}
          maxLines={1}
        />
      </FlexWidget>
    </FlexWidget>
  )
}
