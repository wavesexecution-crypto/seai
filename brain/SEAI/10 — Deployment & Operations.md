---
title: SEAI — Deployment & Operations
updated: 2026-09-27T00:00:00.000Z
type: operations
scope: seai
status: VERIFY
provenance: code-verified 2026-09-27; live infrastructure unverified
---

# SEAI — Deployment & Operations

> **No live deployment was verified during this audit.** Nothing below is evidence that
> a host, DNS record, certificate or database currently exists. Treat every
> `[VERIFY]` as genuinely unknown.

## Targets

| Service | Intended | Config evidence | State |
|---|---|---|---|
| CDF | Vercel | `.vercel/project.json` → `seai1234`, `prj_18HoAx9XGDvtktU70f8KaGQPjteh` | `[VERIFY]` linked but deployment `BLOCKED` — see below |
| gateway | Docker | `gateway/Dockerfile`, `gateway/compose.yaml`, `.dockerignore` | `[VERIFY]` |
| Public site | Vercel / static | `.vercel/` present, gitignored; **no git remote** | `BLOCKED` — see below |
| Payments | none | **no deployment config exists** | `BLOCKED` |

## ✅ The Vercel deployment is LIVE — earlier "missing entrypoint" finding was WRONG

> **Correction (2026-09-29).** This note previously said the deployment was `BLOCKED`
> because `api/index.ts` was missing. **That was wrong.** I inferred it from
> `vercel.json` and never tested the live host. In fact `dash.seai.store` has been
> serving production traffic, and the project uses **Framework Preset "Express"**,
> which wraps the app without any committed `api/` directory.
>
> Live evidence: `/api/health` → `200` with `"driver":"pg"`, `"runtime":"vercel"`;
> `/` → `302 /sign-in`; `/overview` → `200` (34 KB shell); `/modify` and
> `/maintenance` → `302 /sign-in`; `/api/customer/overview` → `401`;
> `/api/internal/mail/events` → `401` without a signature. The database is Neon
> (`seai` / `neondb`), migrated with 39 tables including `email_events`,
> `email_deliveries`, `users`, `change_requests`, `maintenance_subscriptions`.

`docs/DEPLOYMENT.md` also contains a **second** error: it instructs the operator to set
the Shopify app URL to `https://seai.store` and callback `https://seai.store/auth/callback`,
while `shopify.app.toml` actually uses `https://gateway.seai.store`. Following the doc
would break OAuth. The document should be corrected before anyone follows it again. See
[[03 — Domains & Infrastructure]] and [[14 — Decisions Log]].

## Current production topology (verified 2026-09-29)

| Service | Vercel project | Domain | State |
|---|---|---|---|
| Public site | `seai.public` | `seai.store` | live, Vite/React, TLS ok |
| CDF | `seai1234` | `dash.seai.store` | live, Express preset, Neon `neondb` |
| Payments | `seai.payments` | `payments.seai.store` | live (newly deployed), Neon `seai_payments` |
| Storage | not on Vercel | — | `D:\seai.storage`, separate service |

`payments.seai.store` was created 2026-09-29 (CNAME → `vercel-dns-017.com`, TLS verified).
Its database is a **separate Neon database** (`seai_payments`) inside the same `seai`
project, so payments data is isolated from CDF data while sharing one Neon project.

> `www.seai.store` still has **no DNS record** even though the `seai.public` project
> lists it as a production URL. Decide apex vs `www` and either add the record or
> drop the alias.

## `vercel.json` rewrites are redundant, not broken

`src/app.ts:197` registers the app shell for 19 paths; `vercel.json` rewrites only 9.
That looked like a launch blocker (it was filed as K-48) but the Express framework
preset intercepts every path and hands it to the function, so the missing rewrites
never mattered. Verified live — see K-48. The rewrites may be trimmed or left alone;
they are not a correctness risk.

## Public site has no git remote

`D:\seai.public` has two commits and **no `origin`**. A production marketing site with
no upstream has no backup, no history, no review trail, and no way to roll back. Push it
before anything else in the launch sequence.

## Migrations

Never run at runtime. `docs/DEPLOYMENT.md` is explicit and correct here:

