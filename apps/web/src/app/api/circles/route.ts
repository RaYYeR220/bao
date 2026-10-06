import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { circleDetail, circleSummaries, createCircle } from '@/lib/circles';
import { json, readBody, route } from '@/lib/http';
import { deps } from '@/lib/server';

const Body = z.object({
  name: z.string().trim().min(1).max(48),
  emoji: z.string().trim().max(16).optional(),
});

export const GET = route(async (req) => {
  const viewer = await requireUser(req);
  const { store } = await deps();
  return json(await circleSummaries(store, viewer));
});

export const POST = route(async (req) => {
  const viewer = await requireUser(req);
  const body = await readBody(req, Body);
  const d = await deps();
  const circle = await createCircle(d.store, viewer, body.name, body.emoji || null);
  return json(await circleDetail({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, circle), 201);
});
