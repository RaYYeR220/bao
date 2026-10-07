# Bao API and link pages (`apps/web`)

Next.js 16 (App Router) on Vercel with Supabase Postgres. It never holds user funds: every money
movement is a transaction of the Bao program on **devnet**. The server signs only the Playground
faucet and permissionless program instructions (payouts, stale-grab cancels, packet closes).
Mainnet is read, never written: `.skr` names (AllDomains) and real Seeker Genesis Token status.

| Area | Where |
|---|---|
| Sign In With Solana, sessions | `src/lib/auth.ts`, `/api/auth/nonce`, `/api/auth/verify` |
| Identity (`.skr`, Seeker on mainnet, test Genesis on devnet) | `src/lib/skr.ts`, `src/lib/seeker.ts`, `/api/me`, `/api/users/:address` |
| Playground faucet | `src/lib/faucet.ts`, `/api/faucet` |
| Circles, snapshots, proofs | `src/lib/circles.ts`, `/api/circles/**`, `/api/packets/:address/proof` |
| Packets, feed, widget | `src/lib/packets.ts`, `/api/packets/**`, `/api/feed`, `/api/widget` |
| Indexer (webhook + poller) | `src/lib/indexer.ts`, `src/lib/chain.ts`, `/api/webhooks/helius` |
| Crank | `src/lib/crank.ts`, `/api/cron/tick`, `/api/claims/:address/payout` |
| Push (FCM HTTP v1) | `src/lib/push.ts`, `/api/push/register` |
| Solana Actions | `src/lib/actions.ts`, `/actions.json`, `/api/actions/grab/:packet` |
| Link pages | `/p/:packet` (+ Open Graph image), `/.well-known/assetlinks.json`, `/` |
| Devnet RPC proxy (allowlisted methods, keeps the Helius key server-side) | `src/lib/rpc-proxy.ts`, `POST /api/rpc` |
| Database | `src/lib/db.ts` (all SQL), `../../supabase/migrations` |

The request and response shapes are the `Endpoints` contract in `packages/sdk/src/api.ts`.

## Environment

All variables are read and validated once by `src/lib/env.ts` (zod). Anything optional degrades
with a single JSON log line naming what is off.

| Variable | Required | What it does / what breaks without it |
|---|---|---|
| `PUBLIC_BASE_URL` | production | Public origin. SIWS `uri`, link pages, Actions URLs. Default `http://localhost:3000`. |
| `SIWS_DOMAIN` | no | SIWS `domain`; defaults to the host of `PUBLIC_BASE_URL`. Must match what the app's wallet signs. |
| `JWT_SECRET` | production | HS256 session secret (32+ chars). Without it a fixed development secret is used, and production refuses to start sessions. |
| `DATABASE_URL` | production | Supabase Postgres (use the pooler URL in transaction mode on Vercel). Without it an embedded PGlite is used: data does not survive restarts. |
| `DATABASE_CA_CERT` | no | Supabase CA (PEM) for verified TLS. Alternatively add `sslmode` to the URL. |
| `PGLITE_DIR` | no | Keep the embedded PGlite on disk (local only). |
| `HELIUS_API_KEY` | recommended | Helius RPC for devnet and mainnet. Without it the public endpoints are used: rate limits, slower `.skr` lookups. |
| `DEVNET_RPC_URL`, `MAINNET_RPC_URL` | no | Explicit RPC overrides. |
| `FAUCET_KEYPAIR` / `FAUCET_KEYPAIR_PATH` | for the faucet | Pays the faucet's 0.05 SOL drip. Without it the faucet skips SOL. |
| `MINT_AUTHORITY_KEYPAIR` / `MINT_AUTHORITY_KEYPAIR_PATH` | for the faucet | tSKR mint authority and test Genesis group update authority (`4EtAF…`). Without it the faucet skips tSKR and Genesis tokens. |
| `CRANK_KEYPAIR` / `CRANK_KEYPAIR_PATH` | for the crank | Signs payouts, `cancel_stale`, `close_claims`, `close_packet`. Without it those steps and `/api/claims/:address/payout` are disabled (shares stay claimable). |
| `CRON_SECRET` | for the crank | Bearer secret of `/api/cron/tick`. Without it the endpoint answers 503. |
| `HELIUS_WEBHOOK_SECRET` | for the webhook | Value of the webhook's `Authorization` header. Without it the endpoint answers 503 and indexing relies on the cron poller (up to a minute behind). |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | for pushes | Service-account JSON (one line). Without it pushes are logged and skipped. |
| `ANDROID_PACKAGE` | no | Default `app.getbao`. Used by asset links and link-page metadata. |
| `ANDROID_CERT_SHA256` | for App Links | Release signing certificate SHA-256 (comma-separated for several). Without it App Links do not verify and links open the web page. |
| `GENESIS_GROUP`, `TSKR_MINT`, `MAINNET_GENESIS_GROUP`, `MAINNET_SKR_MINT` | no | Deployment addresses; defaults are the devnet deployment and the real Seeker group / SKR. |
| `FAUCET_SOL_LAMPORTS`, `FAUCET_TSKR_UNITS`, `INDEXER_BACKFILL_LIMIT` | no | Faucet amounts (0.05 SOL, 1,000 tSKR) and how many recent program transactions a fresh indexer backfills (200). |

