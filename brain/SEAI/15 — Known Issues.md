---
title: SEAI — Known Issues
updated: 2026-09-27T00:00:00.000Z
type: issues
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27
---

# SEAI — Known Issues

Every confirmed defect, with evidence. `BLOCKED` items prevent launch.

## Launch blockers

| ID | Issue | Repo | Evidence |
|---|---|---|---|
| **K-01** | **Public site has no checkout.** Zero references to `seai.payments`, zero Razorpay, no order creation. The funnel dead-ends at a form, so **no money can be collected** | `seai.public` | full-repo search |
| ~~K-02~~ **RESOLVED 2026-09-29** | **Webhook 500s — double-consumed stream.** `rawBodyMiddleware` attached `data`/`end` listeners that drained the request, then the global `express.json()` read the dead stream → `stream is not readable`, so **every webhook 500'd before the signature was ever checked**. Fixed by replacing it with `express.raw()`, which consumes the stream once. Live-verified: valid HMAC → `200`, invalid/empty/missing → `401` | `seai.payments` | `webhooks/razorpay.ts:117`; prod logs |`server.ts:100-103` |
| **K-03** | **Only one webhook per event *type* is ever processed**; idempotency is keyed on type, not event id. Handler always answers 200 and failures are never retried | `seai.payments` | `webhooks/razorpay.ts:74,109`; `payments.ts:590-596` |
| **K-04** | **Double-payment is possible.** No `Idempotency-Key` on `/payments/verify`; key derives from `verify_<paymentId>`, and there is no `UNIQUE` on `payments.order_id` | `seai.payments` | `payments.ts` |
| **K-05** | **Service cannot boot.** No `.env`, no config validation → `new Razorpay({key_id: ''})` throws at import | `seai.payments` | `razorpay.ts:7` |
| **K-06** | **Vercel entrypoint missing.** `docs/DEPLOYMENT.md` says the app runs as `api/index.ts`; that file and the `api/` directory do not exist. `vercel.json` has no `functions` config | `seai` | filesystem check |
| **K-07** | **`seai.public` has no git remote.** Two commits, no `origin`, no backup, no rollback | `seai.public` | `git remote -v` empty |
| **K-08** | **Production DB migration never executed.** No `psql`, no `DATABASE_URL`, no Docker daemon available | `seai`, `seai.payments` | environment |
| ~~K-09~~ **RESOLVED 2026-09-29** | **Outbox relay built and verified end to end.** `seai.payments/src/services/mail-relay.ts` publishes committed `outbox_events` to the CDF intake over HMAC-SHA256, with the event name mapped (`payment.success` → `payment.successful`). Delivery is a **post-commit hook** in `db.transaction()`, so an email failure can never roll back a PAID payment. Verified live: payments DB → outbox → HMAC → CDF → SMTP → **Gmail `250 2.0.0 OK`**, and a replayed event id produced no second email | `seai.payments` | `mail-relay.ts`, `db/db.ts`, `payments.ts` |
| **K-10** | **No real email ever verified in an inbox.** No Gmail clipping, logo-proxying, mobile, or dark-mode check | `seai` | — |
| **K-11** | **FOUC still open.** `index.html:26` loads Google Fonts as a blocking third-party stylesheet; the CSS inliner deliberately leaves external links alone | `seai.public` | `index.html:26`; `scripts/inline-page-css.mjs` |

## High

| ID | Issue | Repo | Evidence |
|---|---|---|---|
| K-12 | Webhook path trusts `paymentEntity.amount`/`.captured` with no cross-check against the order | `seai.payments` | `handlePaymentCaptured` |
| K-13 | Entire **maintenance/recurring subsystem missing** — no table, no routes, no renewal job. ₹457 plan is unreachable dead config, so CDF can display a subscription it cannot bill | `seai.payments` | `config/index.ts:38` |
| K-14 | No refund initiation — `createRazorpayRefund` imported, never used; no endpoint | `seai.payments` | `payments.ts:21` |
| K-15 | Redis nonce store not implemented; replay protection is per-process and breaks with >1 instance | `seai.payments` | `auth.ts:39` |
| K-16 | `GET /api/v1/payments/:id` is a hard-coded **501** | `seai.payments` | `routes.ts:199` |
| K-17 | No rate limiting anywhere in payments | `seai.payments` | — |
| K-18 | Test suite fails to collect — 2 of 3 files fail; the third targets non-existent functions/tables and asserts the wrong response shape | `seai.payments` | test run |
| K-19 | No CI and no test DB provisioning in payments | `seai.payments` | — |
| K-20 | **A customer can mark their own change request `completed`.** `POST /api/customer/requests/:id/status` accepts any of the five statuses; ownership is checked but there is **no transition allow-list**, despite the comment claiming "limited client transitions". `notifyChangeStatus` then emails the customer a completion notice. Defeats Fana's hard rule and corrupts the support record | `seai` | `src/customer/routes.ts:228-241` |
| K-21 | Destination of a completed intake is **unknown** — no backend in the public repo and no observed API call. Leads may be silently dropped | `seai.public` | — |
| K-22 | No deployment configuration of any kind for payments — no Dockerfile, no `vercel.json`, no host config | `seai.payments` | filesystem check |

