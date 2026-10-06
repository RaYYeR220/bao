import { sessionAddress } from '@/lib/auth';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { widget } from '@/lib/packets';
import { deps } from '@/lib/server';

export const GET = route(async (req) => {
  rateLimit(`widget:${clientIp(req)}`, 120, 60_000);
  const viewer = await sessionAddress(req);
  const { store } = await deps();
  return json(await widget(store, viewer));
});
