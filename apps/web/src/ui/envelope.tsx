/**
 * The red packet, drawn like the app's: lacquer body with a seigaiha texture, a foil-edged flap,
 * the seal on its tip, one tick per share along the top and a hairline label panel. The drawing
 * holds no text, so the same SVG serves the pages (text laid over it in HTML) and the Open Graph
 * images (next/og cannot draw SVG text).
 */
import type { ReactNode } from 'react';
import { color, type EnvelopeTone } from './tokens';

export const ENVELOPE_W = 300;
export const ENVELOPE_H = 520;
/** Where the seal sits and where the label panel starts, as fractions of the envelope. */
export const SEAL = { cx: 150, cy: 202, r: 37 };
export const PANEL = { x: 24, y: 262, w: 252, h: 234 };

const TONES: Record<EnvelopeTone, { top: string; bottom: string; flapTop: string; flapBottom: string; line: string; texture: string }> = {
  shu: { top: '#B4262B', bottom: '#8A171B', flapTop: '#C42D31', flapBottom: '#A32226', line: color.kin300, texture: 'rgba(255,214,196,0.12)' },
  kuro: { top: '#2E2324', bottom: '#181213', flapTop: '#3A2D2E', flapBottom: '#261C1D', line: color.kin300, texture: 'rgba(255,255,255,0.075)' },
  jade: { top: '#2F6556', bottom: '#1C3D33', flapTop: '#377564', flapBottom: '#2A5A4C', line: color.kin300, texture: 'rgba(214,255,238,0.1)' },
  ash: { top: '#3A3332', bottom: '#241F1F', flapTop: '#443C3B', flapBottom: '#322B2B', line: color.ash, texture: 'rgba(255,255,255,0.04)' },
};

/** How many ticks to draw for `shares`, and how many of them are still lit. */
export function tickCounts(shares: number, left: number): { ticks: number; lit: number } {
  const ticks = Math.max(1, Math.min(shares, 12));
  if (left <= 0) return { ticks, lit: 0 };
  return { ticks, lit: Math.min(ticks, Math.max(1, Math.round((left / Math.max(1, shares)) * ticks))) };
}

const arc = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
/** One seigaiha tile, 24 by 12: a scallop of three arcs, and the row behind it at half a step. */
const SCALLOPS = [
  [12, 12],
  [0, 6],
  [24, 6],
  [0, 18],
  [24, 18],
]
  .flatMap(([cx, cy]) => [11.5, 7.5, 3.5].map((r) => arc(cx, cy, r)))
  .join('');

function blossom(cx: number, cy: number, key: string, stroke: string) {
  const petals = [0, 72, 144, 216, 288].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return <circle key={deg} cx={(cx + Math.cos(a) * 4.4).toFixed(2)} cy={(cy + Math.sin(a) * 4.4).toFixed(2)} r="2.9" />;
  });
  return (
    <g key={key} fill="none" stroke={stroke} strokeWidth="0.9">
      {petals}
      <circle cx={cx} cy={cy} r="0.9" fill={stroke} stroke="none" />
    </g>
  );
}

/** Foil drawing in the label panel: plum blossom on shu, waves on kuro, bamboo on jade. */
function ornament(tone: EnvelopeTone, stroke: string): ReactNode {
  if (tone === 'shu') {
    return (
      <g opacity="0.82" transform="translate(0 14)">
        <g fill="none" stroke={stroke} strokeWidth="1" strokeLinecap="round">
          <path d="M44 470C92 444 126 436 162 448S232 470 270 488" />
          <path d="M112 441C118 428 122 418 121 406" />
          <path d="M196 458C204 444 214 436 217 424" />
          <path d="M150 446C146 458 138 466 128 470" />
        </g>
        {[
          [121, 399],
          [217, 417],
          [78, 452],
          [124, 474],
          [246, 474],
        ].map(([x, y], i) => blossom(x, y, `b${i}`, stroke))}
      </g>
    );
  }
  if (tone === 'kuro') {
    return (
      <g fill="none" stroke={stroke} strokeWidth="0.9" strokeLinecap="round" opacity="0.72">
        {[404, 422, 440, 458, 476].map((y) => (
          <path key={y} d={`M24 ${y + 18}C70 ${y - 10} 104 ${y + 22} 152 ${y}S236 ${y - 26} 276 ${y - 12}`} />
        ))}
      </g>
    );
  }
  if (tone === 'jade') {
    return (
      <g fill="none" stroke={stroke} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.78">
        <path d="M226 496L233 356" />
        <path d="M222 452L238 451M224 404L240 403" />
        <path d="M233 420C246 408 258 404 272 406C262 416 248 421 233 420Z" />
        <path d="M231 468C244 458 255 455 268 458C258 467 245 471 231 468Z" />
        <path d="M230 390C219 379 208 376 196 379C205 389 218 393 230 390Z" />
        <path d="M252 496L256 430" />
        <path d="M256 448C265 440 273 438 281 440" />
      </g>
    );
  }
  return null;
}

