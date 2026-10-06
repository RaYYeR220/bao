import { assertAddress, sessionAddress } from '@/lib/auth';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { identity } from '@/lib/seeker';
import { deps, type Ctx } from '@/lib/server';
import { grabViews, packetViews, redactForViewer } from '@/lib/views';

export const GET = route(async (req, ctx: Ctx<'address'>) => {
  rateLimit(`user:${clientIp(req)}`, 60, 60_000);
  const address = assertAddress((await ctx.params).address);
  const d = await deps();
  const [user, sent, grabs, crowns] = await Promise.all([
    identity({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, address),
    d.store.packetsBySender(address),
    d.store.grabsByClaimer(address),
    d.store.crownCount(address),
  ]);
  const sentViews = await redactForViewer(d.store, await sessionAddress(req), await packetViews(d.store, sent));
  return json({ ...user, sent: sentViews, grabs: await grabViews(d.store, grabs), crowns });
});
