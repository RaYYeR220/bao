import { ImageResponse } from 'next/og';
import { FONT, OG_SIZE, OgCaps, OgEnvelope, OgFrame, OgWordmark, ogFonts } from '@/ui/og';
import { color } from '@/ui/tokens';

export const alt = 'Bao 紅包. Red packets for Seeker. One Seeker, one grab.';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** The link preview of the site: drawn once at build time. */
export default async function Image() {
  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 760, height: '100%', padding: '70px 0 70px 80px' }}>
          <OgWordmark size={148} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontFamily: FONT.display, fontSize: 58, lineHeight: 1.12, letterSpacing: -0.8 }}>Red packets for Seeker.</div>
            <div style={{ display: 'flex', fontFamily: FONT.display, fontStyle: 'italic', fontSize: 58, lineHeight: 1.12, letterSpacing: -0.8, color: color.kin200 }}>
              One Seeker, one grab.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', width: 10, height: 10, borderRadius: 5, backgroundColor: color.jade300, marginRight: 16 }} />
            <OgCaps size={24} tone={color.jade300}>
              Live on Solana devnet
            </OgCaps>
          </div>
        </div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', paddingRight: 56 }}>
          <OgEnvelope tone="shu" height={478} shares={8} left={8} rotate={4} />
        </div>
      </OgFrame>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