```
npm run db:migrate      # NODE_ENV=production, needs DATABASE_URL
```

`src/db/migrate.ts` calls `db.migrate()` then best-effort seeds six `ai_keys` rows
(`key_1`…`key_6`, `status: 'unknown'`). Nine schema files exist in `src/db/`; all parse
but **none has been applied to a live database** in this audit. `seai.payments` has its
own separate migration script and **no migration versioning** (no `schema_migrations`,
no down-migrations).

Run migrations in a controlled order, and take a backup first. `[VERIFY]` whether
production `DATABASE_URL` is even provisioned.

## Serverless constraints (Vercel)

- **Ephemeral filesystem.** Anything written to local disk disappears. `DATABASE_URL`
  is mandatory for real state — without it, sessions, runs, decisions and memory do not
  survive a cold start.
- **No interval scheduler.** `SEAI_SCHEDULER` defaults **off** on Vercel. Daily inventory
  and experiment jobs need Vercel Cron hitting HTTP endpoints, or an external scheduler.
- **Function timeouts.** Long synchronous agent runs can exceed serverless limits. The
  agent already has `AGENT_REQUEST_TIMEOUT_MS` (default 60000) and
  `AGENT_MAX_ITERATIONS` (default 12) to bound this, but a real long run can still hit
  the platform ceiling. Plan for higher limits or split work across requests.

## The brain vault has no production persistence

`src/brain/vault.ts` resolves the vault to `D:\seai\brain` locally, name `SEAI VX`.
On Vercel the repo filesystem is read-only apart from `/tmp`, so `SEAI_BRAIN_DIR`
defaults to **`/tmp/seai-brain`** — **ephemeral**. Writes are failure-isolated, so agent
runs proceed on live Shopify + Postgres state when the vault is unavailable, which is
the right failure mode.

But `docs/DEPLOYMENT.md` states outright: **"Production persistence requires an
external layer (not yet implemented)."** This knowledge base lives in a **gitignored**
local folder. It is not backed up, not versioned, and not replicated. If this vault is
the project's long-term memory, that gap must be closed deliberately — or the vault must
be explicitly reclassified as a local developer tool and the canonical knowledge kept
somewhere durable.

`[VERIFY]` Decide: external DB/Git-backed vault, or accept local-only.

## Runbook

### CDF (`D:\seai`)

```bash
npm install
npm run build            # tsc -p tsconfig.json && node scripts/copy-static.cjs
npm test                 # vitest run
npm run db:migrate       # requires DATABASE_URL
npm run dev              # tsx watch src/server.ts
npm run shopify:auth:verify
npm run email:audit
```

Email tooling, production URLs only:

```powershell
$env:APP_URL="https://dash.seai.store"
$env:PUBLIC_URL="https://seai.store"
npm run email:audit
npm run email:preview                                   # render only, no send
npm run email:preview -- --send=<real-mailbox>          # real send, explicit recipient
```

`--send` is a real send to every template (31). It is idempotent by default. Only run
it against a real mailbox, and only with the production URLs set. **Never run it
without an explicit human instruction.**

### Public site (`D:\seai.public`)

```bash
npm run dev
npm run build            # vite build && node scripts/inline-page-css.mjs
npm run typecheck
npm run sync:demo-css
npm run fetch:demo-images
```

`optimize:demo-images` is a **Python** script — a one-off that is not part of `build`.

### Payments (`D:\seai.payments`)

No deploy path exists. `npm run build` + `npm test` locally. Note the test suite is
currently broken (see [[08 — Payments]]).

## Local artifacts that must never be committed

`.env`, `.env.local`, `.vercel/` (which contains **`backup-seai.env`**), `server.log`,
`screenshot-1280.png`, `.seai-data/`, `.shopify/`, `.imgcache/`, `dist/`, `node_modules/`.
`brain/` and `.vercel/` are already gitignored. The `shopify.app.toml.bak-*` and
`.old-*` files currently sit **untracked in the working tree** — confirm they are
ignored or delete them before any commit.

## Related

- [[03 — Domains & Infrastructure]] · [[04 — CDF]] · [[11 — Security]] ·
  [[13 — Launch Checklist]] · [[15 — Known Issues]]
