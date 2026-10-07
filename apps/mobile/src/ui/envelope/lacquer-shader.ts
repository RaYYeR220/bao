import { Skia } from '@shopify/react-native-skia'

import type { EnvelopeTone } from '../tokens'

/** Envelope geometry in design units (the v01 viewBox). */
export const ENV = { W: 230, H: 402, F: 128, A: 184 } as const
/** Lowest point of the arched flap seam. */
export const SEAM_Y = (ENV.F + ENV.A) / 2

/**
 * One lacquer shader for every part of the envelope: tone-on-tone urushi body, a debossed
 * seigaiha (青海波) wave field, a 回 fret band, paper grain, edge falloff and the specular
 * band that follows the phone's tilt. `u_part` picks which piece of the object is drawn so the
 * flap can hinge open on its own layer while the gleam stays continuous across all of them.
 *   0 closed envelope · 1 front pocket · 2 flap front · 3 flap lining · 4 interior
 */
const SKSL = `
uniform float u_scale;
uniform float u_gleam;
uniform float u_gleamA;
uniform float u_part;
uniform float u_pattern;
uniform float u_shimmer;
uniform float u_time;
uniform float3 u_c0;
uniform float3 u_c1;
uniform float3 u_c2;
uniform float3 u_c3;
uniform float3 u_c4;
uniform float3 u_f0;
uniform float3 u_f1;

const float W = 230.0;
const float H = 402.0;
const float F = 128.0;
const float A = 184.0;

float seamY(float x) {
  float t = clamp(x / W, 0.0, 1.0);
  return F + 2.0 * t * (1.0 - t) * (A - F);
}

float ring(float r, float r0) {
  return 1.0 - smoothstep(0.32, 0.78, abs(r - r0));
}

// Frontmost seigaiha scale under d: concentric arcs at 12 / 8 / 4.
float seigaiha(float2 d) {
  float rowH = 6.5;
  float j0 = ceil(d.y / rowH);
  float res = 0.0;
  float found = 0.0;
  for (int k = 0; k < 3; k++) {
    float j = j0 + 2.0 - float(k);
    float cy = j * rowH;
    float off = mod(j, 2.0) * 13.0;
    float cx = floor((d.x - off) / 26.0 + 0.5) * 26.0 + off;
    float r = length(d - float2(cx, cy));
    if (found < 0.5 && r < 13.0) {
      res = max(max(ring(r, 12.0), ring(r, 8.0)), ring(r, 4.0));
      found = 1.0;
    }
  }
  return res;
}

float segH(float2 q, float x0, float x1, float y) {
  float dx = max(max(x0 - q.x, q.x - x1), 0.0);
  return length(float2(dx, q.y - y));
}
float segV(float2 q, float x, float y0, float y1) {
  float dy = max(max(y0 - q.y, q.y - y1), 0.0);
  return length(float2(q.x - x, dy));
}

// 回 fret: M1,15 V1 H15 V11 H5 V5 H11 V8 in a 16-unit tile.
float fret(float2 d) {
  float2 q = mod(d, 16.0);
  float m = segV(q, 1.0, 1.0, 15.0);
  m = min(m, segH(q, 1.0, 15.0, 1.0));
  m = min(m, segV(q, 15.0, 1.0, 11.0));
  m = min(m, segH(q, 5.0, 15.0, 11.0));
  m = min(m, segV(q, 5.0, 5.0, 11.0));
  m = min(m, segH(q, 5.0, 11.0, 5.0));
  m = min(m, segV(q, 11.0, 5.0, 8.0));
  return 1.0 - smoothstep(0.35, 0.95, m);
}

float hash(float2 p) {
  p = fract(p * float2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float3 bodyColor(float2 uv) {
  float r = length((uv - float2(0.46, 0.40)) / 0.82);
  float3 c = mix(u_c0, u_c1, smoothstep(0.0, 0.42, r));
  c = mix(c, u_c2, smoothstep(0.42, 0.78, r));
  c = mix(c, u_c3, smoothstep(0.78, 1.0, r));
  return c;
}

float edgeAlpha(float x) {
  return 0.55 * (1.0 - smoothstep(0.0, 0.16, x)) + 0.6 * smoothstep(0.84, 1.0, x);
}

float3 screen(float3 c, float3 l, float a) {
  return 1.0 - (1.0 - c) * (1.0 - l * a);
}

float gleamAt(float t) {
  float g = u_gleam;
  float a = 0.0;
  if (t < g - 0.2) { a = 0.0; }
  else if (t < g - 0.05) { a = mix(0.0, 0.10, (t - (g - 0.2)) / 0.15); }
  else if (t < g) { a = mix(0.10, u_gleamA, (t - (g - 0.05)) / 0.05); }
  else if (t < g + 0.035) { a = mix(u_gleamA, 0.08, (t - g) / 0.035); }
  else if (t < g + 0.16) { a = mix(0.08, 0.0, (t - (g + 0.035)) / 0.125); }
  return a;
}

half4 main(float2 p) {
  float2 uv = p / float2(W, H);
  float2 d = p;
  float px = 0.8 / u_scale;          // about one device pixel, in design units
  float seam = seamY(d.x);
  float inFlap = 1.0 - smoothstep(seam - px, seam + px, d.y);
  float part = u_part;

  float alpha = 1.0;
  if (part > 0.5 && part < 1.5) { alpha = 1.0 - inFlap; }
  if (part > 1.5 && part < 3.5) { alpha = inFlap; }

  float3 col;
  if (part > 3.5) {
    // interior: dark lacquer seen through the open mouth, with an inner shadow at the lip
    float v = smoothstep(0.0, 0.5, uv.y);
    col = mix(u_c3 * 0.55, u_c2 * 0.8, v);
    col *= 0.75 + 0.25 * smoothstep(0.0, 0.08, uv.y);
    float pat = seigaiha(d);
    col = mix(col, col * 0.7, pat * 0.25 * u_pattern);
  } else if (part > 2.5) {
    // flap lining: gold-leaf paper on the inside of the lid, so the open envelope reads at a glance
    float v = smoothstep(0.0, 1.0, d.y / A);
    float3 gold = mix(float3(0.80, 0.64, 0.36), float3(0.42, 0.31, 0.15), v);
    float pat = seigaiha(d + float2(13.0, 0.0));
    col = mix(gold, gold * 0.72, pat * 0.45);
    col = mix(col, u_c2, 0.18);
  } else {
    float3 body = bodyColor(uv);
    // deboss: a dark arc offset down, a faint warm arc on top
    float fade = mix(0.2, 1.0, smoothstep(0.0, 0.55, uv.y));
    float dark = seigaiha(d - float2(0.0, 0.8));
    float lite = seigaiha(d);
    float3 pocket = body;
    pocket = mix(pocket, pocket * 0.0, dark * 0.22 * fade * u_pattern);
    pocket = mix(pocket, float3(1.0, 0.745, 0.686), lite * 0.06 * fade * u_pattern);
    // fret band at the foot
    if (d.y > H - 26.0) {
      float2 fd = float2(d.x, d.y - (H - 26.0));
      float fdark = fret(fd - float2(0.6, 0.6));
      float flite = fret(fd);
      pocket = mix(pocket, float3(0.0), fdark * 0.30 * u_pattern);
      pocket = mix(pocket, float3(1.0, 0.745, 0.686), flite * 0.09 * u_pattern);
    }
    // the flap's shadow cast on the pocket just under the seam
    float below = d.y - seam - 4.0;
    pocket *= 1.0 - 0.5 * exp(-(below * below) / 20.0) * step(seam, d.y);

    float3 flapCol = mix(u_f0, u_f1, clamp(d.y / A, 0.0, 1.0));
    float r = length((uv - float2(0.46, 0.40)) / 0.82);
    flapCol = mix(flapCol, flapCol * 0.82, smoothstep(0.5, 1.1, r));
    float fdk = seigaiha(d - float2(0.0, 0.8));
    float flt = seigaiha(d);
    flapCol = mix(flapCol, float3(0.0), fdk * 0.22 * 0.35 * u_pattern);
    flapCol = mix(flapCol, float3(1.0, 0.745, 0.686), flt * 0.06 * 0.35 * u_pattern);
    // soft warm highlight that runs parallel to the seam
    float hl = 1.0 - smoothstep(0.2, 1.1, abs(d.y - (seam - 5.0)));
    flapCol = mix(flapCol, float3(1.0, 0.78, 0.745), hl * 0.12);

    col = mix(pocket, flapCol, inFlap);
    col = mix(col, u_c4, edgeAlpha(uv.x));
  }

  // grain
  float2 gp = floor(p * u_scale * 2.2);
  float n = hash(gp) * 0.6 + hash(gp * 0.5 + 17.0) * 0.4;
  col += (n - 0.5) * 0.055;

  // specular band (screen blend), plus a slow shimmer while the proof is on its way
  float t = (uv.x + uv.y) * 0.5;
  float g = gleamAt(t);
  float sh = 0.0;
  if (u_shimmer > 0.0) {
    float s = fract(u_time * 0.35);
    float tt = t - (s * 1.6 - 0.3);
    sh = exp(-(tt * tt) / 0.004) * 0.22 * u_shimmer;
  }
  if (part < 2.5) {
    col = screen(col, float3(1.0, 0.965, 0.933), g + sh);
  } else {
    col = screen(col, float3(1.0, 0.92, 0.85), (g + sh) * 0.35);
  }

  return half4(half3(col) * half(alpha), half(alpha));
}
`

