/**
 * The app's three families. Bodoni Moda and Instrument Sans come from Google Fonts at build time
 * (self-hosted by next/font, with the optical-size and width axes the app's static cuts stand for).
 * Noto Serif TC is the app's own 8 KB subset (紅包, 開, 運氣王 and a few more): from Google it
 * would arrive as 108 unicode-range slices and 126 KB of CSS for six glyphs.
 */
import { Bodoni_Moda, Instrument_Sans } from 'next/font/google';
import localFont from 'next/font/local';

export const display = Bodoni_Moda({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-display',
  fallback: ['Didot', 'Bodoni MT', 'Georgia', 'serif'],
});

export const text = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-text',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
});

export const cjk = localFont({
  src: '../../assets/fonts/NotoSerifTC-SemiBold.ttf',
  weight: '600',
  style: 'normal',
  display: 'swap',
  variable: '--font-cjk',
  fallback: ['Noto Serif TC', 'Songti TC', 'PMingLiU', 'serif'],
});
