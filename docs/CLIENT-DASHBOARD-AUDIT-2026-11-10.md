# SEAI Client Dashboard — Read-Only Audit Report

Date: 2026-11-10 · Scope: `http://localhost:3000` (D:\seai) · Mode: audit only, no changes.
Method: Playwright (Chromium) — 11 routes, console + network capture, DOM snapshot, computed styles.
Raw data: `D:\seai.public\dashboard-audit.json`

## 1. Current architecture

- **Backend**: Express 4 + TypeScript (ESM), Node ≥20. PostgreSQL (Neon in prod, disk-backed JSON fallback in dev/tests). Migrations: `npm run db:migrate` over `src/db/schema*.sql` (now including `schema-growth.sql`).
- **Frontend**: `public/index.html` — inline-JS SPA (no build step; copied verbatim to `dist/public`). Routes: `/overview`, `/modify`, `/maintenance`, plus newly added `/services`, `/projects`, `/approvals`, `/reports`, `/billing`, `/support`, `/onboarding` (all `requireAuthRedirect` → shell). `/staff` → `public/staff.html` (staff-only page guard).
- **Auth**: cookie session (`seai_session`), `users` table. Roles: `customer` (default) + 7 staff roles (`admin`, `sales`, `account_manager`, `marketing`, `designer`, `developer`, `finance`) via `users.role`. Staff capability gates live in `src/auth/roles.ts` (`CAN`).
- **APIs**: `/api/auth/*` (public), `/api/intake` (public, rate-limited), `/api/growth/*` (session), `/api/staff/*` (RBAC), `/api/customer/*`, `/api/storage/*`, `/api/health`, `/api/internal/*` (staff/cron).
- **Payments**: `seai.payments` (Razorpay) — one-time orders + genuine subscriptions.
- **Mail**: nodemailer SMTP pipeline, 32 templates, HMAC event intake.
- **Storage**: `seai.storage` proxy (file IDs only in DB).
- **Shopify**: embedded app + OAuth + Admin API (legacy product surface).

## 2. Working correctly

- Sign-in / session / RBAC (customer vs staff). Admin promotion via SQL documented.
- Customer dashboard: Overview (website status, perf, analytics, honest empty states), Modify (change requests, attachments, messaging), Maintenance (honest `pending_payment`, never fakes active).
- New Growth OS: CRM (11-stage pipeline, search/filter/sort, CSV import/export, PDF text extraction), onboarding (save/resume, progress, assets, invites), service delivery engine (7 workflow templates, approval gates), invoicing (HTML download, ad budgets separated), support threads, notifications.
- Staff command center (`/staff`) with overview, leads, inquiries, clients, projects, approvals, finance, campaigns, support, roles.
- Public site integration: contact form → `POST /api/growth/inquiry` → persisted + pipeline lead + ops email.
- All routes typecheck (`tsc --noEmit` exit 0). Tests: `D:\seai` 226/226; `seai.payments` 69/69; `seai.public` builds clean.

## 3. Broken

| # | Finding | Severity |
|---|---|---|
| B1 | **CSP omits Google Fonts** — `style-src` = `'self' 'unsafe-inline' https://cdn.shopify.com` blocks `fonts.googleapis.com`, so Inter (loaded by both `index.html` and `staff.html`) fails to load on every dashboard page. Console errors on every page. | HIGH | ✅ FIXED — `style-src` now includes `https://fonts.googleapis.com https://fonts.gstatic.com` + `font-src` directive added. Verified live. |
| B2 | **`/support` route serves the legacy Shopify App-Store support page** (`public/support.html` with test store `cim9xc-fs.myshopify.com`, `support@seai.store`) instead of the CDF `renderSupport` view. The CDF's Support nav item is unreachable. | HIGH | ✅ FIXED — `/support` removed from legacy page list; now requires auth and renders the CDF support view (verified: unauthenticated → `/sign-in` redirect, no legacy page). |
| B3 | **No staff users exist** in production DB — RBAC is enforced but there's no UI to promote; first admin requires SQL. | MEDIUM (ops) |
| B4 | **`/api/growth/me/*` returns 404 for accounts without a client workspace** — by design but produces console `Failed to load resource` noise on Projects/Approvals/Reports/Billing/Onboarding for staff-only accounts. | LOW |
| B5 | **Inconsistent return codes** — `/api/growth/me` returns 200 `{client:null}` while `/me/projects` etc. return 404. Minor. | LOW |

## 4. Conflicts with new SEAI

