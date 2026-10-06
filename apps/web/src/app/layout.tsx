import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Bao — red packets bots cannot grab',
  description: 'Drop a red packet of SKR into your circle. One Seeker, one grab — enforced on-chain.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#1a0606',
          color: '#fbe9d0',
        }}
      >
        {children}
      </body>
    </html>
  );
}
