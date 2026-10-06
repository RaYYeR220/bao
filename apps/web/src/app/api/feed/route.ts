import { sessionAddress } from '@/lib/auth';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { feed } from '@/lib/packets';
import { deps } from '@/lib/server';

/** Works signed out too: then only open packets and rains. */
export const GET = route(async (req) => {
  rateLimit(`feed:${clientIp(req)}`, 120, 60_000);
  const viewer = await sessionAddress(req);
  const d = await deps();
  return json(await feed({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, viewer));
});
