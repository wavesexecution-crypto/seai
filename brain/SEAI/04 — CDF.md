---
title: SEAI — CDF (D:\seai)
updated: 2026-09-27T00:00:00.000Z
type: system
scope: seai
status: COMPLETE
provenance: code-verified 2026-09-27
---

# SEAI — CDF (`D:\seai`)

The Customer Dashboard / Fulfillment surface. Express 4 + TypeScript ESM + Postgres +
Shopify + Nodemailer. Node >= 20.

> **Correction — there is no React and no bundler.** An earlier draft of this note called
> the frontend a "React SPA shell". That was wrong. Verified 2026-09-27: `dependencies`
> are exactly `@shopify/shopify-api, cookie-parser, cors, dotenv, express, morgan,
> nodemailer, pg, zod`; there is no React, no Vite/webpack/esbuild, and no client
> framework of any kind. `build` is `tsc -p tsconfig.json && node
> scripts/copy-static.cjs` — a TypeScript compile plus a static-file copy into
> `dist/public`. The UI is **hand-written vanilla JavaScript** that builds DOM with
> `innerHTML` strings, and routing is hand-rolled via `history.pushState` + a `popstate`
> listener. It is an SPA in the loose sense only.
>
> This matters for security review: string-concatenated `innerHTML` means escaping is a
> per-callsite discipline, not a framework guarantee. See [[16 — Client Dashboard]] for
> the XSS audit, and [[11 — Security]].

> CDF is the **only** one of the three services that is internally wired end to end.
> It has real auth, real session scoping, a real customer control centre, a real Fana
> assistant and a real email system. That is also its scope: it is the relationship
> and fulfilment surface, **not** a payment collector.

## Stack

`package.json` — `@shopify/shopify-api` ^11.7.0, `cookie-parser`, `cors`, `dotenv`,
`express` ^4.21.2, `morgan`, `nodemailer` ^10.0.10, `pg` ^8.13.1, `zod` ^3.23.8.
Dev: `tsx`, `typescript` ^5.6.2, `vitest` ^2.1.3. Scripts: `dev` (tsx watch
`src/server.ts`), `build` (tsc + `scripts/copy-static.cjs`), `test` (vitest run),
`db:migrate`, `email:preview`, `email:audit`, `shopify:auth:verify`.

No Next.js. Static assets in `public/`, built output in `dist/`.

## Git state — 2026-09-27

- Branch `main`, remote `https://github.com/wavesexecution-crypto/seai.git`
- HEAD `29fdc7b feat: finalize SEAI client dashboard for production`
- Recent history is coherent and production-oriented:
  `29fdc7b` → `468df4c` (app store readiness: privacy/terms/support + GDPR) →
  `d87e7fc` (gateway base64url ticket HMAC) → `1a7c144` (gateway serves embed HTML at `/`) →
  `ec94be8` (embed test: delegated gateway ticket).
- **Worktree is dirty.** 14 modified + ~30 untracked paths, almost all of it the email
  system and Fana work (see [[09 — Email System]]). Nothing has been committed or pushed.
  Do not reset. Backups `shopify.app.toml.bak-*` / `.old-*` are untracked clutter.

## The customer control centre — `/api/customer`

Session-authenticated, and every handler is additionally scoped to `req.user!.id`.
Twelve routes:

| Route | Purpose |
|---|---|
| `GET /overview` | customer dashboard summary |
| `PUT /website` | register/update the customer's linked website |
| `GET /performance` | analytics view |
| `POST /connections` | connect an analytics source |
| `GET /requests` · `POST /requests` | change requests list / create |
| `GET /requests/:id` | one request detail |
| `POST /requests/:id/messages` | conversation reply |
| `POST /requests/:id/status` | **status transition** |
| `POST /requests/:id/attachments` | file upload |
| `GET /maintenance` · `POST /maintenance/activate` | maintenance plan state / activation |

`POST /requests/:id/status` is a **confirmed privilege defect**, not a `[VERIFY]`: the
handler validates against the five-status enum and checks ownership, but enforces **no
transition allow-list**, so a customer can mark their own request `completed` and
`notifyChangeStatus` then emails them a completion notice. The code comment above it
claims "limited client transitions". See [[15 — Known Issues]] K-20.

## Fana surface — `/api/fana`

`GET /conversation` returns this customer's own history only. Tool turns are persisted
but never returned to the browser — only user/assistant text (`routes.ts:27-32`).
`POST /chat` validates `{message}` with Zod (`min 1`, `max 2000`), returns 503 when
`NVIDIA_API_KEY` is absent, 502 on failure, and always a generic error string so no
internals leak. Full detail in [[05 — Fana]].

## Auth and sessions — solid

`src/auth/service.ts` and `src/auth/middleware.ts`.

