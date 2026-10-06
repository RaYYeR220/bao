import { env } from '@/lib/env';
import { json, requireSecret, route } from '@/lib/http';
import { indexWebhook } from '@/lib/indexer';
import { deps } from '@/lib/server';

export const maxDuration = 60;

/** Helius sends the auth header configured on the webhook verbatim. */
export const POST = route(async (req) => {
  requireSecret(req, env().HELIUS_WEBHOOK_SECRET);
  const body = await req.json().catch(() => null);
  const d = await deps();
  return json(await indexWebhook({ store: d.store, rpc: d.devnet }, body));
});
