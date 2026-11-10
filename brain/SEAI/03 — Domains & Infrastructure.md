---
title: SEAI — Domains & Infrastructure
updated: 2026-09-27T00:00:00.000Z
type: infrastructure
scope: seai
status: VERIFY
provenance: code-verified hostnames 2026-09-27; DNS/ownership unverified
---

# SEAI — Domains & Infrastructure

## Every hostname found in code

Five distinct hostnames appear across the three repos. They do **not** agree with each
other or with the stated intent.

| Hostname | Where it appears | Purpose in code | Agreement with intent |
|---|---|---|---|
| `seai.store` | `seai.payments` CORS allowlist (`server.ts:86`); `seai` `config.publicUrl`; `docs/DEPLOYMENT.md` as the **app URL** | Public marketing site | ✅ matches intent |
| `dash.seai.store` | `seai` `config.appUrl` default (`src/config.ts:59,71`); all of `docs/email-system.md` | Dashboard base URL used to build every email link | ✅ matches intent, but see below |
| `gateway.seai.store` | **`application_url` and OAuth `redirect_urls` in `shopify.app.toml` and `gateway/shopify.app.toml`**; `gateway/src/server.ts:169-170`; `docs/APP_STORE_LISTING.md` | The *actual* Shopify embedded-app URL and OAuth callback | ❌ undocumented in the project brief |
| `www.seai.store` | `[app_preferences] url` in both `shopify.app.toml:80`; `public/privacy.html`, `public/terms.html`, `public/support.html`; `docs/APP_STORE_LISTING.md`; `gateway/README.md` | Shopify app home page + **all three public legal pages** | ❌ violates the "no `www`" decision |
| `payments.seai.store` | `seai.payments/.env.example:26`, `README.md` only | Intended payments API host | `[VERIFY]` — appears in **no** `.ts` source file |

> **No DNS, TLS, or registrar state was verified.** Nothing in this note proves any
> of these hosts currently resolves. All `seai.store` subdomains are `[VERIFY]`.

## The canonical-URL problem

There are three mutually exclusive answers to "what is the CDF URL?", all present in
`D:\seai` at once:

1. `src/config.ts:59` — `appUrl` defaults to **`https://dash.seai.store`**.
2. `shopify.app.toml:5,76` — the app is served from **`https://gateway.seai.store`**,
   with the OAuth callback on that host too.
3. `docs/DEPLOYMENT.md` — instructs the operator to set the Shopify app URL to
   **`https://seai.store`** and callback `https://seai.store/auth/callback`.

Only #1 matches the intended architecture. #2 and #3 are stale or wrong, and #2 is what
Shopify would actually be configured with if someone ran the CLI from this repo today.

`docs/DEPLOYMENT.md` is **actively misleading** and should be corrected. Recorded as a
locked-target vs observed-implementation conflict in [[14 — Decisions Log]].

### The `www` violation

`[app_preferences] url = "https://www.seai.store"` and the three legal pages hardcode
`https://www.seai.store`. The project decision is no-`www`. If `seai.store` is
canonical, the legal pages are currently serving URLs under a host the project does not
intend to own. `[VERIFY]` whether `www` resolves and whether it redirects.

## Deploy targets

| Service | Target | Evidence |
|---|---|---|
| CDF | Vercel | `.vercel/project.json` → project `seai1234`, `prj_18HoAx9XGDvtktU70f8KaGQPjteh`, org `team_4yzMS5Im7cXCms5w6U4iWsR`. `vercel.json` present |
| CDF | Shopify app | `shopify.app.toml`, `embedded = true`, `api_version = 2025-07` |
| gateway | Docker | `gateway/Dockerfile`, `gateway/compose.yaml` (postgres service), `gateway/.dockerignore` |
| seai.payments | none found | No `vercel.json`, no `Dockerfile`, no `render.yaml`, no `fly.toml`, no serverless config. Host is referenced only in docs `[VERIFY]` |
| brain vault | local only | `D:\seai\brain`, gitignored. On Vercel defaults to `/tmp/seai-brain` = ephemeral |

## The Vercel deployment is probably broken

`docs/DEPLOYMENT.md` states: *"On Vercel it runs as a Node serverless function
(`api/index.ts`) wrapping the same Express app used locally (`src/server.ts`)."*

**`D:\seai\api\index.ts` does not exist. The `api/` directory does not exist.**
`vercel.json` contains only `buildCommand` and SPA `rewrites` — no `functions`, no
`outputDirectory`, no `routes` entry. As committed, a Vercel deploy would build the
TypeScript and serve static assets, but there is no serverless entrypoint to serve the
Express app. This is a **launch blocker**. See [[10 — Deployment & Operations]].

## Infrastructure inventory

- **Postgres** — mandatory. `DATABASE_URL` is required on Vercel because local disk is
  ephemeral; without it, sessions, runs, decisions and memory do not survive.
  `[VERIFY]` production connection string, backups, pooling.
- **Migrations** — never run at runtime. `npm run db:migrate` must be executed manually
  against production. `src/db/migrate.ts` calls `db.migrate()` then seeds 6 `ai_keys` rows.
- **Local artifacts present but untracked** — `.env`, `.env.local`, `.vercel/` (contains
  `backup-seai.env`), `server.log`, `screenshot-1280.png`, `.seai-data/`, `.shopify/`,
  `.imgcache` (public repo). `.vercel` and `brain` are gitignored; confirm the others are too.
- **Model providers** — NVIDIA (`integrate.api.nvidia.com/v1`) for Fana; Ollama Cloud
  (`https://ollama.com`, 6-key pool) and Experiential Labs
  (`https://api.experientiallabs.ai/v1`) for the operator agent stack.

## Required environment variables (names only — never values)

`DATABASE_URL`, `SEAI_ENCRYPTION_KEY`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
`SHOPIFY_APP_URL`, `SHOPIFY_API_VERSION`, `SHOPIFY_SCOPES`, `NVIDIA_API_KEY`,
`NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `OLLAMA_API_KEY_1`…`OLLAMA_API_KEY_6`,
`EXPLABS_API_KEY`, `EXPLABS_BASE_URL`, `AI_PRIMARY_MODEL`, `AUTONOMY_LEVEL`,
`AGENT_MAX_ITERATIONS`, `AGENT_REQUEST_TIMEOUT_MS`, `SEAI_GATEWAY_SECRET`,
`SEAI_BRAIN_DIR`, `SEAI_DATA_DIR`, `SEAI_SCHEDULER`, `PORT`, `OPERATOR_NAME`,
`MAINTENANCE_PRICE_INR`, `MAINTENANCE_CURRENCY`, `MAINTENANCE_PLAN_NAME`, `MAIL_FROM`,
`MAIL_FROM_NAME`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_SECURE`, `MAIL_SMTP_USER`,
`MAIL_SMTP_PASS`, `APP_URL`, `PUBLIC_URL`, `SEAI_MAIL_LOGO_URL`, `SEAI_SUPPORT_EMAIL`,
`SEAI_EVENTS_SHARED_SECRET`, `SEAI_MAIL_EVENTS_ENABLED`, `SEAI_MAIL_QA_RECIPIENT`,
`SEAI_MAIL_ALLOW_DEV_URLS`. In `seai.payments`: `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SEAI_PUBLIC_SERVICE_KEY`,
`SEAI_DASHBOARD_SERVICE_KEY`, `DATABASE_URL`, `NODE_ENV`, `PORT`, `LOG_LEVEL`.

## Related

- [[02 — Architecture]] · [[10 — Deployment & Operations]] · [[11 — Security]] ·
  [[14 — Decisions Log]] · [[15 — Known Issues]]
