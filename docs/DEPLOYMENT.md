# SEAI production deployment (Vercel)

SEAI is an Express + TypeScript application (`src/`, built with `tsc` to `dist/`).
There is no Next.js layer. On Vercel it runs as a Node serverless function
(`api/index.ts`) wrapping the same Express app used locally (`src/server.ts`).

## Deploy steps

1. `npm install`
2. Set every environment variable below in the Vercel dashboard.
3. `npm run build` (Vercel `buildCommand`; output directory is `public/`).
4. Deploy. `vercel.json` rewrites all non-static routes to the function.
5. In the Shopify Partner dashboard, set the app URL to `https://seai.store`
   and the OAuth redirect to `https://seai.store/auth/callback`
   (see `shopify.app.toml`), then install the app into the store.

## Required environment variables

| Variable | Purpose |
|---|---|
| `OLLAMA_API_KEY_1` … `OLLAMA_API_KEY_6` | Six-key Ollama Cloud pool (server-side only, never exposed) |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Shopify OAuth app credentials (server-side only) |
| `SHOPIFY_APP_URL` | Canonical URL: `https://seai.store` |
| `DATABASE_URL` | **Required on Vercel.** Postgres connection string. Local disk is ephemeral on serverless — without this, sessions, runs, decisions and memory do not survive. |
| `SEAI_ENCRYPTION_KEY` | 32+ byte key for Shopify token encryption at rest |

## Optional

`SHOPIFY_API_VERSION`, `OPERATOR_NAME`, `AI_PRIMARY_MODEL`, `AUTONOMY_LEVEL`
(default `EXECUTE_SAFE`), `AGENT_MAX_ITERATIONS`, `AGENT_REQUEST_TIMEOUT_MS`,
`SEAI_SCHEDULER` (`on` forces the interval scheduler; default off on Vercel),
`SEAI_DATA_DIR`, `SEAI_BRAIN_DIR`, `PORT`.

## Shopify configuration still required (dashboard, not code)

- App URL `https://seai.store`, redirect `https://seai.store/auth/callback`.
- Request the scopes in `shopify.app.toml` (each documented in
  `src/shopify/scopes.ts` / `src/shopify/permissions.ts`).
- Webhook subscriptions (`orders/create`, `orders/updated`, `products/*`,
  `inventory_levels/update`, `customers/*`) pointing at `https://seai.store/webhooks/*`.
- A store becomes "Connected" only after real OAuth succeeds — typing a
  `myshopify.com` domain never authenticates.

## Serverless constraints (Vercel)

- **Function timeouts.** Long synchronous agent runs can exceed serverless
  execution limits. For heavy autonomous workloads use a plan with higher
  limits/fluid compute, or split work across requests.
- **No interval scheduler.** `SEAI_SCHEDULER` defaults off on Vercel. For
  daily/inventory/experiment jobs, add Vercel Cron Jobs that call the
  relevant HTTP endpoints.
- **Ephemeral filesystem.** Anything written to local disk disappears.
  `DATABASE_URL` (Postgres) is mandatory for real state.

## Brain persistence

The Obsidian brain (`src/brain/`) is SEAI's long-term knowledge layer:
human-readable Markdown, secret-guarded on write, scoped per store.

- **Local dev:** `D:\seai\brain` (gitignored, never committed).
- **Vercel:** the repo filesystem is read-only except `/tmp` (ephemeral), so
  `SEAI_BRAIN_DIR` defaults to `/tmp/seai-brain` there and the boot
  bootstrap is best-effort. All brain writes are failure-isolated and every
  agent run proceeds on live Shopify + Postgres state when the vault is
  unavailable.
- **Production persistence requires an external layer** (not yet implemented,
  deliberately — not silently faked). Options, in order of fit:
  1. **Vercel Blob** (`@vercel/blob`): store one object per note path
     (`brain/<rel>`), rewrite `brain/vault.ts` fs calls behind a storage
     interface. Preserves Markdown readability + HTTP access.
  2. **Postgres (existing `DATABASE_URL`)**: a `brain_notes(path PK, body,
     updated_at)` table with the vault as an export format. Simplest
     operationally; loses direct-file readability.
  3. **Git-backed vault**: commit notes to a private repo from the function
     (needs a deploy key + handles concurrency). Best audit trail, most moving parts.
- Until one of the above lands, treat brain notes on Vercel as a
  non-persistent cache: safe to run, unsafe to rely on across deploys.
