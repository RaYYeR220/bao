import { ImageResponse } from 'next/og';
import { loadPacketPage, packetCopy, timeLeft } from '@/lib/link-page';

export const alt = 'A Bao red packet';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ packet: string }> }) {
  const { packet } = await params;
  const p = await loadPacketPage(packet).catch(() => null);
  const copy = p ? packetCopy(p) : null;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg, #c8102e, #5c0013)',
          color: '#fbe9d0',
          fontSize: 40,
        }}
      >
        <div style={{ display: 'flex', fontSize: 44, opacity: 0.9 }}>{copy?.title ?? 'A red packet on Bao'}</div>
        <div style={{ display: 'flex', fontSize: 120, fontWeight: 800, color: '#ffd36b', margin: '24px 0' }}>
          {copy?.amount ?? 'Shake to grab'}
        </div>
        {copy && p ? (
          <div style={{ display: 'flex', fontSize: 40 }}>
            {copy.shares} · {timeLeft(p)}
          </div>
        ) : null}
        <div style={{ display: 'flex', fontSize: 30, marginTop: 40, opacity: 0.75 }}>Bao · one Seeker, one grab</div>
      </div>
    ),
    size,
  );
}
