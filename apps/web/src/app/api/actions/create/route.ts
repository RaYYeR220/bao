import { z } from 'zod';
import { ACTIONS_CORS, actionError, actionJson, buildCreateTransaction, createActionMetadata } from '@/lib/actions';
import { clientIp, rateLimit, readBody } from '@/lib/http';
import { deps } from '@/lib/server';

/** Clients fill the href template; some post the form values under `data` instead. */
const Body = z.object({ account: z.string(), data: z.record(z.string(), z.unknown()).optional() });

export async function GET(req: Request) {
  try {
    rateLimit(`action:${clientIp(req)}`, 120, 60_000);
    const d = await deps();
    return actionJson(await createActionMetadata(d.devnet));
  } catch (e) {
    return actionError(e);
  }
}

export async function POST(req: Request) {
  try {
    rateLimit(`action:${clientIp(req)}`, 60, 60_000);
    const { account, data } = await readBody(req, Body);
    const query = new URL(req.url).searchParams;
    const field = (name: string) => {
      const posted = data?.[name];
      return query.get(name) ?? (typeof posted === 'string' || typeof posted === 'number' ? String(posted) : null);
    };
    const d = await deps();
    return actionJson(
      await buildCreateTransaction(d.devnet, account, { amount: field('amount'), shares: field('shares'), mode: field('mode') }),
    );
  } catch (e) {
    return actionError(e);
  }
}

export const OPTIONS = async () => new Response(null, { status: 204, headers: ACTIONS_CORS });
