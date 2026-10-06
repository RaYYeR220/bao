import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { json, readBody, route } from '@/lib/http';
import { deps } from '@/lib/server';

const Body = z.object({ fcmToken: z.string().min(20).max(4096) });

export const POST = route(async (req) => {
  const viewer = await requireUser(req);
  const { fcmToken } = await readBody(req, Body);
  const { store } = await deps();
  await store.registerPushToken(viewer, fcmToken);
  return json({ ok: true });
});
