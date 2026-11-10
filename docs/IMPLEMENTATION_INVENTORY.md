# SEAI — Implementation Inventory (Business Transformation)

Date: 2026-11-06 · Scope: D:\seai (this repo), D:\seai.public (public site), D:\seai.payments (Razorpay control plane), D:\seai.storage (file storage)
Blueprint reference: `SEAI_BUSINESS_BLUEPRINT.html` (v1.0, Oct 2026)

Legend: ✅ implemented & verified · 🟡 partial · ❌ missing · 🔴 broken · 🔌 external integration required · 🧑 human/operational process required

## 0. What already exists (do not rebuild)

- ✅ Express + TypeScript backend, PostgreSQL with disk-backed fallback (`src/db/db.ts`), idempotent `schema*.sql` migrations via `npm run db:migrate`
- ✅ Auth: sign-up/in/out, email verification, password reset, session cookies (`src/auth/*`) — roles: customer only + shared staff key (`SEAI_STAFF_API_KEY`)
- ✅ Customer dashboard ("Customer Control Centre", `public/index.html`): Overview (website/performance/analytics — honest empty states), Modify (change requests, attachments, messaging), Maintenance (₹457/mo — honestly `pending_payment`, never fakes active)
- ✅ Mail pipeline: nodemailer SMTP, 32 templates, idempotent `email_events`/`email_deliveries`, HMAC intake `/api/internal/mail/events`, cron reaper
- ✅ Pre-purchase public intake (`POST /api/intake`, rate-limited, honeypot, persists to `intakes`, emails ops inbox) — website-order fulfilment brief
- ✅ Payment provisioning hook (`provisionPaidOrder`): creates/links user + `customer_websites` on authoritative `payment.successful` event; idempotent
- ✅ Storage proxy (`/api/storage/*`) — uploads held in seai.storage, DB stores file ids only
- ✅ Public site (`D:\seai.public`): React/Vite static site, 7 demo websites (`examples/*.html`), pricing + intake pages, Razorpay checkout for one-time website orders via `/api/payment/*` proxy
- ✅ Razorpay integration lives in `D:\seai.payments` (Express + `razorpay`, server-side pricing, HMAC webhooks) — but only one-time orders; **no subscriptions**; not called by any checkout today except seai.public's order proxy; known defects (webhook hang, idempotency keyed on event type)
- ✅ 21 test files / ~288 assertions (`tests/`), all passing on the disk-backed store
- 🟡 vercel.json rewrites miss `/modify`, `/maintenance` → client dashboard unreachable on Vercel (fix in Phase 7/10)
- 🟡 Dockerfile header references non-existent RESEND_API_KEY; docker-compose uses `seai_payments_test`; docs/DEPLOYMENT.md references non-existent `api/index.ts`
- 🔴 Operator API surface (`/api/agent/run`, `/api/portfolio`, `/api/creation/*`, `/api/admin/overview`…) guarded only by customer session — no staff role separation (fixed in Phase 1 RBAC)

## 1. Public website (Part 3)

| Item | Status | Notes |
|---|---|---|
| Homepage (growth positioning, tagline) | ❌ | seai.public positions "AI-built websites"; full rewrite in Phase 2 |
| Services pages (7 categories) | ❌ | Will be `services.html` + detailed sections, links from nav |
| Industries pages (10) | ❌ | `industries.html`; demo sites reused as proof (no fabricated results) |
| Pricing (retainers ₹7,999/14,999/29,999, configurable) | 🟡 | Existing pricing.html is one-time website pricing; rewrite with separate fee/ad budget/3rd-party costs; no outcome guarantees |
| Contact / consultation form | ❌ | Build `contact.html` → `POST /api/growth/inquiry` (Phase 3) |
| Testimonials/case studies | ❌ (by design) | None genuine available → section omitted; no fabrication |
| Demo websites | 🟡 | 7 exist (gym/restaurant/salon/clinic/real-estate/business/cafe); reused, not duplicated |

## 2. Client acquisition / CRM (Part 4)

| Item | Status |
|---|---|
| Leads table, 11 stages, full field set | ❌ Phase 4 |
| Lead search / filter / sort / profiles | ❌ Phase 4 |
| Activity history + follow-up reminders | ❌ Phase 4 |
| CSV export / duplicate detection | ❌ Phase 4 |
| CSV import | ❌ Phase 4 |
| PDF import w/ text extraction | ❌ Phase 4 (`pdf-parse`) |
| OCR for scanned PDFs | ❌ **not implemented** — scanned PDFs detected (empty text layer) and rejected with explicit message. 🔌 OCR (tesseract) explicitly out of scope; no fake support |
| Lead import persistence | ❌ Phase 4 (`intakes` is an order brief, not a CRM — will not repurpose) |

