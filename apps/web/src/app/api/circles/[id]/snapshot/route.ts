import { requireUser } from '@/lib/auth';
import { memberCircle, snapshotCircle } from '@/lib/circles';
import { json, route } from '@/lib/http';
import { deps, type Ctx } from '@/lib/server';

export const POST = route(async (req, ctx: Ctx<'id'>) => {
  const viewer = await requireUser(req);
  const { store } = await deps();
  const circle = await memberCircle(store, (await ctx.params).id, viewer);
  return json(await snapshotCircle(store, circle.id));
});
