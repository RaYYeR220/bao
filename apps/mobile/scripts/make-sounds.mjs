// Synthesizes Bao's short sound effects into assets/sounds/*.wav (16-bit mono PCM).
// Run: node scripts/make-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 44100
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds')
mkdirSync(out, { recursive: true })

// Deterministic noise so the files are reproducible.
let seed = 20261006
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const noise = () => rand() * 2 - 1

const buffer = (seconds) => new Float64Array(Math.round(seconds * RATE))

function biquadBandpass(input, freq, q) {
  const w = (2 * Math.PI * freq) / RATE
  const alpha = Math.sin(w) / (2 * q)
  const b0 = alpha
  const b2 = -alpha
  const a0 = 1 + alpha
  const a1 = -2 * Math.cos(w)
  const a2 = 1 - alpha
  const outBuf = new Float64Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
    outBuf[i] = y
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
  }
  return outBuf
}

function lowpass(input, freq) {
  const a = Math.exp((-2 * Math.PI * freq) / RATE)
  const o = new Float64Array(input.length)
  let y = 0
  for (let i = 0; i < input.length; i++) {
    y = (1 - a) * input[i] + a * y
    o[i] = y
  }
  return o
}

/** Damped sine partial added into buf. */
function partial(buf, start, freq, amp, decay, glideTo = freq, glideTime = 0) {
  const s0 = Math.round(start * RATE)
  let phase = 0
  for (let i = s0; i < buf.length; i++) {
    const t = (i - s0) / RATE
    const f = glideTime > 0 ? freq + (glideTo - freq) * Math.min(1, t / glideTime) : freq
    phase += (2 * Math.PI * f) / RATE
    const attack = Math.min(1, t / 0.002)
    const env = attack * Math.exp(-t / decay)
    if (env < 1e-4 && t > 0.01) break
    buf[i] += amp * env * Math.sin(phase)
  }
}

function add(dst, src, gain = 1, offset = 0) {
  const o = Math.round(offset * RATE)
  for (let i = 0; i < src.length && i + o < dst.length; i++) dst[i + o] += src[i] * gain
}

function fadeOut(buf, seconds = 0.02) {
  const n = Math.round(seconds * RATE)
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n
}

function normalize(buf, peak = 0.89) {
  let max = 0
  for (const v of buf) max = Math.max(max, Math.abs(v))
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / max) * peak
  return buf
}

function write(name, buf, peak) {
  normalize(buf, peak)
  fadeOut(buf)
  const data = Buffer.alloc(44 + buf.length * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + buf.length * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(RATE, 24)
  data.writeUInt32LE(RATE * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(buf.length * 2, 40)
  for (let i = 0; i < buf.length; i++)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2)
  writeFileSync(join(out, `${name}.wav`), data)
  console.log('%s.wav  %s KB', name, (data.length / 1024).toFixed(1))
}

// tick — a dry foil click for each shake
{
  const b = buffer(0.09)
  partial(b, 0, 2350, 0.7, 0.012)
  partial(b, 0, 4100, 0.35, 0.008)
  const n = buffer(0.01).map(() => noise())
  add(b, biquadBandpass(n, 5000, 1.2), 0.5)
  write('tick', b, 0.6)
}

// crack — lacquer seal snapping: crackle impulses, a woody snap and a low thump
{
  const b = buffer(0.5)
  const crackle = buffer(0.07)
  for (let k = 0; k < 9; k++) {
    const at = Math.round(rand() * 0.05 * RATE)
    const len = Math.round((0.002 + rand() * 0.004) * RATE)
    for (let i = 0; i < len && at + i < crackle.length; i++)
      crackle[at + i] += noise() * (1 - i / len) * (0.6 + rand() * 0.4)
  }
  add(b, biquadBandpass(crackle, 3200, 0.9), 1.4)
  partial(b, 0.004, 1180, 0.45, 0.03)
  partial(b, 0.004, 2730, 0.25, 0.02)
  partial(b, 0, 120, 0.9, 0.07, 70, 0.08)
  const body = buffer(0.12).map((_, i) => noise() * Math.exp(-i / RATE / 0.025))
  add(b, lowpass(body, 900), 0.8)
  write('crack', b, 0.92)
}

// shimmer — gold leaf settling: staggered small bells with inharmonic partials
{
  const b = buffer(1.6)
  const bells = 16
  for (let k = 0; k < bells; k++) {
    const t = 0.02 + (k / bells) ** 1.4 * 0.95 + rand() * 0.03
    const f = 2600 + rand() * 3000
    const a = 0.5 * (1 - k / (bells + 4))
    partial(b, t, f, a, 0.22)
    partial(b, t, f * 2.76, a * 0.35, 0.09)
    partial(b, t, f * 5.4, a * 0.12, 0.05)
  }
  const air = buffer(1.0).map((_, i) => noise() * Math.sin((Math.PI * i) / (RATE * 1.0)) ** 2)
  add(b, biquadBandpass(air, 7000, 0.8), 0.06)
  write('shimmer', b, 0.7)
}

// stamp — the 運氣王 seal landing: pitch-dropping thud, paper slap, a short wooden ring
{
  const b = buffer(0.6)
  partial(b, 0, 120, 1.0, 0.16, 48, 0.09)
  partial(b, 0, 230, 0.35, 0.05)
  partial(b, 0.002, 680, 0.12, 0.03)
  const slap = buffer(0.05).map((_, i) => noise() * Math.exp(-i / RATE / 0.008))
  add(b, lowpass(slap, 2200), 0.9)
  write('stamp', b, 0.95)
}

// slide — the gofun card leaving the envelope: a short paper whoosh
{
  const len = 0.48
  const b = buffer(len)
  const n = buffer(len).map(() => noise())
  const out1 = new Float64Array(n.length)
  // sweep a bandpass upward by filtering in short blocks
  const block = 512
  for (let s = 0; s < n.length; s += block) {
    const t = s / n.length
    const f = 900 + t * 2600
    const seg = biquadBandpass(n.slice(Math.max(0, s - 256), s + block), f, 1.1)
    for (let i = 0; i < block && s + i < n.length; i++) out1[s + i] = seg[i + Math.min(256, s)]
  }
  for (let i = 0; i < b.length; i++) {
    const t = i / b.length
    b[i] = out1[i] * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 1.6
  }
  write('slide', b, 0.5)
}

// soft — quiet confirmation (copied, saved, joined)
{
  const b = buffer(0.32)
  partial(b, 0, 880, 0.5, 0.07)
  partial(b, 0.06, 1318.5, 0.45, 0.09)
  write('soft', b, 0.45)
}