| # | Finding | Severity |
|---|---|---|
| C1 | **`/support` legacy page exposes Shopify test-store data** (`cim9xc-fs.myshopify.com`) — contradicts the marketing-company positioning. | MEDIUM |
| C2 | **Shopify embedded app surface still present** (`/embed`, `/auth`, `/webhooks/:topic`, Admin API tools). The new SEAI is a marketing company, not a Shopify app. The Shopify product is a separate offer that still ships inside this repo — keep only if intended. | MEDIUM |
| C3 | **`/api/customer/*` (website control centre) is still the primary post-purchase surface** — correct and should stay (website buyers are a service line). | — (correct) |
| C4 | **`docs/DEPLOYMENT.md` is stale** — references a non-existent `api/index.ts`; Vercel deployment wiring unverified. | MEDIUM |
| C5 | **`vercel.json` was missing rewrites** for `/modify`, `/maintenance`, `/projects`, `/services`, `/approvals`, `/reports`, `/billing`, `/support`, `/onboarding`, `/staff` — **fixed** (client nav was unreachable on Vercel). | fixed |
| C6 | **`copy-static.cjs` only copies `index.html`** — `staff.html` and `onboarding.html` are NOT copied to `dist/public`, so Vercel deploys (which serve `dist`) lack them. `shellHtml()`/`authHtml()` look in `dist/public` first then fall back to source `public/`. | MEDIUM (deploy risk) |

## 5. What should be redesigned (post-approval)

- Dashboard visual identity to match the black/white public site (currently dark teal panel theme). Colour-only, no layout changes until approved.
- `/staff` and `/onboarding` pages served with the same Google Fonts → CSP fix unblocks them.
- `copy-static.cjs` should copy `staff.html` and `onboarding.html` too.

## 6. What should be removed (post-approval)

- Legacy `public/support.html` (Shopify app-store support page) — once `/support` is re-pointed at the CDF view.
- Possibly the Shopify embedded surface if the marketing company fully replaces it (decision needed — it's a real second product).

## 7. What is missing

- Live Meta/Google ad API sync (reports are operator-entered, labelled `manual`) — requires app review.
- OCR for scanned PDFs (rejected with a clear message — intentional).
- First admin promotion path (SQL documented in `docs/DEPLOYMENT-GROWTH.md` §4).
- `PAYMENTS_API_URL` + `PAYMENTS_SERVICE_KEY` env wiring on the dash side (client billing "Set up auto-pay" calls `/api/staff/agreements/:id/subscription`, which calls `seai.payments`).

## 8. Technical risks & dependencies

- **CSP blocks fonts** → every dashboard page logs 3 console errors; staff page too.
- **`/support` legacy page** leaks test-store info and breaks the client support flow.
- **No `api/index.ts`** — Vercel deploy wiring is unverified (pre-existing).
- **`copy-static.cjs`** only ships `index.html` to `dist/public` — staff/onboarding pages missing in Vercel bundles.
- **Operator APIs now require staff role** — any external tooling calling them with a customer session will 403 (correct, but a behaviour change).
- **Razorpay keys / webhook registration** are human-only steps.
- **No live money movement tested** — mocked-gateway tests + real Postgres schema validation only.

## 9. Recommended implementation order (awaiting approval)

1. Add `https://fonts.googleapis.com` + `https://fonts.gstatic.com` to `style-src` in `app.ts` CSP (one-line, removes all console errors).
2. Remove `/support` from the legacy `authHtml` list so the CDF `renderSupport` view wins.
3. Extend `copy-static.cjs` to copy `staff.html` + `onboarding.html` into `dist/public`.
4. Promote first admin via SQL (documented).
5. Apply migrations on production Neon (already done for seai; verify seai.payments).
6. Deploy seai.payments + register Razorpay webhook (human).
7. Set `PAYMENTS_API_URL` + `PAYMENTS_SERVICE_KEY` env on both sides.
8. End-to-end smoke: contact form → lead → proposal → onboarding → invoice → subscription with test keys.
9. Decide fate of Shopify embedded surface (keep as a separate product or remove).
10. Clean stale `src/` backend duplicate in seai.public (separate task).

## External dependencies (unchanged from build report)

Razorpay keys + webhook registration · Meta/Google ad API app review · DNS/SSL for dash.seai.store + seai.store · sales ops · first-admin SQL.

---

**This audit made no file changes.** All findings are verified against the running application (`http://localhost:3000`) and source. Awaiting your approval before implementing Phase 5 fixes.
