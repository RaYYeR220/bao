import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { circleDetail, joinCircle } from '@/lib/circles';
import { clientIp, json, rateLimit, readBody, route } from '@/lib/http';
import { deps } from '@/lib/server';

const Body = z.object({ inviteCode: z.string().min(4).max(16) });

export const POST = route(async (req) => {
  const viewer = await requireUser(req);
  rateLimit(`join:${clientIp(req)}`, 20, 60_000);
  const { inviteCode } = await readBody(req, Body);
  const d = await deps();
  const circle = await joinCircle(d.store, viewer, inviteCode);
  return json(await circleDetail({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, circle));
});