## Medium

| ID | Issue | Repo | Evidence |
|---|---|---|---|
| K-23 | Unbounded webhook body buffer — memory-exhaustion vector. CDF's own intake correctly caps at 256 KB | `seai.payments` | `webhooks/razorpay.ts:118-122` |
| K-24 | Bearer auth returns **500 instead of 401** on length mismatch | `seai.payments` | `auth.ts:101` |
| K-25 | Order replay returns `undefined` `razorpayOrderId` / `amountPaise` on idempotent retry | `seai.payments` | `payments.ts:287-296` |
| K-26 | State machine unenforced — `assertValidOrderTransition` never called; `checkout_started` unreachable | `seai.payments` | — |
| K-27 | No migration versioning, no `schema_migrations`, no down-migrations | `seai.payments` | — |
| K-28 | Empty `email` hard-coded for every new customer | `seai.payments` | `routes.ts:90` |
| K-29 | Audit trail incomplete — no rows for `payment.failed` or refunds; `actor_id` always NULL; no request ID or IP | `seai.payments` | — |
| K-30 | No health/DB-readiness check, no metrics, no alerting | `seai.payments` | — |
| K-31 | No cleanup of expired idempotency records — `cleanupExpiredIdempotency` is uncalled; table grows unbounded | `seai.payments` | — |
| K-32 | CSP permits `'unsafe-inline'` for scripts, weakening it as a mitigating control | `seai` | `src/app.ts:119` |
| K-32b | `syncTemplateCatalog()` is defined but **never called** (zero call sites), and `email_templates` has **zero readers**. The catalogue table ships empty; sending is unaffected because the live registry is in code, but the mirror and the `schema-email.sql` PK-swap both assume it is populated | `seai` | `src/mail/store.ts:82` |
| K-33 | Carousel frame decision **not implemented** — rounded 1.1rem corners, translucent `rgba(10,10,11,0.09)` border, and an 8% box-shadow, versus the locked "sharp, black, no shadow" | `seai.public` | `fan-carousel.css:20-45` |
| K-34 | **The clinic demo is entirely imageless.** `clinic.html` (83 KB, fully authored) has **1** `<img>` tag — the logo — against 14 in `gym.html`. No `clinic` key in `scripts/demo-image-selection.json`, no `public/assets/demos/clinic/` directory, zero `/assets/demos/` references, nothing in `CREDITS.json`. It is linked from the homepage carousel, so a visitor reaches an imageless demo. Other demos are also under-filled (manifest slots vs committed files: restaurant 14/12, business 13/10, salon 10/9, real-estate 8/7) | `seai.public` | `examples/clinic.html`, `scripts/demo-image-selection.json` |
| K-35 | `www.seai.store` hardcoded in all three public legal pages and both `shopify.app.toml` files, violating the no-`www` decision | `seai`, `seai.public` | `privacy.html`, `terms.html`, `support.html`, `*.toml:80` |
| K-36 | `docs/DEPLOYMENT.md` names the wrong OAuth host and the wrong app URL; following it breaks Shopify OAuth | `seai` | `docs/DEPLOYMENT.md` steps 5-6 |
| K-37 | Two subsystems bypass the `config` layer and read `process.env` directly — Fana's model/endpoint and the scheduler's on/off guard. Fana's model cannot be set via the config surface or `/api/models` | `seai` | `src/fana/provider.ts:11-23`, `src/scheduler/jobs.ts:64-65` |
| K-38 | `fan-carousel.css:2` points to `card-fan-carousel.tsx` in the wrong folder (`ui/`, not `homepage/`) | `seai.public` | stale comment |

## Cosmetic

