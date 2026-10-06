import { z } from 'zod';
import { ACTIONS_CORS, actionError, actionJson, buildGrabTransaction, grabActionMetadata } from '@/lib/actions';
import { clientIp, rateLimit, readBody } from '@/lib/http';
import { deps, type Ctx } from '@/lib/server';

const Body = z.object({ account: z.string() });

export async function GET(req: Request, ctx: Ctx<'packet'>) {
  try {
    rateLimit(`action:${clientIp(req)}`, 120, 60_000);
    const d = await deps();
    return actionJson(await grabActionMetadata(d.devnet, (await ctx.params).packet));
  } catch (e) {
    return actionError(e);
  }
}

export async function POST(req: Request, ctx: Ctx<'packet'>) {
  try {
    rateLimit(`action:${clientIp(req)}`, 60, 60_000);
    const { account } = await readBody(req, Body);
    const code = new URL(req.url).searchParams.get('code');
    const d = await deps();
    return actionJson(await buildGrabTransaction({ store: d.store, rpc: d.devnet }, (await ctx.params).packet, account, code));
  } catch (e) {
    return actionError(e);
  }
}

export const OPTIONS = async () => new Response(null, { status: 204, headers: ACTIONS_CORS });