- Password hashing: **scrypt** via `node:crypto`, `N=16384, r=8, p=1, keylen=64`,
  16-byte random salt, stored as `scrypt$<salt_hex>$<hash_hex>`. No external dependency.
- Password verification uses `timingSafeEqual` after a length check.
- Session tokens: `randomBytes(32).toString('base64url')`, stored **hashed** (SHA-256);
  raw tokens are never persisted.
- Session TTL 30 days; expired sessions are expired in-place rather than deleted.
- Separate hashed one-time tokens for password reset and email verification, each with
  its own TTL and a used-marker.
- Three middlewares: `requireAuth` (401 JSON), `optionalAuth`, `requireAuthRedirect`
  (SPA → `/sign-in`).

## Security headers

`src/app.ts:102-127` sets `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`,
`x-powered-by` disabled, and a CSP with `frame-ancestors 'self' https://*.myshopify.com
https://admin.shopify.com` — correctly replacing `X-Frame-Options` so Shopify can embed
the app. `script-src` allows `cdn.shopify.com` and `shopify-embed.shopifycloud.com`;
`'unsafe-inline'` is admitted for the dashboard shell's inline handlers. That is a
known, deliberate weakening — see [[11 — Security]].

## Route surface

25+ routes in `src/app.ts`: `/api/health`, `/api/models`, `/api/ai/validate`,
`/api/scopes`, `/api/stores`, `/api/agent/run`, `/api/runs*`, `/api/decisions`,
`/api/experiments`, `/api/tools`, `/api/portfolio*`, `/api/strategy`, `/api/onboard`,
`api/blueprint`, `/api/creation*`, `/api/admin/overview`, `/api/brain*`, plus the auth
pages, the Shopify `/embed` gateway exchange, and SPA routes
`/overview /command /activity /provider /tools /system /portfolio /creation /start`.

`vercel.json` rewrites all of those to `/index.html`. `/` redirects to `/overview`.

## The `gateway/` sub-service — a fourth deployable

`D:\seai\gateway` is a **separate Node service inside this repo**: name
`seai-shopify-gateway`, own `package.json`, `tsconfig.json` + `tsconfig.test.json`,
own vitest config, own `shopify.app.toml`, `Dockerfile`, `compose.yaml` (postgres),
`.dockerignore`, `src/`, `test/`, `dist/`, and its own **installed `node_modules`**.

It "owns Shopify OAuth sessions, encrypted store-token storage, the Admin GraphQL proxy
and webhooks for the existing SEAI platform (the source of truth)" (its own
`package.json` description). It is the component that holds `SEAI_ENCRYPTION_KEY` for
token encryption at rest. `shopify.app.toml` sends embedded-app traffic to
`https://gateway.seai.store/embed`, and `gateway/src/server.ts:169-170` hardcodes that
host.

`[VERIFY]` Which service is actually authoritative for Shopify auth — the gateway or
CDF — is not resolved by the code. `docs/DEPLOYMENT.md` implies CDF handles
`/auth/callback`; `shopify.app.toml` points the callback at the gateway. This is a
genuine ambiguity that must be settled before launch. See [[14 — Decisions Log]].

## Database

Nine schema files in `src/db/`: `schema.sql`, `schema-auth.sql`, `schema-blueprint.sql`,
`schema-creation.sql`, `schema-customer.sql`, `schema-email.sql`, `schema-embed.sql`,
`schema-fana.sql`, `schema-multistore.sql`. All nine parse cleanly.

`src/db/migrate.ts` runs `db.migrate()` then best-effort seeds six `ai_keys` rows
(`key_1`…`key_6`, `status: 'unknown'`). Migrations are **never** run at runtime.
`[VERIFY]` All nine applied against production — no live Postgres was reachable during
this audit.

## The client-facing dashboard

`public/` contains **two unrelated frontends**: `index.html` (36.6 KB, inline JS) is the
**client control centre** using `/api/customer/*` and `/api/fana/*`; `app.js` (53 KB) is
the **operator console** using `/api/admin/*` and friends. They share only static assets.
Full A-to-Z coverage — sections, tabs, data model, auth lifecycle, and the K-48 Vercel
routing blocker — is in [[16 — Client Dashboard]].

## The brain vault

`src/brain/vault.ts` resolves the vault to `D:\seai\brain`, name `SEAI VX`, with
`safePath()` blocking traversal and a secret filter on write. The app serves
`/api/brain` and `/api/brain/note` to read it. See [[10 — Deployment & Operations]] for
the production-persistence gap.

## Related

- [[02 — Architecture]] · [[05 — Fana]] · [[09 — Email System]] ·
  [[10 — Deployment & Operations]] · [[16 — Client Dashboard]] · [[15 — Known Issues]]
