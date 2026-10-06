import { assertAddress } from '@/lib/auth';
import { payoutClaim } from '@/lib/claims';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { loadSigner } from '@/lib/keys';
import { deps, type Ctx } from '@/lib/server';

export const maxDuration = 60;

/** Pays a won lucky share right after its VRF callback, so the grabber signs nothing twice. */
export const POST = route(async (req, ctx: Ctx<'address'>) => {
  rateLimit(`payout:${clientIp(req)}`, 20, 60_000);
  const claim = assertAddress((await ctx.params).address, 'claim');
  const d = await deps();
  return json(await payoutClaim({ store: d.store, rpc: d.devnet, crank: await loadSigner('crank') }, claim));
});
