---
title: SEAI — Security
updated: 2026-09-27T00:00:00.000Z
type: security
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27; no live assessment performed
---

# SEAI — Security

> **No penetration test, dependency audit, or live infrastructure review was performed.**
> This note is a code-reading pass. `seai.payments` has **no CI and no test DB**, so
> even its own regression safety net is absent.

## What is genuinely strong

Credit these — they are real and they were done deliberately.

**Auth in CDF is good.** `src/auth/service.ts`:
- **scrypt** password hashing via `node:crypto` — `N=16384, r=8, p=1`, 64-byte key,
  16-byte random salt, stored as `scrypt$salt$hash`. No third-party dependency.
- `timingSafeEqual` for verification.
- Session tokens from `randomBytes(32)`, stored **SHA-256 hashed** — raw tokens never
  persisted. 30-day TTL, expired sessions invalidated in place.
- One-time hashed tokens with their own TTLs for password reset and email verification.

**Fana is correctly scoped.** All seven tools filter on the session-derived `user_id`;
`get_change_request` filters on `{id, user_id}` together so a guessed UUID returns
"not found"; drafts are re-ownership-checked at submit. The browser never supplies a
customer or website id. The confirmation gate is enforced server-side
(`if (args.confirmed !== true) return {error: …}`).

**Fana fails safely.** Missing key → 503 before any model call; upstream errors → a
generic 502 that never leaks internals; unparseable tool JSON is swallowed, not fatal;
the 6-turn ceiling degrades to a neutral prompt rather than an error.

**Webhooks and the event intake use the right primitives.** CDF's
`/api/internal/mail/events` is HMAC-authenticated with constant-time comparison and a
five-minute window, is disabled without a secret, and is mounted *before* the session
guard and body parser with a raw-body `verify` hook. `seai.payments` verifies Razorpay
webhooks with raw-body HMAC-SHA256 and constant-time compare.

**Payments verification has the right shape.** Server-side payment fetch, then amount and
currency cross-check, then transactional finalisation — the client never asserts its own
amount. Order creation resolves pricing server-side, so a client cannot choose what it
pays.

**Secret hygiene in the mail pipeline.** `src/mail/safety.ts` scans and redacts, with a
dedicated Razorpay key pattern (`/\brzp_(?:live|test)_[A-Za-z0-9]{10,}/`). The brain
vault filters secrets on write and blocks path traversal.

**Headers.** CDF sets `nosniff`, `no-referrer`, COOP, CORP, Origin-Agent-Cluster, and
disables `x-powered-by`. The CSP correctly uses `frame-ancestors` (not
`X-Frame-Options`) so Shopify can embed the app, and `default-src 'self'`.

## Findings, ranked

### Critical — money

1. **Double-payment is possible in `seai.payments`.** No `Idempotency-Key` on
   `/payments/verify`; the key is derived as `verify_<paymentId>`, so a second distinct
   `razorpayPaymentId` against the same order inserts a second `payments` row and
   re-marks the order paid. There is **no `UNIQUE` constraint on `payments.order_id`**.
2. **Webhook amounts are not validated** (`handlePaymentCaptured` trusts
   `paymentEntity.amount` and `.captured` with no order cross-check).
3. **At most one webhook per event type is ever processed**
   (`webhooks/razorpay.ts:74` + `payments.ts:590`) — idempotency is keyed on event
   *type*, not event id. Combined with an always-`200` response and no retry, this
   means **payments can be lost silently**. See [[08 — Payments]].

### High

4. **`/api/internal/mail/events` has no live producer**, and `outbox_events` is never
   read. The email pipeline is complete but unconnected — see [[09 — Email System]].
5. **Replay protection is per-process.** The Redis nonce store is not implemented
   (`seai.payments/src/auth.ts:39`), so webhook replay defence breaks the moment a
   second instance runs.
