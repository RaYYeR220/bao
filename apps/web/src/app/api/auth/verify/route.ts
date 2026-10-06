import { z } from 'zod';
import type { SignInInput, SignInOutput } from '@bao/sdk';
import { issueSession, verifySignIn } from '@/lib/auth';
import { clientIp, json, rateLimit, readBody, route } from '@/lib/http';
import { identity } from '@/lib/seeker';
import { deps } from '@/lib/server';

const Body = z.object({
  input: z.object({
    domain: z.string(),
    address: z.string(),
    statement: z.string(),
    uri: z.string(),
    version: z.literal('1'),
    chainId: z.string(),
    nonce: z.string(),
    issuedAt: z.string(),
    expirationTime: z.string(),
  }),
  output: z.object({ address: z.string(), signedMessage: z.string(), signature: z.string() }),
});

export const POST = route(async (req) => {
  rateLimit(`verify:${clientIp(req)}`, 30, 60_000);
  const body = await readBody(req, Body);
  const d = await deps();
  const address = await verifySignIn(d.store, body.input as SignInInput, body.output as SignInOutput);
  const token = await issueSession(address);
  return json({ token, user: await identity({ store: d.store, mainnet: d.mainnet, devnet: d.devnet }, address) });
});
