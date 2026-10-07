/** Display data for the tokens packets carry. tSKR is the devnet stand-in for SKR. */
import type { TokenInfo } from '@bao/sdk';
import { env } from './env';
import { log } from './log';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export function tokenMeta(mint: string, decimals?: number | null): { symbol: string; decimals: number; pricedAs: string | null } {
  const e = env();
  if (mint === e.TSKR_MINT) return { symbol: 'tSKR', decimals: 6, pricedAs: e.MAINNET_SKR_MINT };
  if (mint === e.MAINNET_SKR_MINT) return { symbol: 'SKR', decimals: 6, pricedAs: e.MAINNET_SKR_MINT };
  if (mint === DEVNET_USDC) return { symbol: 'USDC', decimals: 6, pricedAs: null };
  return { symbol: `${mint.slice(0, 4)}…`, decimals: decimals ?? 0, pricedAs: null };
}

/** Base units -> decimal string without trailing zeros ("47.5"). */
export function formatUi(amount: string | bigint, decimals: number, maxFraction = 4): string {
  const value = BigInt(amount);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  let fraction = (abs % scale).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  if (decimals === 0) fraction = '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Decimal string -> base units with string math, never floating point ("0.1" at 6 decimals is
 * exactly 100000n). Null when it is not a plain non-negative number or has more decimals than
 * the token; nothing is rounded.
 */
export function parseUi(text: string, decimals: number): bigint | null {
  const m = /^(\d*)(?:[.,](\d*))?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const [, whole, fraction = ''] = m;
  if (fraction.length > decimals) return null;
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

const prices = new Map<string, { usd: number | null; at: number }>();
const PRICE_TTL_MS = 5 * 60_000;

/** USD price from Jupiter Price v3; null on any failure. */
export async function usdPrice(mint: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  if (process.env.BAO_OFFLINE) return null;
  const hit = prices.get(mint);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.usd;
  let usd: number | null = null;
  try {
    const res = await fetcher(`https://lite-api.jup.ag/price/v3?ids=${mint}`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      const body = (await res.json()) as Record<string, { usdPrice?: number } | undefined>;
      usd = typeof body[mint]?.usdPrice === 'number' ? body[mint]!.usdPrice! : null;
    }
  } catch (e) {
    log.warn('price.fetch_failed', { mint, error: (e as Error).message });
  }
  prices.set(mint, { usd, at: Date.now() });
  return usd;
}

export async function tokenInfo(mint: string, decimals?: number | null): Promise<TokenInfo> {
  const meta = tokenMeta(mint, decimals);
  return {
    mint,
    symbol: meta.symbol,
    decimals: meta.decimals,
    usd: meta.pricedAs ? await usdPrice(meta.pricedAs) : null,
  };
}
