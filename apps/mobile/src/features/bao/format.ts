import { TSKR_DECIMALS } from './data-access/bao-config'

/** Base units → a short human amount: 88, 31.5, 0.25 (at most `max` decimals, trailing zeros trimmed). */
export function formatAmount(base: string | bigint | null | undefined, decimals = TSKR_DECIMALS, max = 2): string {
  if (base === null || base === undefined) return '—'
  const v = typeof base === 'bigint' ? base : BigInt(base)
  const neg = v < 0n
  const abs = neg ? -v : v
  const unit = 10n ** BigInt(decimals)
  const whole = abs / unit
  let frac = (abs % unit).toString().padStart(decimals, '0')
  // keep more digits for amounts below one so a tiny share never shows as 0
  const keep = whole === 0n ? Math.max(max, frac.search(/[1-9]/) + 2) : max
  frac = frac.slice(0, keep).replace(/0+$/, '')
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${wholeStr}${frac ? `.${frac}` : ''}`
}

/** A count with its noun: "1 packet", "3 packets" (pass `many` for irregular plurals). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const shortAddress = (a: string | null | undefined, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : '')

export const displayName = (skr: string | null | undefined, address: string | null | undefined) =>
  skr ? skr : shortAddress(address)

/** A packet's place in a Luck King chain, counted from 1: "#2 in alice.skr’s chain". */
export const chainPlace = (place: number, starter?: string | null) =>
  `#${place} in ${starter ? `${starter}’s` : 'a'} chain`

/** "04:12" under an hour, "2h 14m" under a day, "3d 4h" beyond. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 3600) {
    const m = Math.floor(s / 60)
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

export function timeAgo(unix: number): string {
  if (!unix) return ''
  const d = Math.floor(Date.now() / 1000) - unix
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  return `${Math.floor(d / 86400)} d ago`
}

export const clockTime = (unix: number) => {
  const d = new Date(unix * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// values can come from the API: encode them so a link always stays one explorer page
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=devnet`
export const explorerAddress = (a: string) =>
  `https://explorer.solana.com/address/${encodeURIComponent(a)}?cluster=devnet`

/** Explorer links for the transactions the devnet faucet sent (it signs server-side). */
export const faucetLinks = (r: { sol: string | null; tskr: string | null; genesis: { signature: string } | null }) =>
  [
    r.sol ? { label: 'SOL tx', url: explorerTx(r.sol) } : null,
    r.tskr ? { label: 'tSKR tx', url: explorerTx(r.tskr) } : null,
    r.genesis ? { label: 'Genesis tx', url: explorerTx(r.genesis.signature) } : null,
  ].filter((l): l is { label: string; url: string } => !!l)

export const sharesLeft = (p: { shares: number; reserved: number }) => Math.max(0, p.shares - p.reserved)

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