## 3. Client onboarding (Part 5)

| Item | Status |
|---|---|
| Configurable sections by purchased services | ❌ Phase 5 |
| Mandatory/optional + why-each-field | ❌ Phase 5 |
| Save & resume + progress % | ❌ Phase 5 |
| Secure asset upload | 🟡 reuse patterns; inline base64 capped 2 MB (`onboarding_assets`), documented; seai.storage remains the file sink when configured |
| Never raw passwords/cards | ✅ (policy; UI states invites only) |
| Delegated platform invitations | 🧑 human operational step (send BM/Google/CRM invites); system tracks status per invite |

## 4. Client dashboard (Part 6)

| Item | Status |
|---|---|
| Overview (active services, projects, deliverables, AM, billing, approvals) | 🟡 existing shell + Phase 6 additions |
| Projects (name, category, status, team, dates, deliverables) | ❌ Phase 6/8 |
| Content approvals (preview, caption, version, approve/reject, feedback) | ❌ Phase 6/8 |
| Advertising reports | 🔌 Meta/Google/GA4 not connected → UI shows "manually entered / unavailable" labels; `analytics_snapshots` exists but no connectors 🧑; no fabricated metrics |
| Billing (subscription, invoice, history, next billing, outstanding, download) | ❌ Phase 9 |
| Communication (support requests, discussions, notifications) | 🟡 change-request messaging exists; Phase 6 adds support requests + notifications |

## 5. Staff command dashboard (Part 7)

| Item | Status |
|---|---|
| Authenticated staff UI | ❌ Phase 7 (`/staff`, new `public/staff.html`) |
| Business overview metrics (clients, pipeline, MRR, outstanding, renewals, projects) | ❌ Phase 7 |
| Client management (directory, profiles, agreements, assignments, onboarding status) | ❌ Phase 7 |
| Sales management (pipeline, follow-ups, conversion) | ❌ Phase 7 |
| Delivery management (projects, tasks, deadlines, approvals, workload) | ❌ Phase 7/8 |
| Financial management (MRR, one-time rev, expenses, gross/operating profit, outstanding) — **ad budgets excluded from revenue** | ❌ Phase 7/9 |
| RBAC: admin/sales/account_manager/marketing/designer/developer/finance | ❌ Phase 1 (`users.role`) + enforced on every staff route; admin UI to grant roles |

## 6. Service delivery engine (Part 8)

| Item | Status |
|---|---|
| Workflow templates (advertising, social, website, lead-gen, onboarding→launch) | ❌ Phase 8 |
| Task creation w/ owner, due dates, dependencies, approval gates, completion, activity history | ❌ Phase 8 |
| "Campaign launched"/"content published" claims | ✅ honest: statuses only change via verified action (staff marks launched/published with confirmation) or platform integration when present; never auto-claimed |

## 7. Recurring revenue (Part 9)

| Item | Status |
|---|---|
| Subscriptions via Razorpay (genuine flow) | ❌ Phase 9 — extend `D:\seai.payments` (orders → subscriptions), plans created server-side |
| Configurable plans (₹7,999/14,999/29,999 + custom agreements) | ❌ Phase 9 (config in one place) |
| One-time project charges | ✅ exists (one-time orders) — reuse |
| Invoice generation, numbering, GST fields, payment status, renewal dates, cancellation & failure handling | ❌ Phase 9 |
| Payment history / downloadable invoices | ❌ Phase 9 (HTML print-to-PDF download; no new heavy PDF dep) |
| Ad budgets collected/accounted separately | ❌ Phase 9 — invoices typed `ad_budget`, excluded from service revenue/MRR; client pays platforms directly per blueprint |
| Dunning / payment failure | 🔌 Razorpay webhook events (charged/halted/cancelled) handled in payments repo; email via mail pipeline |

## 8. Human / external dependencies (not code)

- 🧑 Razorpay live keys + KYC; sandbox keys for integration testing (none available in this session — subscription code is unit-tested with mocked gateway, same pattern as existing provision tests; **do not claim live charging verified**)
- 🧑 Meta Business Manager / Google Ads / Analytics / GTM access invites (per blueprint)
- 🧑 DNS/domain for seai.store / dash.seai.store (client-side changes, Vercel env vars)
- 🧑 Sales operations: discovery calls, outreach, follow-ups (blueprint §4)
- 🔌 Live ad metrics require Meta/Google Ads API access + approved app review — not implemented; reports show operator-entered or "unavailable"