6. **A customer can mark their own change request `completed`.**
   `POST /api/customer/requests/:id/status` accepts any of the five lifecycle statuses
   on the caller's own request. Ownership is checked (`ownedRequest`), but there is **no
   transition allow-list** — the code comment claims "limited client transitions" and the
   code does not implement it. `notifyChangeStatus` then emails the customer a
   completion notice for a change SEAI may not have made. This defeats Fana's core
   safety rule ("never claim completed unless the backend says completed") and is
   simultaneously a **support-desk integrity** problem: a customer's own action produces
   a "we finished your work" email. Fix by restricting the customer route to
   `waiting_for_client` and reopening, and letting only SEAI-side code advance the
   lifecycle. `src/customer/routes.ts:228-241` · [[15 — Known Issues]] K-20.
7. **Fana's confirmation gate is model-enforced, not transport-enforced.** `confirmed:
   true` is set by the model. There is no server-side nonce proving the customer
   actually consented. Adequate for V1, but it is a trust assumption, not a guarantee.
8. **No deployment configuration exists for `seai.payments`** — no Dockerfile, no CI,
   no rate limiting anywhere. An unrate-limited public API surface is the obvious target.

### Medium

9. **CSP permits `'unsafe-inline'` for scripts** in the dashboard shell, to support inline
   handlers. Combined with any injection flaw, that removes CSP as a mitigating control.
   Nonce- or hash-based CSP is the fix.
   > **This matters more than it looks.** Verified 2026-09-27: CDF has **no client
   > framework at all** — no React, no bundler, no auto-escaping. Both frontends build
   > DOM by concatenating `innerHTML` strings. Escaping is therefore a per-callsite
   > discipline rather than a framework guarantee, so `'unsafe-inline'` removes the one
   > backstop against a missed `esc()`. The client dashboard *was* audited and does
   > escape consistently (`esc()` on titles, descriptions, filenames, message bodies,
   > Fana output) — but the control that would catch the first regression is absent.
   > See [[16 — Client Dashboard]].
10. **Unbounded webhook body buffer** in `seai.payments`
    (`webhooks/razorpay.ts:118-122`) — a memory-exhaustion vector. CDF's own intake caps
    at 256 KB, which is the right pattern.
11. **Bearer auth returns 500 instead of 401** on length mismatch
    (`seai.payments/src/auth.ts:101`).
12. **Empty `email` hard-coded for every new customer** (`routes.ts:90`).
13. **Audit trail is incomplete** — no rows for `payment.failed` or refunds,
    `actor_id` always `NULL`, no request ID or IP recorded. Incident reconstruction will
    be hard.
14. **State machine unenforced** — `assertValidOrderTransition` is never called.

### Operational

15. **A local SMTP app password was exposed** in an earlier tool output during this work.
    **Rotate it before any production send.** No credential value belongs in this vault.
16. **`.vercel/backup-seai.env` sits in the working tree** at `D:\seai`. `.vercel/` is
    gitignored, but a plaintext env backup on disk is a liability — confirm it is
    ignored, restrict it, and rotate anything it contains.
17. **`seai.payments` cannot boot** — `new Razorpay({key_id: ''})` throws at import with
    no config validation, so a misconfigured deploy fails at startup rather than
    degrading.
18. **No dependency audit was run** on any of the three repos. `[VERIFY]` before launch.

## Before launch

- [ ] Fix findings 1–3. These are correctness-and-money defects, not hardening.
- [ ] Rotate the exposed SMTP credential.
- [ ] Confirm `.vercel/`, `.env*`, `*.log` are ignored in all three repos.
- [ ] Run a dependency audit (`npm audit`) on all three repos and triage.
- [ ] Constrain `POST /api/customer/requests/:id/status` transitions.
- [ ] Move CSP off `'unsafe-inline'`.
- [ ] Add the 10 missing `vercel.json` shell rewrites so `/modify` and `/maintenance`
      resolve on Vercel (K-48). Until then the customer UI is a 404 in production while
      local dev passes, which makes every other client-side test meaningless.
- [ ] Add rate limiting and a bounded body size to `seai.payments`.
- [ ] Get the test suites running — payments first, then CI.
- [ ] Commission a real pre-launch security review.

## Related

- [[04 — CDF]] · [[05 — Fana]] · [[08 — Payments]] · [[09 — Email System]] ·
  [[10 — Deployment & Operations]] · [[15 — Known Issues]]