Keypair variables take a JSON byte array (Solana CLI format) or a base58 secret key. On Vercel use
the inline variant; locally the `_PATH` variant (a leading `~` is expanded).

## Run locally

```sh
pnpm install
pnpm --filter web keys          # creates keys/faucet.json and keys/crank.json, funds each with 0.5 devnet SOL
npx supabase start -x gotrue,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
cp apps/web/.env.example apps/web/.env.local   # set DATABASE_URL, CRON_SECRET, JWT_SECRET
pnpm --filter web dev
```

`supabase start` applies `supabase/migrations`. Without Docker, leave `DATABASE_URL` empty and the
server runs on an embedded PGlite with the same migrations (`pnpm --filter web db:migrate` applies
them to any `DATABASE_URL`).

Checks:

```sh
pnpm --filter web test          # unit + route tests on PGlite with recorded devnet/mainnet fixtures
LIVE_TESTS=1 pnpm --filter web test   # adds a real crank pass on devnet (payout, close_claims, close_packet)
pnpm --filter web typecheck
pnpm --filter web build
BASE_URL=http://localhost:3000 CRON_SECRET=... pnpm --filter web e2e   # full loop on real devnet
```

`scripts/e2e-devnet.ts` signs in two fresh wallets, uses the faucet, creates a circle and a
snapshot, drops a Lucky Seeker-only circle packet with the SDK, registers it, grabs it with the
member's Merkle proof and test Genesis token, waits for the VRF callback, runs `/api/cron/tick`
until the grab is indexed as paid, and checks the feed.

## Deploy

1. **Supabase**: create the project, then `npx supabase link --project-ref <ref>` and
   `npx supabase db push` (applies `supabase/migrations`, enables RLS, Realtime on `packets` and
   `grabs`). The app reads those two tables with the anon key over Realtime; everything else is
   reachable only through this API (service connection via `DATABASE_URL`).
2. **Vercel**: import the repo with root directory `apps/web` (framework Next.js, install command
   `pnpm install` at the repo root). Set the environment variables above. Function regions near the
   Supabase region.
3. **Helius webhook**: type *raw* (logs included; *enhanced* also works, it costs one
   `getTransaction` per signature), account `DifXuyhEu3r7sgXQjgCokyikQFcYCYD2cwhjNyU7j6XR`,
   network devnet, URL `https://<host>/api/webhooks/helius`, auth header = `HELIUS_WEBHOOK_SECRET`.
4. **Cron every minute** with Supabase `pg_cron` + `pg_net` (SQL editor, once):

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('bao-tick', '* * * * *', $$
     select net.http_post(
       url := 'https://<host>/api/cron/tick',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
       timeout_milliseconds := 55000
     );
   $$);
   ```

   Keep the secret out of git: paste it in the SQL editor, or store it in Supabase Vault and read it
   with `vault.decrypted_secrets`.
5. **Android**: pushes are data-only FCM messages the app draws itself, once, in the foreground and
   the background (`data.title`, `data.message`, `data.channelId`, `data.tag`, plus `data.kind`,
   `data.packet`, `data.url = bao://packet/<address>`). The app registers the channels `packets`,
   `rains` and `results`, and verifies App Links for `https://<host>/p/*` once
   `ANDROID_CERT_SHA256` is set.

## Notes

- The crank pays won Lucky shares (soonest-expiring packets first), cancels grabs whose randomness
  never arrived (after 300 slots), closes packets that are expired or fully resolved with nothing
  pending (`close_claims` in batches of 20 claim records, then `close_packet` with refund and crank
  reward), and closes lapsed Luck-King crowns. An unpaid win on an expired packet keeps being paid
  for an hour before a close may forfeit it. Each step is isolated, the tick stops starting new
  transactions after 40 s, and the result is returned as JSON.
- Circle packet messages are returned only to members of that circle (and the sender); the link page
  and signed-out reads show the amount without the message. Note that the anon Realtime policy on
  `packets` still exposes whole rows to holders of the anon key.
- The indexer decodes Anchor events (`Program data:` lines attributed to the Bao program on the
  invoke stack), upserts rows idempotently (a claim never moves backwards: pending → won → paid),
  re-reads packet accounts to mirror counters, and reconciles claims from chain accounts each tick.
- Rate limits are per server instance (in memory), enough to stop loops and casual abuse.
- The faucet deliberately lets anyone hold a test Genesis token on devnet so judges can run the
  full loop; the sybil property is shown by the program refusing grabs (see the repository README).