## 9. Execution order & verification

P1 schema+RBAC → P4 CRM (core engine) → P5 onboarding → P8 delivery engine → P9 billing → P6 client dashboard → P7 staff dashboard → P2/P3 public site → wiring → tests → build → report.

Verification per phase: `npm run db:migrate` (fallback), `npm test`, `npm run build`; manual route smoke via `npm run dev` where relevant.

## 10. Shipped state (2026-11-08, post-build verified)

- ✅ Public site (D:\seai.public): repositioned to marketing/advertising/growth. New `services.html` (7 services × 8 fields), `industries.html` (10 industries), `pricing.html` (Starter/Growth/Scale retainers + four-bucket money separation), `contact.html` (working inquiry → `POST /api/growth/inquiry` → persisted + pipeline lead + ops email), homepage rewrite. No AI-marketing language for clients. **Fixed two real bugs**: page modules never mounted (pricing/examples were blank), homepage claimed fabricated metrics (500+/183K/98%) — now removed; testimonials section intentionally omitted.
- ✅ Inquiry workflow (D:\seai): `POST /api/growth/inquiry` (rate-limited, honeypot) → `growth_inquiries` row → auto-create/link CRM lead by email/phone/name dedupe → internal ops email via the audited mail pipeline.
- ✅ CRM (D:\seai): 11-stage pipeline, search/filter/sort/paginate, profiles, activity log, follow-up due list, CSV export, duplicate detection (email/phone/business name), CSV import + PDF text extraction (`pdf-parse`). **Scanned PDFs are rejected with an explicit message — OCR is not implemented and never claimed.** Imports persist via `lead_imports`.
- ✅ Onboarding (D:\seai): `onboarding-schema.ts` encodes blueprint §5 (8 sections, mandatory/optional + why per field, service-scoped). Save/resume per section, live completion %, invite tracker (meta/google/crm — invites only, never passwords), assets ≤2 MB inline.
- ✅ Client dashboard (D:\seai `public/index.html`): added Services, Projects (tasks/gates/progress), Approvals (approve/reject + feedback + version history), Reports (source-labelled; manual vs API; live sync honestly "not connected"), Billing (agreements + downloadable invoices + **Razorpay mandate autopay**), Support (threads).
- ✅ Staff command center (D:\seai `public/staff.html` + `/api/staff/*`): overview, leads, inquiries, clients (agreements + create-subscription), projects (workflow tasks, gates), approvals queue, finance (MRR excl. ad budgets, invoices, expenses), campaigns, support, staff role admin. RBAC `users.role` enforced on every staff route; customer sessions get 403. Operator routes (`/api/agent/*` etc.) now require staff roles (authorization gap fixed).
- ✅ Delivery engine: 7 workflow templates (advertising/social/website/lead_gen/branding/automation/growth) → tasks with owner, due dates, dependencies, **approval gates that block completion** until approved.
- ✅ Recurring revenue: genuine Razorpay SUBSCRIPTIONS in D:\seai.payments (`POST /api/v1/subscriptions`, `…/verify`, `…/cancel`; `subscription.charged` → verified paid recurring order + outbox `payment.receipt` → mail). Server-side plans ₹7,999/₹14,999/₹29,999 (+₹457 maintenance). **Legacy order-based maintenance never created a subscription — it could never bill; it's deprecated and its test route now returns 410.** D:\seai links agreements via `PAYMENTS_API_URL` + `PAYMENTS_SERVICE_KEY`.
- ✅ Ad budgets: always `kind:'ad_budget'` invoices / agreement field; excluded from MRR and revenue everywhere.
- ✅ Tests: D:\seai 226/226; seai.payments 69/69 (real Postgres, mocked gateway; security suite uses real HMAC verifiers; integration files run sequentially — they share one test DB); seai.public build clean, zero type errors in new code (stale `src/` backend duplicate in seai.public predates this work and was not touched).
- ⚠️ Still human/external: Razorpay live keys + webhook registration (`/api/v1/webhooks/razorpay`), `PAYMENTS_API_URL`/`PAYMENTS_SERVICE_KEY` env on both sides, `npm run db:migrate` against production Postgres, Meta/Google inv­ites per client, sales ops. **Live charging was not verified in this session** (no Razorpay credentials) — test with `SEAI_TEMPORARY_PRICING=true` and document before going live.
