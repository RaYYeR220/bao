import { runCrank } from '@/lib/crank';
import { env } from '@/lib/env';
import { json, requireSecret, route } from '@/lib/http';
import { loadSigner } from '@/lib/keys';
import { log } from '@/lib/log';
import { deps } from '@/lib/server';

export const maxDuration = 60;

/** Called every minute by Supabase pg_cron (or Vercel Cron) with `Authorization: Bearer <CRON_SECRET>`. */
async function tick(req: Request) {
  requireSecret(req, env().CRON_SECRET);
  const d = await deps();
  const house = env().HOUSE_RAIN_ENABLED
    ? { faucet: await loadSigner('faucet'), authority: await loadSigner('mintAuthority') }
    : null;
  const report = await runCrank({ store: d.store, rpc: d.devnet, crank: await loadSigner('crank'), house });
  const houseRain = report.steps.houseRain.result;
  log.info('crank.tick', {
    ok: report.ok,
    slot: report.slot,
    payouts: report.steps.payouts.result?.done.length ?? 0,
    cancels: report.steps.cancels.result?.done.length ?? 0,
    closes: report.steps.closes.result?.done.length ?? 0,
    houseRain: houseRain ? (houseRain.action === 'dropped' ? houseRain.packet : houseRain.reason) : 'failed',
    indexed: report.steps.indexer.result?.processed ?? 0,
  });
  return json(report, report.ok ? 200 : 207);
}

export const POST = route(tick);
export const GET = route(tick);
