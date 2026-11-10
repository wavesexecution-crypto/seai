---
title: SEAI — Launch Checklist
updated: 2026-09-27T00:00:00.000Z
type: checklist
scope: seai
status: BLOCKED
provenance: user-provided sequence + code-verified blocker findings 2026-09-27
---

# SEAI — Launch Checklist

The ordered path to public launch. Steps are in dependency order — later steps assume
earlier ones. Status reflects **code evidence**, not optimism.

## Honest bottom line

**The project cannot launch today.** Three of the twenty steps are blocked by things
that do not exist, and two of those are the reason no customer could ever pay:

1. `seai.public` has **no checkout** — the funnel dead-ends at a form.
2. `seai.payments` **cannot boot or process a webhook** — five blocking defects.
3. CDF's **Vercel entrypoint is missing** — `api/index.ts` does not exist.
4. `seai.public` has **no git remote** — no backup, no rollback.

Nothing about this is hard to *describe*. All of it is straightforward to *fix*, but
steps 7–11 are real engineering work, not configuration.

## The sequence

| # | Step | Status | Blocker / note |
|---|---|---|---|
| 1 | Finish CDF | `IN PROGRESS` | Code is complete; worktree is dirty and uncommitted. See [[04 — CDF]] |
| 2 | Verify the dashboard | `VERIFY` | Not verifiable without a working deployment |
| 3 | Finish the email system | `COMPLETE` in code | Migration never run; no real delivery. [[09 — Email System]] |
| 4 | Finish the public site | `IN PROGRESS` | FOUC still open; carousel frame decision not implemented. [[06 — Public Site]] |
| 5 | Finish the six demos | `IN PROGRESS` | 7 pages exist, but `clinic.html` has **no images at all** (1 `<img>`, the logo). [[07 — Demo Sites]] |
| 6 | Resolve FOUC, navigation, CTA | `BLOCKED` | Google Fonts is still a blocking third-party request |
| 7 | **Integrate `seai.public` ↔ `seai.payments`** | `BLOCKED` | **Does not exist.** No Razorpay, no checkout, no API call. [[08 — Payments]] |
| 8 | Test all three plans end to end | `BLOCKED` | Depends on 7 |
| 9 | Verify Razorpay order create | `BLOCKED` | Service cannot boot without config validation. Defect 4 |
| 10 | Verify webhooks | `BLOCKED` | Request stream is double-consumed — **webhooks hang**. Defect 1 |
| 11 | Confirm confirmation emails | `BLOCKED` | Email pipeline complete but has no live producer. [[09 — Email System]] |
| 12 | Order → fulfilment handoff | `BLOCKED` | Depends on 7 |
| 13 | Security audit | `IN PROGRESS` | Code pass done, no live assessment. [[11 — Security]] |
| 14 | Production build | `VERIFY` | Builds clean locally in CDF; public site builds via Vite |
| 15 | Git freeze | `IN PROGRESS` | `D:\seai` has 14 modified + ~30 untracked paths. `seai.public` has **no remote** |
| 16 | Commit | `BLOCKED` | Do not commit `*.bak-*`, `*.old-*`, `server.log`, `screenshot-1280.png`, `.seai-data/` |
| 17 | Deploy the public site | `BLOCKED` | No remote to deploy from |
| 18 | Connect `seai.store` | `BLOCKED` | Depends on 17. Also resolve the `www` vs apex conflict. [[03 — Domains & Infrastructure]] |
| 19 | Production end-to-end test | `BLOCKED` | Depends on 7–18 |
| 20 | **Launch** | `BLOCKED` | |

## Critical path

Only three things stand between this project and a working sale:

**A. Make `seai.payments` trustworthy.**
Fix the webhook hang (use `express.raw` for that route), key idempotency on the Razorpay
event id instead of the event type, return non-2xx on handler failure so Razorpay
retries, add config validation, and add `UNIQUE (order_id)` on `payments` with a real
`Idempotency-Key` on `/payments/verify`. Then repair the test suite. Nothing about
payments can be trusted until these five are done.

**B. Wire `seai.public` to `seai.payments`.**
Create the order, redirect to Razorpay, handle the callback. The public site needs *some*
secrets to do this, which breaks its "static, no server" property — so decide
deliberately: a small serverless function to create orders, or a hosted checkout page.
Do not put Razorpay secrets in client-side JavaScript.

**C. Give CDF a deployment.**
Restore `api/index.ts`, or move off serverless functions to a long-running Node service.
Then fix `docs/DEPLOYMENT.md`, which currently tells an operator to configure OAuth to
the wrong host. **And** add the 10 missing `vercel.json` shell rewrites — without them
`/modify` and `/maintenance` 404 on Vercel, so a paying customer cannot request a change
or view their plan. That second fix is required even if the entrypoint is restored. See
[[16 — Client Dashboard]] and K-48.

## Do not launch without

- [ ] A real customer can pay ₹2,999 and receive a genuine Razorpay confirmation email.
- [ ] A second payment attempt for the same order **cannot** double-charge.
- [ ] `seai.payments` webhook replay is idempotent across restarts.
- [ ] The production database migration has been run **and verified**.
- [ ] `seai.store` and `dash.seai.store` resolve, with TLS, and the `www` question is
      decided.
- [ ] A real inbox has been eyeballed on desktop **and** mobile — logo image, dark
      mode, clipping, links.
- [ ] The exposed SMTP credential has been rotated.
- [ ] `seai.public` has a git remote with its two commits pushed.
- [ ] The four duplicated public price lists are consistent with payments, or generated
      from it.
- [ ] A named human has confirmed the canonical plan prices.
- [ ] `POST /api/customer/requests/:id/status` cannot be used by a customer to mark
      their own change `completed` — this is a confirmed defect, not a
      `[VERIFY]`, and it currently emails customers a false "done" notice.
- [ ] **On the deployed host**, a signed-in customer can open `/modify`, submit a change
      request, attach a file, see the reply thread, and open `/maintenance` — verified in
      the browser, not inferred from the local server. K-48 makes two of three sections
      404 while local dev passes.
- [ ] **Outbox relay is deployed and verified**: `seai.payments` polls `outbox_events` and POSTs `payment.successful`, `payment.failed`, `payment.refunded` to CDF `/api/internal/mail/events` with HMAC; `SEAI_EVENTS_SHARED_SECRET` configured in both services; end-to-end test sends a real payment confirmation email.
- [ ] **Public intake endpoint exists** (or form repointed): the INTAKE RECEIVED email fires when a prospect submits the public form. K-50 makes this currently impossible.

## Sequencing advice

Steps 1–3 and 13 can proceed in parallel with 7–10. **Do not spend more time on demo
polish (step 5) or the carousel frame until step 7 is underway** — the demos sell
nothing today because there is no way to buy.

## Related

- [[08 — Payments]] · [[10 — Deployment & Operations]] · [[11 — Security]] ·
  [[14 — Decisions Log]] · [[15 — Known Issues]]
