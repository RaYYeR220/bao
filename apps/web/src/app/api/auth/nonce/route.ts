import { z } from 'zod';
import { issueSignIn } from '@/lib/auth';
import { clientIp, json, rateLimit, readBody, route } from '@/lib/http';
import { deps } from '@/lib/server';

const Body = z.object({ address: z.string() });

export const POST = route(async (req) => {
  rateLimit(`nonce:${clientIp(req)}`, 30, 60_000);
  const { address } = await readBody(req, Body);
  const { store } = await deps();
  return json(await issueSignIn(store, address));
});
