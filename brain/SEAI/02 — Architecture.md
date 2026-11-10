---
title: SEAI — Architecture
updated: 2026-09-27T00:00:00.000Z
type: architecture
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27
---

# SEAI — Architecture

## Topology

Three independently deployed repos, plus a brain vault. There is no monorepo, no shared
package, and no build-time coupling between them.

```
┌─────────────────────────┐
│  seai.public            │  Vite 6 + React 19 + Tailwind 3 + GSAP
│  D:\seai.public         │  2 commits, no git remote
│  Target: seai.store     │  Static marketing + intake, no backend secrets
└───────────┬─────────────┘
            │
            │  ✗ INTENDED: order create → checkout → webhook
            │  ✗ ACTUAL:  no Razorpay import, no fetch, no SDK. ZERO references.
            ▼
┌─────────────────────────┐
│  seai.payments          │  Express 4 + TS ESM, Node >=20
│  D:\seai.payments       │  Razorpay wrapper, 9 tables, idempotency layer
│  Target: payments.seai.store [VERIFY]  │
└───────────┬─────────────┘
            │
            │  ✗ INTENDED: outbox_events → relay → POST /api/internal/mail/events
            │  ✗ ACTUAL:  outbox_events written but NEVER read. No relay exists.
            ▼
┌─────────────────────────┐
│  seai  (CDF)            │  Express 4 + TS ESM + Postgres, vanilla-JS UI (no React)
│  D:\seai                │  operator console + client dashboard
│  Targets: dash.seai.store / gateway.seai.store [VERIFY] │
│  git: main @ 29fdc7b, remote wavesexecution-crypto/seai │
│  ⚠ 2 of 3 client routes (/modify, /maintenance) 404 on Vercel — K-48 │
└───────────┬─────────────┘
            │
   ┌────────┴─────────┐
   │                  │
┌──▼───────────┐  ┌───▼──────────────┐
│ gateway/     │  │ brain/ (vault)   │
│ separate     │  │ D:\seai\brain    │
│ Node service │  │ Obsidian MD      │
│ OAuth +      │  │ gitignored       │
│ tokens +     │  │ NOT live state   │
│ GraphQL proxy│  └──────────────────┘
└──────────────┘
```

## Cross-service integration reality

This is the most important architectural fact. Both integration seams are **absent**:

| Seam | Intended | Actual | Evidence |
|---|---|---|---|
| public → payments | Create order, checkout | **Nothing.** No `seai.payments` reference, no Razorpay, no checkout code anywhere in `seai.public` | full-repo search |
| payments → seai | Publish outbox event → HMAC intake | **Nothing.** `outbox_events` is written, never read. No relay process. Event names would not match even if one existed | `payments.ts`; `schema.sql` |
| payments → public | Order status for the buyer | **Nothing** `[VERIFY]` | — |
| seai.payments CORS | allow `seai.store` + `dash.seai.store` | Present and correct | `server.ts:86` |
| seai.payments auth | service-key map, `seai.public` → `SEAI_PUBLIC_SERVICE_KEY` | Present | `middleware/auth.ts:29-37` |
| seai.payments provenance | stamp `metadata.source_service` on every order | Present | `api/routes.ts:100` |

So the architecture is *designed* as a clean three-service split with a shared-secret
event bus, but only the **CDF** service is actually connected to anything. The other
two talk to nobody.

## Trust boundaries

1. **Browser → CDF.** Session cookie → `requireAuth`. Every `/api` route except
   `/api/health` and `/api/auth/*` passes through the guard (`src/app.ts:155-158`).
   SPA pages use `requireAuthRedirect` and bounce to `/sign-in`.
   ⚠ **This boundary is authenticated but not authorised for one case:**
   `POST /api/customer/requests/:id/status` lets a customer set *any* of the five
   lifecycle statuses on their own request, including `completed` — there is no
   transition allow-list, despite the code comment claiming "limited client
   transitions" (`src/customer/routes.ts:228-241`). See [[15 — Known Issues]] K-20.
2. **Browser → seai.payments.** Bearer service key. `SEAI_PUBLIC_SERVICE_KEY` gates
   the public identity; a separate dashboard key exists. The calling service's
   identity is stamped onto the order — this is the real coupling between services.
3. **Server → seai.payments.** Not implemented. No outbound call from CDF to payments
   exists in `D:\seai`. `seai.payments` is named in three *comments only*
   (`src/mail/events.ts:11`, `src/config.ts:73`, `src/app.ts:128`), all describing an
   intake it does not call.
4. **Server → external.** Fana → NVIDIA (`integrate.api.nvidia.com/v1`); operator agent
   → Ollama Cloud (6-key pool) and/or Experiential Labs. Keys are server-side only.
5. **seai.payments → Razorpay.** Server-side only. Razorpay is never called from a browser.
6. **Ops → CDF events.** `POST /api/internal/mail/events` with HMAC, mounted
   **before** the session guard and before the shared body parser, and disabled
   entirely unless `SEAI_EVENTS_SHARED_SECRET` is set (`src/app.ts:128-142`).

## Data stores

| Store | Owner | Contents |
|---|---|---|
| Postgres `seai` | CDF | 9 schema files: auth/sessions, customer, websites, analytics, change_requests, maintenance_subscriptions, fana_*, multistore, email_* |
| Postgres `seai.payments` | payments | 9 tables: orders, payments, refunds, outbox_events, idempotency, webhooks, state-machine audit |
| Shopify | gateway | products, orders, inventory, customers, themes, content |
| `D:\seai\brain` | CDF | Markdown knowledge; gitignored; secret-guarded on write |

## CDF request path (the only working path today)

```
browser → Express (src/app.ts)
  ├─ ensureBoot()                      one-time bootstrap, failure-isolated
  ├─ /webhooks/:topic   → express.raw   Shopify webhooks, raw body preserved
  ├─ security headers + CSP            frame-ancestors allows Shopify admin
  ├─ /api/internal/mail → json+verify   HMAC intake, rawBody captured for signing
  ├─ express.json(1mb) + cookieParser
  ├─ /api/auth                          public (sign-in, reset, verify)
  ├─ /embed                             Shopify gateway ticket exchange
  ├─ /api/*          → requireAuth  ◄── session guard
  │    ├─ /api/customer                per-customer scoped
  │    └─ /api/fana                    per-customer scoped
  ├─ operator routes                   stores, runs, decisions, creation, brain
  └─ static public/ + SPA shell rewrites
```

## Big architectural risks

- **No shared source of truth for order state.** CDF has no orders table; payments
  owns orders; nothing syncs them. `[VERIFY]`
- **The brain is a write-only knowledge layer.** On Vercel it defaults to `/tmp/seai-brain`
  and is *ephemeral*. `docs/DEPLOYMENT.md` states outright: "Production persistence
  requires an external layer (not yet implemented)". This very knowledge base lives
  in a gitignored local folder and is not backed up.
- **Two Shopify app URLs** exist in the codebase for the same app — see
  [[03 — Domains & Infrastructure]].

## Related

- [[03 — Domains & Infrastructure]] · [[04 — CDF]] · [[05 — Fana]] ·
  [[08 — Payments]] · [[09 — Email System]] · [[10 — Deployment & Operations]]
