import { DEVNET } from '@bao/sdk';
import { z } from 'zod';
import { log } from './log';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  SIWS_DOMAIN: optional,
  JWT_SECRET: optional.refine((v) => v === undefined || v.length >= 32, 'JWT_SECRET must be at least 32 characters'),
  DATABASE_URL: optional,
  DATABASE_CA_CERT: optional,
  PGLITE_DIR: optional,
  HELIUS_API_KEY: optional,
  DEVNET_RPC_URL: optional,
  MAINNET_RPC_URL: optional,
  FAUCET_KEYPAIR: optional,
  FAUCET_KEYPAIR_PATH: optional,
  CRANK_KEYPAIR: optional,
  CRANK_KEYPAIR_PATH: optional,
  MINT_AUTHORITY_KEYPAIR: optional,
  MINT_AUTHORITY_KEYPAIR_PATH: optional,
  CRON_SECRET: optional,
  HELIUS_WEBHOOK_SECRET: optional,
  FIREBASE_SERVICE_ACCOUNT_JSON: optional,
  ANDROID_PACKAGE: z.string().default('app.getbao'),
  ANDROID_CERT_SHA256: optional,
  GENESIS_GROUP: z.string().default(DEVNET.genesisGroup ?? ''),
  MAINNET_GENESIS_GROUP: z.string().default('GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'),
  TSKR_MINT: z.string().default(DEVNET.tskrMint ?? ''),
  MAINNET_SKR_MINT: z.string().default('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'),
  FAUCET_SOL_LAMPORTS: z.coerce.bigint().default(50_000_000n),
  FAUCET_TSKR_UNITS: z.coerce.bigint().default(1_000_000_000n),
  INDEXER_BACKFILL_LIMIT: z.coerce.number().int().positive().default(200),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Parsed once per process; `resetEnv()` lets tests change process.env between cases. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnv() {
  cached = null;
}

const DEV_JWT_SECRET = 'bao-local-development-secret-not-for-production';

export function jwtSecret(): Uint8Array {
  const secret = env().JWT_SECRET;
  if (secret) return new TextEncoder().encode(secret);
  if (process.env.VERCEL_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  log.once('env.jwt_secret_missing', { note: 'using the local development secret; sessions are not secure' });
  return new TextEncoder().encode(DEV_JWT_SECRET);
}

export function baseUrl(): string {
  return env().PUBLIC_BASE_URL.replace(/\/$/, '');
}

export function siwsDomain(): string {
  return env().SIWS_DOMAIN ?? new URL(baseUrl()).host;
}
