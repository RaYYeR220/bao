import { assertAddress } from '@/lib/auth';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { packetDetail } from '@/lib/packets';
import { deps, type Ctx } from '@/lib/server';

export const GET = route(async (req, ctx: Ctx<'address'>) => {
  rateLimit(`packet:${clientIp(req)}`, 120, 60_000);
  const address = assertAddress((await ctx.params).address);
  const d = await deps();
  return json(await packetDetail(d.store, d.devnet, address));
});