export interface EnvelopeArtProps {
  tone: EnvelopeTone;
  /** Ticks along the top, one per share (see tickCounts). */
  ticks: number;
  lit: number;
  /** Prefix for gradient and pattern ids; unique per envelope on a page. */
  id: string;
  width?: number | string;
  height?: number | string;
}

export function EnvelopeArt({ tone, ticks, lit, id, width = '100%', height = '100%' }: EnvelopeArtProps) {
  const t = TONES[tone];
  const spent = tone === 'ash';
  const ref = (name: string) => `url(#${id}-${name})`;
  const step = ticks > 9 ? 13 : 16;
  const flap = 'M0 0H300V168Q150 236 0 168Z';
  const edge = 'M0 168Q150 236 300 168';
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${ENVELOPE_W} ${ENVELOPE_H}`} width={width} height={height} fill="none">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.top} />
          <stop offset="1" stopColor={t.bottom} />
        </linearGradient>
        <linearGradient id={`${id}-flap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.flapTop} />
          <stop offset="1" stopColor={t.flapBottom} />
        </linearGradient>
        <linearGradient id={`${id}-foil`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={spent ? '#5F5856' : color.kin600} />
          <stop offset="0.38" stopColor={spent ? color.ash : color.kin300} />
          <stop offset="0.5" stopColor={spent ? '#9A908C' : color.kin100} />
          <stop offset="0.62" stopColor={spent ? color.ash : color.kin400} />
          <stop offset="1" stopColor={spent ? '#5F5856' : color.kin600} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity={spent ? 0.05 : 0.17} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-seal`} cx="0.4" cy="0.34" r="0.8">
          <stop offset="0" stopColor={spent ? '#4A4241' : color.shu500} />
          <stop offset="1" stopColor={spent ? '#2A2423' : color.shu800} />
        </radialGradient>
        <pattern id={`${id}-waves`} width="24" height="12" patternUnits="userSpaceOnUse">
          <path d={SCALLOPS} stroke={t.texture} strokeWidth="0.7" />
        </pattern>
        <clipPath id={`${id}-clip`}>
          <rect width={ENVELOPE_W} height={ENVELOPE_H} rx="9" />
        </clipPath>
      </defs>
      <g clipPath={ref('clip')}>
        <rect width={ENVELOPE_W} height={ENVELOPE_H} fill={ref('body')} />
        <rect width={ENVELOPE_W} height={ENVELOPE_H} fill={ref('waves')} />
        {/* the flap casts a soft shadow on the body */}
        <path d="M0 168Q150 236 300 168V184Q150 256 0 184Z" fill="#000000" opacity="0.17" />
        <path d={flap} fill={ref('flap')} />
        <path d={flap} fill={ref('waves')} />
        <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} stroke={t.line} strokeWidth="0.8" opacity="0.6" />
        {ornament(tone, t.line)}
        <path d="M168 -20H236L92 540H24Z" fill={ref('sheen')} />
        <path d={edge} stroke={ref('foil')} strokeWidth="1.6" />
      </g>
      {Array.from({ length: ticks }, (_, i) => {
        const x = 150 + (i - (ticks - 1) / 2) * step;
        return <path key={i} d={`M${x} 25V39`} stroke={i < lit ? (spent ? t.line : color.kin200) : '#000000'} strokeOpacity={i < lit ? 1 : 0.36} strokeWidth="1.8" strokeLinecap="round" />;
      })}
      <circle cx={SEAL.cx} cy={SEAL.cy} r={SEAL.r} fill={ref('foil')} />
      <circle cx={SEAL.cx} cy={SEAL.cy} r={SEAL.r - 2.4} fill={ref('seal')} />
      <circle cx={SEAL.cx} cy={SEAL.cy} r={SEAL.r - 7.5} stroke={t.line} strokeWidth="0.7" opacity="0.55" />
      <rect x="0.5" y="0.5" width={ENVELOPE_W - 1} height={ENVELOPE_H - 1} rx="8.5" stroke="#FFFFFF" strokeOpacity="0.12" />
    </svg>
  );
}

export interface EnvelopeProps {
  tone: EnvelopeTone;
  shares: number;
  left: number;
  /** The number in the label panel ("168"). */
  amount: string;
  /** The line under it ("tSKR · 8 shares"). */
  caption: string;
  id: string;
  className?: string;
}

/** The envelope with its seal glyph and label in HTML over the drawing. Decorative: the page says the same in text. */
export function Envelope({ tone, shares, left, amount, caption, id, className }: EnvelopeProps) {
  const { ticks, lit } = tickCounts(shares, left);
  const size = amount.length <= 3 ? 'xl' : amount.length <= 5 ? 'lg' : amount.length <= 7 ? 'md' : 'sm';
  return (
    <div className={`envelope envelope--${tone}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <EnvelopeArt tone={tone} ticks={ticks} lit={lit} id={id} />
      <span className="envelope__seal" lang="zh-Hant">
        開
      </span>
      <span className="envelope__label">
        <span className={`envelope__amount envelope__amount--${size}`}>{amount}</span>
        <span className="envelope__caption">{caption}</span>
      </span>
    </div>
  );
}
