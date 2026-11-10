---
title: SEAI — Email System
updated: 2026-09-27T00:00:00.000Z
type: system
scope: seai
status: COMPLETE
provenance: code-verified 2026-09-27
---

# SEAI — Email System (`D:\seai`)

The canonical mail system for all of SEAI. Everything transactional goes through one
registry, one dispatch path, one delivery ledger.

> ## Verdict: `COMPLETE` in code, `BLOCKED` in production
> Typecheck, build, and 124 tests across 13 files pass. The audit passes under
> production URLs. **But** the production database migration has never been executed and
> **no real email has ever been delivered or verified in an inbox.** Do not call this
> finished in front of a customer.

## Inventory

- **31 templates** defined, **26 wired** to a real trigger, **5 reserved/unwired**.
  31 render fixtures. `npm run email:audit` reports no issues under
  `APP_URL=https://dash.seai.store`, `PUBLIC_URL=https://seai.store`.
- Source: `src/mail/` — `types.ts`, `registry.ts`, `context.ts`, `design.ts`, `safety.ts`,
  `urls.ts`, `transport.ts`, `store.ts`, `dispatch.ts`, `notify.ts`, `events.ts`,
  `fixtures.ts`, and `templates/` (`account`, `website`, `change`, `maintenance`,
  `payment`, `service`, `internal`).
- Docs: `docs/email-system.md`. Tools: `scripts/audit-emails.ts`,
  `scripts/preview-emails.ts`, `scripts/verify-reset-delivery.ts`.

## Design rules

1. **Registry validation at boot** — a template with undefined variables or an unknown
   trigger is a hard failure, not a runtime surprise.
2. **Canonical context + defaults**, so no template invents a value.
3. **Escaped HTML** with a plain-text fallback, always.
4. **URL safety** — links must resolve to approved production hosts;
   `SEAI_MAIL_ALLOW_DEV_URLS` is the explicit opt-out that must never be on in production.
5. **Secret detection and redaction** on the way out. Includes a dedicated Razorpay key
   pattern (`src/mail/safety.ts:133`).
6. **One business event, one email.** Idempotent by design.

## Authoritative event intake

`POST /api/internal/mail/events` — `src/mail/events.ts`, mounted in `src/app.ts:133-142`.

Mounted **before** the shared body parser and **before** the `/api` session guard,
because it authenticates with an HMAC signature instead of a cookie. A `verify` hook
keeps the raw bytes so the signature covers exactly what was signed.

- **Disabled entirely unless `SEAI_EVENTS_SHARED_SECRET` is set.**
- HMAC signature, **constant-time comparison**, **five-minute timestamp window**.
- Deduplicated on event id — one event, one email.
- `SEAI_MAIL_EVENTS_ENABLED` is a global kill switch for the client pipeline; delivery
  history is unaffected.
- Body limit 256 KB.
- Missing `status` is derived from unambiguous event names, and change-request statuses
  render as human labels (`Received`, `Reviewing`, `In progress`, `Waiting for your
  input`, `Completed`) rather than raw enums.

> **Relay implemented (2026-09-27).** `seai.payments/src/services/mail-relay.ts` polls `outbox_events`
> and POSTs `payment.successful`, `payment.failed`, `payment.refunded` to this intake
> with HMAC. Requires `SEAI_EVENTS_SHARED_SECRET` and `SEAI_MAIL_EVENTS_URL` in
> `seai.payments` env. The pipeline is now wired end-to-end; production enablement
> needs the shared secret set in both services and the relay enabled via
> `SEAI_MAIL_RELAY_ENABLED=true`. See [[08 — Payments]] K-32 → K-09.

## Delivery persistence and retries

`src/mail/store.ts` + `src/mail/dispatch.ts` + `src/db/schema-email.sql`.

- One `email_events` row per business event; **multiple `email_deliveries` rows** as
  attempts. This split is what makes retry auditable rather than destructive.