export const lacquerEffect = Skia.RuntimeEffect.Make(SKSL)
if (!lacquerEffect) throw new Error('lacquer shader failed to compile')

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export interface ToneSpec {
  body: [string, string, string, string, string]
  flap: [string, string]
  pattern: number
  foilOpacity: number
  text: string
  sub: string
}

export const tones: Record<EnvelopeTone, ToneSpec> = {
  shu: {
    body: ['#C0282D', '#A8262A', '#6E1C1E', '#3A0710', '#1A0306'],
    flap: ['#A8262A', '#8E1E22'],
    pattern: 1,
    foilOpacity: 1,
    text: '#F4EFE6',
    sub: '#DDBB7A',
  },
  kuro: {
    body: ['#3A2E2F', '#2A2021', '#1C1415', '#100B0C', '#050303'],
    flap: ['#2F2526', '#1F1718'],
    pattern: 1.4,
    foilOpacity: 1,
    text: '#F4EFE6',
    sub: '#DDBB7A',
  },
  jade: {
    body: ['#2F6D5B', '#24564A', '#183A31', '#0D211C', '#050E0B'],
    flap: ['#295E4F', '#1D463B'],
    pattern: 1.2,
    foilOpacity: 1,
    text: '#F4EFE6',
    sub: '#DDBB7A',
  },
  ash: {
    body: ['#8B8280', '#7D7471', '#5E5655', '#3D3736', '#262221'],
    flap: ['#857C7A', '#6F6765'],
    pattern: 0.5,
    foilOpacity: 0.3,
    text: '#C9C1BC',
    sub: '#B5ACA8',
  },
}

export function toneUniforms(tone: EnvelopeTone) {
  const t = tones[tone]
  return {
    u_c0: hex(t.body[0]),
    u_c1: hex(t.body[1]),
    u_c2: hex(t.body[2]),
    u_c3: hex(t.body[3]),
    u_c4: hex(t.body[4]),
    u_f0: hex(t.flap[0]),
    u_f1: hex(t.flap[1]),
    u_pattern: t.pattern,
  }
}
