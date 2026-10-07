import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { baseUrl } from '@/lib/env';
import { cjk, display, text } from '@/ui/fonts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: { default: 'Bao 紅包 · Red packets for Seeker', template: '%s · Bao' },
  description:
    'Red packets for Solana Seeker. Drop tSKR to a circle or the public feed, shake to grab a share. Each grab is bound on-chain to a Seeker Genesis Token: one Seeker, one grab.',
  applicationName: 'Bao',
  icons: { icon: [{ url: '/favicon.png', type: 'image/png', sizes: '96x96' }], apple: '/icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0f0b0b',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${cjk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
