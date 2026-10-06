import { requireUser } from '@/lib/auth';
import { circleDetail, memberCircle } from '@/lib/circles';
import { json, route } from '@/lib/http';
import { deps, type Ctx } from '@/lib/server';

export const GET = route(async (req, ctx: Ctx<'id'>) => {
  const viewer = await requireUser(req);
  const d = await deps();
  const circle = await memberCircle(d.store, (await ctx.params).id, viewer);
  return json(await circleDetail({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, circle));
});
