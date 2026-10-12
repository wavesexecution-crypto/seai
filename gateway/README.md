# SEAI Shopify Gateway

Thin integration layer between **Shopify Admin** (embedded app), the existing
**SEAI platform** (https://www.seai.store — the **source of truth**, never
rebuilt), and the **Shopify GraphQL Admin API**.

The gateway owns only what SEAI should never own: Shopify OAuth/session
lifecycle, encrypted store-token storage, the Admin API proxy, and Shopify
webhooks. SEAI keeps all business logic, policy-gated tools, and the `/activity`
dashboard.

> **Status: Phases 2–5 — implemented.** Session-token auth, OAuth
> install/callback, store↔SEAI linking, GraphQL proxy, and webhooks are live
> behind tests. No production deployment yet; no secrets in the repo.

## Requirements

- Node.js **20 LTS** (`.nvmrc`-style polyfill: `engines.node = ">=20.0.0"`)
- npm 10+

## Quick start (local development)

```bash
cd gateway
npm install
cp .env.example .env        # fill in local values; .env is git-ignored
npm run dev                 # tsx watch — hot reload on src changes
```

Health checks:

```bash
curl http://localhost:3000/health        # liveness
curl http://localhost:3000/health/ready  # readiness (extended in later phases)
```

## Scripts

| Command              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `npm run dev`        | Dev server with watch (tsx)                      |
| `npm run build`      | Compile to `dist/` (tsc, NodeNext/ESM)           |
| `npm start`          | Run compiled `dist/server.js`                    |
| `npm run typecheck`  | Strict typecheck of `src` **and** `test`         |
| `npm test`           | Vitest (unit + HTTP integration via supertest)   |

## Environment variables

| Variable | Phase | Notes |
| --- | --- | --- |
| `NODE_ENV` | 1 | `development` \| `test` \| `production` |
| `PORT` | 1 | Default `3000` |
| `LOG_LEVEL` | 1 | pino level (`info` default) |
| `SHOPIFY_API_VERSION` | 1 | **Pinned `2025-07`** — matches SEAI backend contract |
| `SHOPIFY_API_KEY` | 2 | Shopify Partners client ID (public) |
| `SHOPIFY_API_SECRET` | 2 | Client secret — secrets store only |
| `SHOPIFY_API_SCOPES` | 2 | Comma-separated install scopes |
| `SHOPIFY_APP_URL` | 2 | Public gateway URL (deployment) |
| `SEAI_BASE_URL` | 3 | e.g. `https://www.seai.store` |
| `SEAI_API_BASE_URL` | 3 | SEAI backend/API base |
| `SEAI_WEBHOOK_SECRET` | 3 | Shared HMAC secret gateway ↔ SEAI |
| `SESSION_STORAGE_KEY` | 2 | 32-byte AES-256-GCM key (secrets store) |
| `GATEWAY_TOKEN_SIGNING_KEY` | 3 | 32-byte signing key (secrets store) |
| `DATABASE_URL` | 2 | PostgreSQL DSN |
| `REDIS_URL` | later | Optional cache / retry queue |
| `SENTRY_DSN` | later | Optional error telemetry |

`.env.example` contains variable **names only** with placeholders — it must
never contain real credentials, and `.env` is git-ignored.

## Project layout

```
gateway/
  src/
    server.ts            app bootstrap, health endpoints, mount points
    config.ts            env parsing + fail-fast validation (strict types)
    logger.ts            structured logging (pino)
    middleware/
      ledger.ts          request-id + access-log foundation (audit in Phase 3+)
      session-token.ts   [Phase 2] Shopify session-token auth (placeholder)
      hmac.ts            [Phase 2/3] webhook + callback HMAC (placeholder)
    routes/
      auth.ts            [Phase 2] OAuth install / callback
      embed.ts           [Phase 2/3] embedded iframe entry
      connect.ts         [Phase 3] store <-> SEAI account linking
      webhooks.ts        [Phase 3] Shopify webhook receiver
      graphql-proxy.ts   [Phase 4] Admin GraphQL proxy
    services/
      session-store.ts   [Phase 2] PostgreSQL session store
      crypto.ts          [Phase 2] AES-256-GCM at-rest encryption
      seai-client.ts     [Phase 3] SEAI backend HTTP client
      ticket.ts          [Phase 3] one-time SEAI ticket mint/verify
      graphql.ts         [Phase 4] Shopify GraphQL transport
      webhook-registrar.ts [Phase 3] webhook subscription sync
  db/migrations/         0001_init.sql — sessions/stores/webhook_deliveries
  test/                  Vitest suites
  Dockerfile
```

## Docker

```bash
docker build -t seai-shopify-gateway .
docker run --rm -p 3000:3000 --env-file .env seai-shopify-gateway
```

Multi-stage build: compile with `node:20-alpine`, run as non-root `node` user,
production dependencies only inside the image.

## Security posture (non-negotiable)

- Shopify access tokens: **only** server-side, AES-256-GCM encrypted at rest
  with keys from the platform secrets store. Never in logs, cookies, or the
  browser.
- The gateway never logs secret values; log base fields carry `requestId`.
- `SESSION_STORAGE_KEY` / `SHOPIFY_API_SECRET` / `GATEWAY_TOKEN_SIGNING_KEY`
  live in the environment, not in the repo.
- Later phases enforce: session-token validation, webhook HMAC, per-shop rate
  limiting, version pinning (`2025-07`).

## Roadmap

| Phase | Scope |
| --- | --- |
| 1 | Scaffold — structure, strict TS, health, logging |
| 2 | OAuth install/callback, session-token validation, tickets, embed |
| 3 | Store↔SEAI linking (signed claims, machine tokens, unlink) |
| 4 | GraphQL Admin API proxy, exchange, rate limiting |
| 5 | Webhooks (HMAC, idempotency, lifecycle + GDPR) |
| 6 | SEAI embed integration — SEAI-side changes only (not started) |
| 7 | Production infrastructure — pending production hostname (blocked) |
| 8 | Final hardening + dev-store end-to-end (partial; no live store yet) |

> This is a scaffold. Do not deploy, do not run `shopify app deploy`, and do
> not touch the SEAI production app until later phases are complete.