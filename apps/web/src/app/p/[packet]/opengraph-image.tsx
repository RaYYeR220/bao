import { ImageResponse } from 'next/og';
import { loadPacketPage, packetCopy, timeLeft } from '@/lib/link-page';
import { FONT, OG_SIZE, OgCaps, OgCheck, OgEnvelope, OgFrame, OgWordmark, ogFonts } from '@/ui/og';
import { color, isSkin } from '@/ui/tokens';

export const alt = 'A Bao red packet';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * Long .skr names step down in size and are cut before they leave the column. Below the full
 * size they are set in the sturdier 28 pt roman: the display italic's hairlines (a hyphen, a
 * comma) vanish when it is small.
 */
function fitName(name: string): { text: string; size: number; small: boolean } {
  const text = name.length > 30 ? `${name.slice(0, 29)}…` : name;
  const size = text.length <= 14 ? 74 : text.length <= 20 ? 58 : 44;
  return { text, size, small: size < 74 };
}

export default async function Image({ params }: { params: Promise<{ packet: string }> }) {
  const { packet } = await params;
  const p = await loadPacketPage(packet).catch(() => null);
  const copy = p ? packetCopy(p) : null;
  const open = copy ? copy.state === 'live' || copy.state === 'scheduled' : true;
  const tone = !open ? 'ash' : p && isSkin(p.skin) ? p.skin : 'shu';
  const name = copy ? fitName(copy.who) : null;
  const line = !p || !copy ? null : copy.state === 'live' ? `${copy.shares} · ${timeLeft(p)}` : copy.state === 'scheduled' ? `${p.shares} ${p.shares === 1 ? 'share' : 'shares'} · ${timeLeft(p)}` : copy.status;
  return new ImageResponse(
    (
      <OgFrame spent={!open}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 780, height: '100%', padding: '66px 0 66px 80px' }}>
          <OgWordmark size={60} />
          {p && copy && name ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <OgCaps size={25} tone={open ? color.kin300 : color.gofun64}>
                {copy.kind}
              </OgCaps>
              <div style={{ display: 'flex', marginTop: 18, fontFamily: FONT.display, fontSize: 74, lineHeight: 1.08, letterSpacing: -1 }}>A red packet</div>
              <div
                style={{
                  display: 'flex',
                  fontFamily: name.small ? FONT.numerals : FONT.display,
                  fontStyle: name.small ? 'normal' : 'italic',
                  fontSize: name.size,
                  lineHeight: name.small ? 1.3 : 1.12,
                  letterSpacing: -0.6,
                  color: open ? color.kin200 : color.gofun,
                }}
              >
                from {name.text}
              </div>
              <div style={{ display: 'flex', marginTop: 26, fontSize: 32, lineHeight: 1.3, color: open ? color.gofun : color.gofun64 }}>{line}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontFamily: FONT.display, fontSize: 74, lineHeight: 1.08, letterSpacing: -1 }}>A red packet</div>
              <div style={{ display: 'flex', fontFamily: FONT.display, fontStyle: 'italic', fontSize: 74, lineHeight: 1.12, letterSpacing: -1, color: color.kin200 }}>
                on Bao
              </div>
              <div style={{ display: 'flex', marginTop: 26, fontSize: 32, lineHeight: 1.3 }}>Shake to grab a share.</div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {p && !p.seekerOnly ? (
              <div style={{ display: 'flex', alignItems: 'center', height: 46, padding: '0 20px', border: `1.5px solid ${color.kuro600}`, borderRadius: 23 }}>
                <OgCaps size={20} tone={color.gofun64}>
                  {copy?.gate ?? 'Any wallet'}
                </OgCaps>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', height: 46, padding: '0 20px 0 14px', border: '1.5px solid rgba(143, 193, 174, 0.55)', borderRadius: 23 }}>
                <OgCheck size={22} tone={color.jade300} />
                <div style={{ display: 'flex', marginLeft: 12 }}>
                  <OgCaps size={20} tone={color.jade300}>
                    Seeker-only
                  </OgCaps>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', marginLeft: 22, fontSize: 26, color: color.gofun64 }}>
              {p && !p.seekerOnly ? 'One grab per wallet.' : 'One Seeker, one grab.'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', paddingRight: 52 }}>
          <OgEnvelope
            tone={tone}
            height={486}
            shares={p?.shares ?? 8}
            left={copy?.left ?? 8}
            amount={copy?.amountUi}
            caption={p && copy ? `${copy.symbol} · ${p.shares} ${p.shares === 1 ? 'share' : 'shares'}` : undefined}
            rotate={3}
          />
        </div>
      </OgFrame>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
