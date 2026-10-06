import { sessionAddress } from '@/lib/auth';
import { clientIp, json, rateLimit, route, runAfter } from '@/lib/http';
import { feed } from '@/lib/packets';
import { warmSkrNames } from '@/lib/seeker';
import { deps } from '@/lib/server';

/** Works signed out too: then only open packets and rains. */
export const GET = route(async (req) => {
  rateLimit(`feed:${clientIp(req)}`, 120, 60_000);
  const viewer = await sessionAddress(req);
  const d = await deps();
  const identity = { store: d.store, mainnet: d.mainnet, devnet: d.devnet };
  const { senders, ...view } = await feed(identity, viewer);
  // names resolve after the response; the next poll shows them
  runAfter(() => warmSkrNames(identity, senders));
  return json(view);
});
