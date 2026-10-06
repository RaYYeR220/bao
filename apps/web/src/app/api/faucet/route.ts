import { requireUser } from '@/lib/auth';
import { runFaucet } from '@/lib/faucet';
import { clientIp, json, rateLimit, route } from '@/lib/http';
import { loadSigner } from '@/lib/keys';
import { deps } from '@/lib/server';

export const maxDuration = 60;

export const POST = route(async (req) => {
  const wallet = await requireUser(req);
  rateLimit(`faucet:${clientIp(req)}`, 5, 60 * 60_000);
  const d = await deps();
  const [faucet, authority] = await Promise.all([loadSigner('faucet'), loadSigner('mintAuthority')]);
  return json(await runFaucet({ store: d.store, rpc: d.devnet, faucet, authority }, wallet));
});