| ID | Issue | Repo | Evidence |
|---|---|---|---|
| K-39 | Double-encoded UTF-8 mojibake in two comments — 5-byte `C3 A2 E2 82 AC` sequences, i.e. a double-encoded U+2019. Comment-only, no BOM, no functional impact | `seai.public` | `src/css/fan-carousel.css:2,113` |
| K-40 | Untracked clutter in the CDF worktree: `shopify.app.toml.bak-421113757697`, `.old-421113757697` (×2 sets). Confirm ignored or delete before committing | `seai` | `git status` |
| K-41 | `optimize:demo-images` is a **Python** script in an otherwise Node/Vite project, and is not part of `build` | `seai.public` | `package.json` |
| K-42 | `support.html` is referenced by `docs/APP_STORE_LISTING.md` in CDF but not found in the `seai.public` root listing | cross-repo | — |

## Operational risks

| ID | Issue |
|---|---|
| K-43 | **A local SMTP app password was exposed** in an earlier tool output. **Rotate before any production send.** Never record credential values in this vault. |
| K-44 | `.vercel/backup-seai.env` is a plaintext env backup on disk. Gitignored, but still a liability — verify and restrict. |
| K-45 | `D:\seai` worktree is dirty: 14 modified + ~30 untracked paths, including all the email and Fana work. Nothing is committed or pushed. **Do not reset.** |
| K-46 | The brain vault is gitignored with **no production persistence** — `docs/DEPLOYMENT.md` states the external layer is "not yet implemented". This knowledge base has no backup. |
| K-47 | Local `.env` has `APP_URL=http://localhost:3000`, so any real send without overriding `APP_URL` and `PUBLIC_URL` produces emails full of localhost links. |
| ~~K-48~~ **WITHDRAWN 2026-09-29 — I WAS WRONG** | **Not a defect.** I claimed `/modify` and `/maintenance` 404 on Vercel because `vercel.json` lists only 9 of the 19 shell routes in `app.ts:197`. I inferred that from static config and **never tested the live URL**. Live test: both return `302 → /sign-in`, which is the correct auth guard. The Vercel project uses **Framework Preset "Express"**, which routes all paths to the serverless function, so the `vercel.json` rewrites are effectively redundant. The client dashboard navigation is healthy in production | `seai` | live `curl` 2026-09-29; `vercel project inspect seai1234` |
| K-49 | The client dashboard exposes GA4 / Search Console / PageSpeed / GBP performance and analytics tabs, but **no UI ever calls `POST /api/customer/connections`** — there is no "connect provider" control. The panels can therefore only ever render their empty state unless an operator wires connections by hand | `seai` | `public/index.html` (no call), `src/customer/routes.ts:116`, [[16 — Client Dashboard]] |
| **K-50** | **Public intake form submits to a non-existent endpoint.** `seai.public/src/intake.js:504` POSTs to `/api/intake`, which **does not exist in CDF**. `notifyWebsiteIntake` only fires from authenticated `PUT /api/customer/website`. The INTAKE RECEIVED email can never be triggered from the public site. Fix: either (a) add unauthenticated `POST /api/intake` to CDF with validation + rate limiting, or (b) wire the form to call the HMAC event intake directly | `seai.public` | `public/src/intake.js:504`, `src/customer/routes.ts` (no `/intake` route), `src/mail/notify.ts:78` |
| ~~K-51~~ **RESOLVED 2026-09-29** | **Every production email failed with `Dashboard URL must use https://`.** `APP_URL` in Vercel Production was not `https://dash.seai.store`, and the `urls.ts` guard correctly refused to build a localhost/insecure link. Nothing had ever been sent. Fixed by setting `APP_URL`, `PUBLIC_URL`, `SEAI_MAIL_LOGO_URL`, `SEAI_SUPPORT_EMAIL`, `SEAI_MAIL_EVENTS_URL` and `SEAI_EVENTS_SHARED_SECRET`. Live-verified: "Welcome to SEAI" and "Reset your SEAI password" both delivered `250 2.0.0 OK` | `seai` | prod `email_deliveries` (5 consecutive `failed` rows) |
| ~~K-52~~ **RESOLVED 2026-09-29** | **Serverless froze in-flight SMTP sends.** All six lifecycle triggers used `void dispatchEmail(...)`. Vercel freezes the function once the response is written, so sends were truncated and deliveries sat in `sending` with no provider message id. Fixed with `src/mail/pending.ts` plus a `res.json/send/end` wrapper that awaits the bounded drain **before the first byte is written** (`finish` is too late). Regression-tested in `tests/email-pending.test.ts` | `seai` | `mail/pending.ts`, `app.ts`, prod ledger |
| **K-53** | **Razorpay webhook secret is weak.** The live webhook secret is an 8-digit numeric value, which is trivially brute-forceable and offers no real protection on a money path. Rotate it in the Razorpay dashboard and set a high-entropy secret on both `seai.payments` and the Razorpay webhook config | `seai.payments` | Vercel env `RAZORPAY_WEBHOOK_SECRET` |
| **K-54** | **`seai.payments` has no test suite that runs.** 3 of 3 test files fail to even load (`Failed to load url ../src/domain/types.js`, plus tests that require Razorpay credentials that are not injected). `tsc` and the production build are clean and behaviour is verified live, but there is no automated regression net for the money path | `seai.payments` | `npx vitest run` → 3 failed suites |
| **K-55** | **`seai.payments` has no git remote.** The GitHub token in this environment cannot create repositories (`GraphQL: Resource not accessible by personal access token`), so the service is deployed from the local working copy via the Vercel CLI and is **not** under version control. Every deploy is a local push, not a reviewable commit | `seai.payments` | `gh repo create` → 403 |
| **K-56** | **No reaper for sends orphaned by a serverless freeze.** `STALE_SEND_MS` (10 min) is only consulted in `resolveExisting`, which runs when *the same dedupe key fires again*. There is **no sweeper and no Vercel cron** (`vercel.json` has no `crons`). For one-shot events (`account.welcome`, `account.password_changed`, `change.received`) the key never re-fires, so a truncated send is **permanently lost**. Live evidence: 4 `email_events` rows still `queued`/`sending` after ~22 h. Mitigated but not eliminated by K-52's drain (observed max send 0.798 s against an 8 s budget, so no new orphans since). Fix: persist the render variables on `email_events` and add a bounded sweep of stale `queued`/`sending` rows, driven by Vercel Cron | `seai` | live ledger query 2026-09-30; `mail/store.ts:62,144`; `vercel.json` |
| **K-57** | **12 expired, unused password-reset tokens are never purged.** `password_resets` has no garbage collector, so hashed-but-dead rows accumulate. Low risk (hashed, already expired) but it is unbounded growth of personal data. Fix: delete `used_at IS NOT NULL OR expires_at < now()` older than N days, on the same cron as K-56 | `seai` | live `password_resets` count 2026-09-30 |
| **K-58** | **`isValidRecipient` accepts a NUL byte.** The regex `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` allows `\u0000` inside a local part. Not exploitable for header injection (CRLF, comma lists and space lists are all correctly rejected) but it is an invalid address that should be refused at the edge | `seai` | `mail/dispatch.ts:63`; probe 2026-09-30 |
| **K-59** | **`GET /api/health` is unauthenticated and discloses internals.** Returns operator name, autonomy level, AI provider key count and per-key latency, and Shopify app-configured state. No secrets, but it is unnecessary reconnaissance surface on a production host | `seai` | live `curl /api/health` 2026-09-30 |
| **K-60** | **4 of 24 lifecycle events have no emitter at all.** `website.purchase_confirmed`, `website.ready`, `website.deployed`, `website.domain_connected` are templated and intake-reachable, but nothing in CDF or the payments relay posts them, so "purchase confirmation" and the website-status emails can never fire. The other unreached events (`maintenance.activated/payment_*`, `payment.pending`, `payment.receipt`) are correctly absent because no recurring billing or pending state exists | `seai` | emitter sweep 2026-09-30 |

## Recommended order

1. **K-02 → K-03 → K-04 → K-05** — make payments trustworthy. Money correctness first.
2. **K-01** — build the checkout path. This is what makes the site a business.
3. **K-06 → K-36** — restore the CDF entrypoint and fix the misleading doc.
4. **K-07 → K-45** — get both repos under version control with remotes.
5. **K-20** — add the transition allow-list. It is a few lines of code, and it is the
   difference between a customer being able to fake a "we completed your work" email
   and not. Do this before launch even though it is not on the money path.
6. **K-08 → K-10** — run the migration, then verify real email in a real inbox.
7. **K-18 → K-19** — repair the test suite and add CI, so steps 1–5 cannot regress.
8. **K-09** — build the outbox relay and agree the event contract with CDF.
9. K-11 → K-33 → K-34 — then, and only then, polish the public site and demos.
10. K-13 onward — recurring billing, refunds, and the remaining medium items.

> Steps 8 and 9 matter less than steps 1–3. Nothing sells today because there is no way
> to buy, so demo polish is not on the critical path.

## Related

- [[08 — Payments]] · [[10 — Deployment & Operations]] · [[11 — Security]] ·
  [[13 — Launch Checklist]] · [[14 — Decisions Log]]
