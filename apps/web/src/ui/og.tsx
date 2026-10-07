/**
 * Shared pieces of the Open Graph images (next/og: flexbox only, a small CSS subset, no SVG text).
 * Fonts are the app's own TTFs, copied to assets/fonts and read from disk; the Noto Serif TC file
 * is the app's subset, so only 紅包, 開, 運氣王 and a few more characters can be set in it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { errorMessage, log } from '@/lib/log';
import { ENVELOPE_H, ENVELOPE_W, EnvelopeArt, PANEL, SEAL, tickCounts } from './envelope';
import { color, type EnvelopeTone } from './tokens';

export const OG_SIZE = { width: 1200, height: 630 };

export const FONT = {
  display: 'Bodoni Moda',
  numerals: 'Bodoni Moda 28',
  text: 'Instrument Sans',
  caps: 'Instrument Sans Condensed',
  cjk: 'Noto Serif TC',
} as const;

interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600;
  style: 'normal' | 'italic';
}

// one literal path per file, so the build traces each font into the functions that draw images
const font = (file: Promise<Buffer>, name: string, weight: OgFont['weight'], style: OgFont['style'] = 'normal') =>
  file.then((data): OgFont => ({ name, data, weight, style }));

let loaded: Promise<OgFont[] | undefined> | null = null;

/** The fonts, read once per process. Undefined if they cannot be read: the image then uses next/og's built-in face. */
export function ogFonts(): Promise<OgFont[] | undefined> {
  loaded ??= Promise.all([
    font(readFile(join(process.cwd(), 'assets/fonts/BodoniModa-Medium.ttf')), FONT.display, 500),
    font(readFile(join(process.cwd(), 'assets/fonts/BodoniModa-MediumItalic.ttf')), FONT.display, 500, 'italic'),
    font(readFile(join(process.cwd(), 'assets/fonts/BodoniModa28-Medium.ttf')), FONT.numerals, 500),
    font(readFile(join(process.cwd(), 'assets/fonts/InstrumentSans-Regular.ttf')), FONT.text, 400),
    font(readFile(join(process.cwd(), 'assets/fonts/InstrumentSans-SemiBold.ttf')), FONT.text, 600),
    font(readFile(join(process.cwd(), 'assets/fonts/InstrumentSansCondensed-SemiBold.ttf')), FONT.caps, 600),
    font(readFile(join(process.cwd(), 'assets/fonts/NotoSerifTC-SemiBold.ttf')), FONT.cjk, 600),
  ]).catch((e) => {
    log.warn('og.fonts_unread', { error: errorMessage(e) });
    loaded = null;
    return undefined;
  });
  return loaded;
}

/** The lacquer box: warm black, a red glow behind the envelope, a foil hairline just inside the edge. */
export function OgFrame({ children, spent }: { children: ReactNode; spent?: boolean }) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: color.kuro950,
        backgroundImage: spent
          ? 'radial-gradient(circle at 78% 46%, rgba(58, 46, 47, 0.75), rgba(15, 11, 11, 0) 58%)'
          : 'radial-gradient(circle at 78% 46%, rgba(142, 24, 28, 0.52), rgba(15, 11, 11, 0) 58%)',
        color: color.gofun,
        fontFamily: FONT.text,
      }}
    >
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          left: 22,
          top: 22,
          right: 22,
          bottom: 22,
          border: '1px solid rgba(221, 187, 122, 0.3)',
          borderRadius: 4,
        }}
      />
      {children}
    </div>
  );
}

export function OgWordmark({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', fontFamily: FONT.display, fontStyle: 'italic', fontSize: size, lineHeight: 1, letterSpacing: -size * 0.015 }}>Bao</div>
      <div style={{ display: 'flex', width: 1, height: size * 0.56, backgroundColor: color.kin500, marginLeft: size * 0.36, marginRight: size * 0.34 }} />
      <div style={{ display: 'flex', fontFamily: FONT.cjk, fontSize: size * 0.42, lineHeight: 1, letterSpacing: size * 0.08, color: color.kin300 }}>紅包</div>
    </div>
  );
}

/** Condensed capitals in foil, the app's eyebrow. */
export function OgCaps({ children, size = 24, tone = color.kin300 }: { children: ReactNode; size?: number; tone?: string }) {
  return (
    <div style={{ display: 'flex', fontFamily: FONT.caps, fontSize: size, lineHeight: 1.2, letterSpacing: size * 0.2, textTransform: 'uppercase', color: tone }}>
      {children}
    </div>
  );
}

export interface OgEnvelopeProps {
  tone: EnvelopeTone;
  height: number;
  shares: number;
  left: number;
  /** Set both to print the label panel; leave out for the bare envelope. */
  amount?: string;
  caption?: string;
  rotate?: number;
}

export function OgEnvelope({ tone, height, shares, left, amount, caption, rotate = 0 }: OgEnvelopeProps) {
  const k = height / ENVELOPE_H;
  const width = ENVELOPE_W * k;
  const { ticks, lit } = tickCounts(shares, left);
  const spent = tone === 'ash';
  const glyph = 35 * k;
  const digits = amount ? (amount.length <= 3 ? 92 : amount.length <= 5 ? 66 : amount.length <= 7 ? 50 : 38) * k : 0;
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width,
        height,
        borderRadius: 9 * k,
        boxShadow: '0 40px 70px rgba(0, 0, 0, 0.6)',
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <EnvelopeArt tone={tone} ticks={ticks} lit={lit} id="og" width={width} height={height} />
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          left: (SEAL.cx - SEAL.r) * k,
          top: (SEAL.cy - SEAL.r) * k,
          width: SEAL.r * 2 * k,
          height: SEAL.r * 2 * k,
          fontFamily: FONT.cjk,
          fontSize: glyph,
          lineHeight: 1,
          color: spent ? '#9A908C' : color.kin200,
        }}
      >
        開
      </div>
      {amount && caption ? (
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            left: PANEL.x * k,
            top: PANEL.y * k,
            width: PANEL.w * k,
            height: PANEL.h * k,
            paddingTop: 26 * k,
          }}
        >
          <div style={{ display: 'flex', fontFamily: FONT.numerals, fontSize: digits, lineHeight: 0.95, letterSpacing: -digits * 0.015, color: spent ? '#B5ADA7' : color.gofun }}>
            {amount}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 8 * k,
              fontFamily: FONT.caps,
              fontSize: 13 * k,
              letterSpacing: 13 * k * 0.22,
              textTransform: 'uppercase',
              color: spent ? '#8F8682' : color.kin300,
            }}
          >
            {caption}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A small tick in a ring: the app's mark for anything Seeker-verified. */
export function OgCheck({ size, tone }: { size: number; tone: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke={tone} strokeWidth="1.2" />
      <path d="M4.9 8.2l2.1 2.1 4.1-4.4" stroke={tone} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
