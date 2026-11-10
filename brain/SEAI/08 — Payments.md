---
title: SEAI — Payments
updated: 2026-09-27T00:00:00.000Z
type: system
scope: seai
status: BLOCKED
provenance: code-verified 2026-09-27
---

# SEAI — Payments (`D:\seai.payments`)

Razorpay wrapper and authoritative payment state for all of SEAI.

> ## Verdict: `BLOCKED` — roughly 60% of its own documented design
> The one-time website-purchase happy path is *written* but has **blocking defects**.
> The recurring/maintenance half **does not exist**. The entire outbound
> "notify the rest of SEAI" half **does not exist**. The test suite **cannot run**.
> The service has **never been shown to deploy**.

## Stack

TypeScript ESM, **Express 4**, Node >= 20. Deps: `express`, `cors`, `dotenv`, `pg`,
`razorpay`, `zod`, `uuid`, `pino`, `pino-pretty`. `tsc` build, Vitest, ESLint.
No `vercel.json`, no `Dockerfile`, no `render.yaml`/`fly.toml`, no serverless config —
**there is no deployment configuration of any kind in this repo.**

`payments.seai.store` appears in `.env.example:26` and `README.md` only. It is in **no
`.ts` source file**, so nothing is actually bound to that host.

## What is genuinely built

- Express skeleton: config loading, structured logging with request IDs, security
  headers, CORS, graceful shutdown, 404 and error handler.
- Postgres pool, query helpers, transactions, and a **6-function idempotency layer**.
- Complete **9-table schema** with a runnable (unsophisticated) migration script.
- Razorpay wrapper: order create/fetch, payment fetch, refund create/fetch, receipt IDs.
- **Order creation**: server-resolved pricing (client cannot send an amount), Razorpay
  notes, idempotency, an audit row, and an `outbox_events` row.
- **Payment verification**: HMAC signature check → server-side payment fetch → amount and
  currency cross-check → transactional finalisation. This is the correct shape.
- **Webhook endpoint**: raw-body HMAC-SHA256 verification with constant-time compare, and
  handlers for `payment.captured`, `payment.failed`, `order.paid` (stub),
  `refund.created`/`refund.processed`.
- State-machine tables (declared but unenforced).
- Plan listing, order lookup, customer payment history.
- 3 test files / 31 test cases.

## Blocking defects — the purchase flow cannot work as shipped

1. **Webhook requests hang.** `rawBodyMiddleware` + `express.json()` double-consume the
   request stream (`server.ts:100-103`). Empirically reproduced. Fix: use
   `express.raw({ type: 'application/json' })` for the webhook route only.
2. **Webhook idempotency is keyed on the event *type*, not an event *id***
   (`webhooks/razorpay.ts:74` + `payments.ts:590`). At most **one webhook per event type
   is ever processed, ever** — every subsequent `payment.captured` is silently dropped.
3. **Failed webhooks are never retried.** The leftover idempotency row causes a silent
   early return (`payments.ts:592-596`), and the handler always answers `200`
   (`webhooks/razorpay.ts:109`), so Razorpay believes delivery succeeded.
4. **The service cannot boot.** No `.env` in the repo and no config validation, so
   `new Razorpay({ key_id: '' })` throws `key_id or oauthToken is mandatory` at import
   (`razorpay.ts:7`).
5. **The test suite fails to collect** — 2 of 3 files fail; the third targets
   non-existent functions and tables and asserts the wrong response shape.

## Missing features

6. `GET /api/v1/payments/:id` is a hard-coded **501** (`routes.ts:199`).
7. **No refund initiation.** `createRazorpayRefund` is imported and never used
   (`payments.ts:21`). Customers cannot be refunded through this service.
8. **The whole maintenance/recurring subsystem is absent** — no `maintenance_subscriptions`
   table, no `createMaintenancePayment`, no `MaintenanceStatus`, no routes, no renewal
   job. The ₹457 plan (`config/index.ts:38`) is **unreachable dead config**, and CDF
   cannot bill what payments cannot sell.
9. **No outbox relay.** `outbox_events` is written and **never read**; nothing is ever
   published. This is the seam that would feed the CDF email intake, and the event names
   would not match even if a relay existed.
