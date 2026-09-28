# SEAI client email system

Every client-facing email is rendered from one registry, sent through one pipeline, and recorded
in the database. Nothing in the app calls the mail provider directly.

- **Sender:** `SEAI <workwithseai@gmail.com>` (Gmail SMTP, App Password)
- **Links:** dashboard `https://dash.seai.store`, public site `https://seai.store`
- **Inventory:** 31 templates — 26 wired to a trigger, 5 reserved

## Architecture

```
auth / customer routes ─┐
operations webhooks ─────┼─> dispatchEmail ──> claimEvent ──> renderTemplate ──> SMTP
internal event intake ───┘         │               │               │
                                   │               │               └─ safety: escape, strip,
                                   │               │                  validate URLs, redaction
                                   │               └─ email_events (one row per business event)
                                   └─ email_deliveries (one row per provider attempt)
```

| File | Responsibility |
| --- | --- |
| `src/mail/types.ts` | Template metadata: category, required variables, wiring flag |
| `src/mail/registry.ts` | Single source of truth: validation, subject, render |
| `src/mail/context.ts` | Canonical variable names, defaults, formatting, interpolation |
| `src/mail/design.ts` | Responsive email blocks; HTML escaping and plain-text hardening |
| `src/mail/safety.ts` | Control stripping, URL validation, secret detection, redaction |
| `src/mail/urls.ts` | Every link the system is allowed to emit |
| `src/mail/transport.ts` | Nodemailer SMTP and the detailed send result |
| `src/mail/store.ts` | Catalog mirror, event claiming, dedupe, delivery history |
| `src/mail/dispatch.ts` | The pipeline. Never throws; always records |
| `src/mail/events.ts` | HMAC intake for authoritative server-to-server events |
| `src/mail/notify.ts` | Route-facing helpers (unchanged signatures) |
| `src/mail/fixtures.ts` | One preview fixture per template |
| `src/db/schema-email.sql` | `email_templates`, `email_events`, `email_deliveries` |

## Why sends fail closed

A template that is missing a required variable never reaches the provider. `renderTemplate` throws
`EmailRenderError`, `dispatchEmail` records a `failed` delivery with the reason, and the caller sees
`status: 'failed'`. Nothing half-renders, and no customer receives a broken email.

## Idempotency and retries

A **business event** is one row in `email_events`, keyed by a unique `dedupe_key` built from real
business identity — never from a timestamp or random value. A **delivery attempt** is a separate row
in `email_deliveries`.

That split gives the guarantee that matters: *at most one successful email per business event, and a
failure stays recoverable.*

| Situation | Result |
| --- | --- |
| Same key, already `sent` | `duplicate` — nothing sent |
| Same key, previous attempt `failed` | retried as attempt 2, 3, … up to `MAX_ATTEMPTS` (5) |
| Same key, attempt in progress | `duplicate` — the in-flight claim is honoured |
| Same key, `sending` for over 10 minutes | treated as a crashed process and retried |
| Same key, 5 attempts exhausted | `duplicate` — a bad destination cannot loop forever |
| `idempotent: false` (QA preview) | always sends, unique key per run |

This matters in production: if SMTP is down at the moment `maintenance.payment_required` fires, the
event stays `failed` and the operations webhook can safely replay it once the provider recovers. The
customer is not silently skipped.

## Authoritative events

Payment, maintenance, and deployment emails must not be triggered by anything a client can influence.
`POST /api/internal/mail/events` is the only entry point for them.

- Disabled entirely (HTTP 503) unless `SEAI_EVENTS_SHARED_SECRET` is set
- `x-seai-event-timestamp` must be within **5 minutes** of server time
- `x-seai-event-signature` is `hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))`, compared in constant time
- Body: `{ id, name, recipient, customer_id?, correlation_id?, variables? }`
- `id` is the caller's idempotency key; a replay returns `200 duplicate`
- Only wired templates in `website`, `maintenance`, `payment`, `service`, `change`, `account` may be triggered
- Rendering or provider failure returns 502/500 so the caller retries

Example signature:

```bash
TS=$(date +%s000)
BODY='{"id":"evt_1","name":"payment.successful","recipient":"client@example.com","variables":{"amount":"₹499","order_id":"ord_1"}}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SEAI_EVENTS_SHARED_SECRET" -hex | awk '{print $2}')
curl -X POST https://dash.seai.store/api/internal/mail/events \
  -H 'content-type: application/json' \
  -H "x-seai-event-timestamp: $TS" -H "x-seai-event-signature: $SIG" \
  -d "$BODY"
```

## Safety rules

1. **HTML** — user and webhook values are control-stripped, then escaped. `javascript:` URLs are rejected.
2. **Plain text** — tag-like constructs are removed, so an injected `<script>` can never appear as text.
3. **URLs** — only hosts from `urls.ts` are allowed. A localhost or preview host aborts the render.
4. **Logs and storage** — passwords, tokens, and API keys are redacted before anything is written.
5. **QA redirection** — `SEAI_MAIL_QA_RECIPIENT` sends every lifecycle email to one mailbox.
6. **Kill switch** — `SEAI_MAIL_EVENTS_ENABLED=false` stops the whole pipeline during an incident.

`npm run email:audit` is the executable form of rules 1–4 and runs in CI.

## Operating

```bash
npm run email:audit                                    # must pass before any release
npm run email:preview                                  # write .seai-preview/ (no mail sent)
npm run email:preview -- --send=qa@example.com         # real QA delivery, all 31 templates
npm run db:migrate                                     # apply schema (idempotent, safe to re-run)
npx tsx scripts/verify-reset-delivery.ts qa@example.com --yes   # real SMTP, end to end
```

Useful queries:

```sql
-- recent failures worth retrying
SELECT event_name, recipient, attempts, error, updated_at
FROM email_events WHERE status = 'failed' ORDER BY updated_at DESC;

-- full history for one customer
SELECT event_name, template, status, attempts, created_at
FROM email_events WHERE customer_id = $1 ORDER BY created_at DESC;
```

## Configuration

See `.env.example`. Required in production: `MAIL_SMTP_HOST`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASS`,
`APP_URL`, `PUBLIC_URL`. `SEAI_EVENTS_SHARED_SECRET` is required for payment/maintenance events.

## Adding a template

1. Add the definition to the right file in `src/mail/templates/`, with `wired: false` if nothing sends it yet.
2. Add required/optional variables to `context.ts` and give every one a default in `buildContext`.
3. Add a fixture in `src/mail/fixtures.ts` — one per template, no exceptions.
4. Run `npm run email:audit` and `npm run email:preview`.
5. Add a test that asserts the copy, then wire the trigger.