- `MAX_ATTEMPTS = 5`; `STALE_SEND_MS = 10 minutes`.
- **Sent** events are final — a second send is a duplicate, never a resend.
- **Failed** events may retry up to the cap. **Stale** sends (older than 10 min) may
  retry. Fresh `queued`/`sending` events are protected from concurrent double-send.
- `claimEvent` returns `{ claimed, duplicate, retried }` so callers can distinguish
  "someone else has it" from "already sent".

## Schema and migration

`email_templates` keyed on `id` (not `name`) with a unique index; `email_events.attempts`
`NOT NULL DEFAULT 1`; `email_deliveries` per attempt.

The upgrade path for an **old** `email_templates` table that has no `id` column is
idempotent: add `id`, backfill, and conditionally swap the primary key only when
`pg_constraint` reports `pk_col = 'name'`.

All nine SQL files in `src/db/` parse cleanly (validated with a Postgres parser).
**They have never been run against a live database** — no `psql`, no `DATABASE_URL`, and
no running Docker daemon were available. `npm run db:migrate` against production is an
unfinished step, not a formality. See [[13 — Launch Checklist]].

## Sender identity and URLs

| Setting | Value |
|---|---|
| From | `workwithseai@gmail.com` (`MAIL_FROM`), display name `SEAI` |
| Dashboard base | `APP_URL`, default `https://dash.seai.store` |
| Public base | `PUBLIC_URL`, default `https://seai.store` |
| Logo | `SEAI_MAIL_LOGO_URL`, defaults to `{APP_URL}/logo.png` — **must be an absolute https URL reachable without a login**, because Gmail proxies remote images |
| Support | `SEAI_SUPPORT_EMAIL`, defaults to `MAIL_FROM` |
| QA override | `SEAI_MAIL_QA_RECIPIENT` — set only for a real mailbox that must receive every preview |

Local `.env` currently has `APP_URL=http://localhost:3000`, so **any real send must
override `APP_URL` and `PUBLIC_URL` to the production hosts** or the emails will contain
localhost links.

## Removed bypasses

Two legacy paths were deleted rather than left to rot, because both could send outside
the registry:

- `src/mail/templates.ts` — an unreferenced, unsafe compatibility shim.
- `scripts/send-review-emails.ts` — a script that composed and sent mail directly,
  bypassing safety, idempotency and the delivery ledger.

No remaining raw `sendMail` callers or legacy template imports exist.

`scripts/verify-reset-delivery.ts` was rewritten onto the dispatch pipeline: it requires
an explicit `--yes`, needs real SMTP config, **never prints the reset token**, and can
redirect a real reset email to a QA mailbox for inspection.

## Safety switches

| Variable | Effect |
|---|---|
| `SEAI_MAIL_EVENTS_ENABLED=false` | Kill switch for the whole client pipeline |
| `SEAI_MAIL_QA_RECIPIENT` | Redirect sends to a QA mailbox |
| `SEAI_MAIL_ALLOW_DEV_URLS=true` | Permit non-production hosts in links — **never in production** |

## Outstanding

- **`syncTemplateCatalog()` is never called.** It is defined at
  `src/mail/store.ts:82` and has **zero call sites** repo-wide, and `email_templates`
  has **zero readers** — the table is a write-only mirror. So the catalogue table ships
  empty. Sending is unaffected, because the live registry is in code and the boot
  validation reads that. But the audit trail, any admin UI, and the `schema-email.sql`
  PK-swap migration all assume a populated `email_templates`. Call it from
  `db:migrate` (best-effort, as it is already written to swallow its own failures) or
  drop the table. Do not leave a mirror with no mirror.
- Production migration not executed.
- No real inbox verification: Gmail clipping, image proxying of the logo, mobile
  rendering, dark mode, and deliverability are all unproven.
- `.gitignore` covers `/.seai-preview/` so generated previews never get committed.

> **Security:** a local SMTP app password was exposed in an earlier tool output during
> this work. It must be rotated before any production send. Never record any of these
> values in this vault.

## Related

- [[04 — CDF]] · [[08 — Payments]] · [[10 — Deployment & Operations]] ·
  [[11 — Security]] · [[15 — Known Issues]]
