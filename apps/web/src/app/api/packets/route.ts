import { z } from 'zod';
import { assertAddress, requireUser } from '@/lib/auth';
import { json, readBody, route } from '@/lib/http';
import { registerPacket } from '@/lib/packets';
import { deps } from '@/lib/server';

const Body = z.object({
  address: z.string(),
  message: z.string().max(280).optional(),
  skin: z.string().trim().max(32).optional(),
  circleId: z.string().max(64).optional(),
  snapshotRoot: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'snapshotRoot must be 32 bytes of hex')
    .optional(),
  codeHint: z.string().max(60).optional(),
});

export const POST = route(async (req) => {
  const viewer = await requireUser(req);
  const body = await readBody(req, Body);
  assertAddress(body.address);
  const d = await deps();
  return json(await registerPacket({ store: d.store, rpc: d.devnet, mainnet: d.mainnet, devnet: d.devnet }, viewer, body), 201);
});