10. **No state-machine enforcement.** `assertValidOrderTransition` is never called;
    `checkout_started` is unreachable; arbitrary transitions are possible.
11. **No rate limiting**, no `Idempotency-Key` header support, no 409 conflict response,
    no idempotency-record janitor (`cleanupExpiredIdempotency` uncalled).
12. **Double-payment is possible.** No `Idempotency-Key` on `/payments/verify`; the key is
    derived from `verify_<paymentId>`, so a *second, different* `razorpayPaymentId` for the
    same order creates a second `payments` row and re-marks the order paid. There is no
    `UNIQUE` on `payments.order_id`.
13. **No amount validation on the webhook path.** `handlePaymentCaptured` trusts
    `paymentEntity.amount` and `.captured` without cross-checking the order.
14. **Redis nonce store not implemented** (`auth.ts:39`) — replay protection is
    per-process only, so it breaks across instances.
15. **Incomplete audit trail** — no rows for `payment.failed` or refunds; `actor_id` is
    always `NULL`; no request ID or IP recorded.
16. **No migration versioning** — no `schema_migrations`, no down-migrations.
17. **Empty `email` hard-coded for every new customer** (`routes.ts:90`).
18. **Order replay returns `undefined`** for `razorpayOrderId` and `amountPaise` on an
    idempotent retry (`payments.ts:287-296`).
19. **Bearer auth returns 500 instead of 401** on length mismatch (`auth.ts:101`).
20. **No health/DB-readiness check**, no metrics endpoint, no alerting wiring.
21. **Unbounded webhook body buffer** (`webhooks/razorpay.ts:118-122`).
22. **No test DB provisioning and no CI.**

## What it says about the rest of SEAI

Real coupling exists in exactly two places:

- **Service-key map** `middleware/auth.ts:29-37` — `seai.public` → `SEAI_PUBLIC_SERVICE_KEY`
  (and `seai` → `SEAI_SERVICE_KEY`, `config/index.ts:26`). This genuinely gates API access
  by calling-service identity.
- **Provenance stamping** `api/routes.ts:100` — `metadata.source_service` is written onto
  every order.

Everything else is identity labels, comments and CORS origins. CORS prod allowlist is
`['https://dash.seai.store', 'https://seai.store']` (`server.ts:86`) — the only
hard-coded public URLs in the source.

**`seai.payments` is not called by anything.** `D:\seai` names it in three comments only
(`src/mail/events.ts:11`, `src/config.ts:73`, `src/app.ts:128`), each describing an intake
it does not call. `D:\seai.public` does not reference it at all. Note CDF *does* have a
secret scanner rule for leaked Razorpay keys (`src/mail/safety.ts:133`,
`/\brzp_(?:live|test)_[A-Za-z0-9]{10,}/`) — that is a scanner pattern, not an integration.

## Pricing authority

`config/index.ts:33-35` holds the server-authoritative catalogue:
`starter` ₹2,999, `business` ₹4,999, `complete` ₹7,999, all `one_time` — matching the
public site exactly. `maintenance` ₹457 `recurring` is declared but unreachable.
Mirrored in `domain/types.ts:71-73`. See [[01 — Business Model]].

## Recommended order of work

1. Fix the webhook hang (1) — nothing else matters until webhooks can arrive.
2. Key webhook idempotency on the Razorpay event id (2) and return non-2xx on failure so
   Razorpay retries (3).
3. Add config validation and commit a safe `.env.example` (4) so the service boots.
4. Add `UNIQUE` on `payments.order_id` and a real `Idempotency-Key` on verify (12) —
   this is a money-loss defect, not a nicety.
5. Validate webhook amounts against the order (13).
6. Repair the test suite and add a test DB (5, 22) before any further feature work.
7. Build the outbox relay (9) and agree event names with CDF's
   `POST /api/internal/mail/events` contract.
8. Only then: refunds (7), maintenance (8), deployment config.

## Related

- [[01 — Business Model]] · [[02 — Architecture]] · [[09 — Email System]] ·
  [[11 — Security]] · [[13 — Launch Checklist]] · [[15 — Known Issues]]
