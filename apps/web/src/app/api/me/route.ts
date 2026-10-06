import { requireUser } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { identity } from '@/lib/seeker';
import { deps } from '@/lib/server';

export const GET = route(async (req) => {
  const address = await requireUser(req);
  const d = await deps();
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  return json(await identity({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, address, { refreshDevnet: refresh }));
});
