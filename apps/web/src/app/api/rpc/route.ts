import { clientIp, rateLimit, route } from '@/lib/http';
import { proxyRpc } from '@/lib/rpc-proxy';
import { HttpError } from '@/lib/types';

export const POST = route(async (req) => {
  rateLimit(`rpc:${clientIp(req)}`, 300, 60_000);
  const body = await req.json().catch(() => {
    throw new HttpError(400, 'body must be JSON-RPC');
  });
  return proxyRpc(body);
});
