/** Live numbers for the landing page. Real ones or none: any failure hides the block. */
import { getStore, type Store } from './db';
import { env } from './env';
import { errorMessage, log } from './log';
import { formatUi, tokenMeta } from './tokens';

export interface LandingStats {
  packets: string;
  grabs: string;
  /** Whole tokens paid out to grabbers ("1,234"), with decimals only while the total is small. */
  paid: string;
  symbol: string;
  /** Packets the server's house rain dropped, when there were any. */
  house: string | null;
}

const count = (n: number | bigint) => n.toLocaleString('en-US');

export function formatPaid(base: bigint, decimals: number): string {
  const whole = base / 10n ** BigInt(decimals);
  return whole >= 100n ? count(whole) : formatUi(base, decimals, 2);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export async function readLandingStats(store: Store, mint: string): Promise<LandingStats | null> {
  const totals = await store.totals(mint);
  // nothing dropped yet: no block is better than a row of zeros
  if (totals.packets === 0) return null;
  const { symbol, decimals } = tokenMeta(mint);
  return {
    packets: count(totals.packets),
    grabs: count(totals.grabs),
    paid: formatPaid(BigInt(totals.paid), decimals),
    symbol,
    house: totals.houseDrops > 0 ? count(totals.houseDrops) : null,
  };
}

export async function landingStats(timeoutMs = 2_500): Promise<LandingStats | null> {
  const e = env();
  // an in-memory database has nothing to count, and a build should not boot one to find that out
  if (!e.DATABASE_URL && !e.PGLITE_DIR) return null;
  try {
    return await withTimeout(
      getStore().then((store) => readLandingStats(store, e.TSKR_MINT)),
      timeoutMs,
    );
  } catch (err) {
    log.warn('landing.stats_unread', { error: errorMessage(err) });
    return null;
  }
}
