/** Route-handler plumbing: JSON responses, body validation, error mapping, rate limits. */
import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { errorMessage, log } from './log';
import { HttpError } from './types';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(e: unknown, headers: Record<string, string> = {}): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status, headers);
  log.error('http.unhandled', { error: errorMessage(e), stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
  return json({ error: 'internal error' }, 500, headers);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a handler so thrown HttpErrors become JSON responses and anything else a logged 500. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'body must be JSON');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window limiter, per server instance (enough to blunt loops and casual abuse). */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    return;
  }
  bucket.count++;
  if (bucket.count > limit) throw new HttpError(429, 'too many requests, slow down');
}

export function resetRateLimits() {
  buckets.clear();
}

/** Constant-time check of a shared secret from `Authorization: Bearer` or a named header. */
export function requireSecret(req: Request, secret: string | undefined, header = 'authorization') {
  if (!secret) throw new HttpError(503, 'endpoint not configured');
  const raw = req.headers.get(header) ?? '';
  const given = raw.replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'bad secret');
}
