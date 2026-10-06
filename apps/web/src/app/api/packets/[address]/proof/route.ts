import { assertAddress } from '@/lib/auth';
import { proofFor } from '@/lib/circles';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { deps, type Ctx } from '@/lib/server';

export const GET = route(async (req, ctx: Ctx<'address'>) => {
  rateLimit(`proof:${clientIp(req)}`, 60, 60_000);
  const packet = assertAddress((await ctx.params).address, 'packet');
  const wallet = assertAddress(new URL(req.url).searchParams.get('wallet'), 'wallet');
  const d = await deps();
  return json({ proof: await proofFor(d.store, d.devnet, packet, wallet) });
});
