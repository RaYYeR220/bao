import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { baseUrl, env } from '@/lib/env';
import { loadPacketPage, packetCopy, timeLeft } from '@/lib/link-page';
import { Countdown } from './countdown';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ packet: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { packet } = await params;
  const p = await loadPacketPage(packet);
  if (!p) return { title: 'Red packet not found — Bao' };
  const copy = packetCopy(p);
  const url = `${baseUrl()}/p/${packet}`;
  return {
    title: `${copy.title} — Bao`,
    description: `${copy.amount} · ${copy.shares}. ${p.message ?? 'Shake to grab in Bao.'}`,
    alternates: { canonical: url },
    openGraph: { title: copy.title, description: `${copy.amount} · ${copy.shares}`, url, siteName: 'Bao', type: 'website' },
    twitter: { card: 'summary_large_image', title: copy.title, description: `${copy.amount} · ${copy.shares}` },
    other: {
      'al:android:url': `bao://packet/${packet}`,
      'al:android:package': env().ANDROID_PACKAGE,
      'al:android:app_name': 'Bao',
    },
  };
}

const button = {
  display: 'block',
  padding: '16px 20px',
  borderRadius: 14,
  fontWeight: 700,
  fontSize: 18,
  textDecoration: 'none',
  textAlign: 'center' as const,
};

export default async function PacketPage({ params }: Props) {
  const { packet } = await params;
  const p = await loadPacketPage(packet);
  if (!p) notFound();
  const copy = packetCopy(p);
  const actionUrl = `${baseUrl()}/api/actions/grab/${packet}`;
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '48px 20px' }}>
      <div
        style={{
          background: 'linear-gradient(160deg, #c8102e, #7a0019)',
          borderRadius: 24,
          padding: '36px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,.45)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, opacity: 0.85 }}>{copy.title}</p>
        <h1 style={{ margin: '12px 0 4px', fontSize: 44, color: '#ffd36b' }}>{copy.amount}</h1>
        <p style={{ margin: 0 }}>{copy.shares}</p>
        {p.message ? <p style={{ fontSize: 20, fontStyle: 'italic', margin: '20px 0 0' }}>“{p.message}”</p> : null}
        <p style={{ margin: '20px 0 0', opacity: 0.8 }}>
          {p.status === 'live' || p.status === 'scheduled' ? (
            <Countdown
              label={p.status === 'live' ? 'Expires in' : 'Opens in'}
              target={p.status === 'live' ? p.expiresAt : p.startsAt}
              initial={timeLeft(p)}
            />
          ) : (
            timeLeft(p)
          )}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 14, opacity: 0.7 }}>
          {copy.mode} · {copy.gate}
        </p>
        {p.codeHint ? <p style={{ margin: '6px 0 0', fontSize: 14 }}>Hint: {p.codeHint}</p> : null}
      </div>
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        <a href={`bao://packet/${packet}`} style={{ ...button, background: '#ffd36b', color: '#3a0008' }}>
          Open in Bao
        </a>
        <a
          href={`https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}&cluster=devnet`}
          style={{ ...button, border: '1px solid #ffd36b', color: '#ffd36b' }}
        >
          Grab with any Solana wallet
        </a>
      </div>
      <p style={{ fontSize: 13, opacity: 0.6, marginTop: 24, textAlign: 'center', wordBreak: 'break-all' }}>
        Share: {baseUrl()}/p/{packet}
      </p>
      <p style={{ fontSize: 13, opacity: 0.6, marginTop: 8, textAlign: 'center' }}>
        {p.grabs.length} {p.grabs.length === 1 ? 'grab' : 'grabs'} so far · runs on Solana devnet ·{' '}
        <a style={{ color: 'inherit' }} href={`https://explorer.solana.com/address/${packet}?cluster=devnet`}>
          view on explorer
        </a>
      </p>
    </main>
  );
}
