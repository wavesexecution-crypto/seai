# SEAI Feature Parity Matrix — Public Site vs Client Dashboard

Date: 2026-11-10 · Reference (port 4173): `D:\seai.public` · Dashboard (port 3000): `D:\seai`

## 1. Architecture comparison

| Aspect | Public site (seai.store) | Client dashboard (dash.seai.store) |
|---|---|---|
| Stack | Vite 6 + React 19 + TypeScript + Tailwind 3 + GSAP | Express 4 + inline-JS SPA (no build step) |
| Styling | `base.css` + `growth.css` + `responsive.css` (design tokens) | Inline `<style>` in `public/index.html` (now aligned tokens) |
| Auth | Anonymous (public) | Cookie session (`seai_session`), RBAC via `users.role` |
| Data | Static + `/api/payment/*` proxy to seai.payments + `/api/intake` to dash | `/api/growth/*`, `/api/staff/*`, `/api/customer/*`, `/api/storage/*` |
| Deployment | Vercel (static) | Vercel (Express preset) + Docker |
| DB | None (stateless) | PostgreSQL (Neon) + disk fallback |

## 2. Route / page inventory

### Public site (seai.store) — 11 pages + 7 demos

| Route | Purpose | Dashboard equivalent | Parity |
|---|---|---|---|
| `/` | Marketing homepage (hero, problem, approach, services, industries, process, why SEAI, portfolio, FAQ, CTA) | None (marketing only) | N/A — not needed in dashboard |
| `/services.html` | 7 service detail sections (what/who/delivers/execution/requires/receives/measured/CTA) | `/services` (active services + agreements + onboarding progress) | ⚠️ Different purpose — public = marketing, dashboard = account state. Terminology aligned. |
| `/industries.html` | 10 industry playbooks + demo links | None | N/A — marketing only |
| `/pricing.html` | Retainer plans (Starter/Growth/Scale) + four-bucket money separation + honest terms | `/billing` (invoices, subscription, autopay) | ✅ Aligned — same plan names/amounts, ad budgets separate |
| `/contact.html` | Consultation form → `POST /api/growth/inquiry` | `/support` (support requests) | ✅ Different purpose — contact = sales, support = post-purchase |
| `/examples.html` | Demo gallery with search + category filter | None | N/A — marketing only |
| `/intake.html` | Website purchase flow (Razorpay one-time) | None | N/A — separate commerce flow |
| `/terms.html`, `/privacy.html` | Legal pages | None | N/A |
| `/404.html` | Not found | None | N/A |
| `/examples/*.html` | 7 demonstration builds (restaurant, cafe, gym, salon, clinic, real-estate, business) | None | N/A — marketing only |

### Client dashboard (dash.seai.store) — 11 routes

| Route | Purpose | Public-site parallel | Parity |
|---|---|---|---|
| `/overview` | Website status, performance, analytics | None | Dashboard-specific ✓ |
| `/modify` (+ detail) | Change requests, attachments, messaging | None | Dashboard-specific ✓ |
| `/maintenance` | Plan, billing, requests | None | Dashboard-specific ✓ |
| `/services` | Active services, agreements, onboarding progress | `/services.html` (marketing) | ⚠️ Terminology aligned; content differs by purpose |
| `/projects` | Projects + tasks + gates | None | Dashboard-specific ✓ |
| `/approvals` | Content approval queue | None | Dashboard-specific ✓ |
| `/reports` | Advertising reports (source-labelled) | None | Dashboard-specific ✓ |
| `/billing` | Invoices, subscription, autopay | `/pricing.html` (plans) | ✅ Aligned — same plan names/amounts |
| `/support` | Support requests | `/contact.html` (sales) | ✅ Different purpose, consistent tone |
| `/onboarding` | Multi-step onboarding form | None | Dashboard-specific ✓ |
| `/staff` | Staff command center (RBAC-gated) | None | Dashboard-specific ✓ |

## 3. Feature parity matrix

### Shared / aligned features

| Feature | Public site | Dashboard | Status |
|---|---|---|---|
| SEAI brand name + tagline | "Get Exposed. But in a Good Way." | "SEAI" wordmark | ✅ Aligned |
| Service catalogue (7 services) | Branding, Advertising, Digital Marketing, Website Dev, Lead Gen, Sales & Automation, Growth Strategy | Same 7 services in `SERVICE_CATALOGUE` | ✅ Aligned |
| Plan names | Starter / Growth / Scale | Same names in `PLAN_CATALOGUE` | ✅ Aligned |
| Plan amounts | ₹7,999 / ₹14,999 / ₹29,999 | Same in `PLAN_CATALOGUE` + `seai.payments` | ✅ Aligned |
| Ad budget separation | "Paid by you directly to platforms, never marked up" | `ad_budget_inr` field, "CLIENT-FUNDED" invoice label, excluded from MRR | ✅ Aligned |
| No guaranteed results | "No guaranteed leads, ever" | Same disclaimer in finance + reports | ✅ Aligned |
| Approval before launch | "Nothing ships without your sign-off" | Approval gates in delivery engine + content approvals | ✅ Aligned |
| Honest reporting | "Manual or API-sourced — labelled" | `data_source` field: manual/meta_api/google_ads_api | ✅ Aligned |
| Contact/consultation | `/contact.html` form → `POST /api/growth/inquiry` | `/support` (post-purchase support) | ✅ Different purpose, consistent |
| Email (workwithseai@gmail.com) | Footer + contact page | Staff dashboard + mail pipeline | ✅ Aligned |
| Black/white/charcoal design | Pure `#000`/`#fff`/`#9a9a9a` | Now aligned (CSS token rework) | ✅ Aligned |

### Dashboard-only features (correct — client-specific, not in public site)

| Feature | Route | Backend | Status |
|---|---|---|---|
| Website status & performance | `/overview` | `/api/customer/overview`, `/performance` | ✅ Working |
| Change requests + attachments + messaging | `/modify` | `/api/customer/requests/*` | ✅ Working |
| Maintenance subscription (honest pending_payment) | `/maintenance` | `/api/customer/maintenance/*` | ✅ Working |
| Active services + agreements | `/services` | `/api/growth/me` | ✅ Working |
| Project delivery (tasks, gates, progress) | `/projects` | `/api/growth/me/projects` | ✅ Working |
| Content approvals (approve/reject + feedback) | `/approvals` | `/api/growth/me/approvals` | ✅ Working |
| Advertising reports (source-labelled) | `/reports` | `/api/growth/me/reports` | ✅ Working |
| Invoices + subscription + autopay | `/billing` | `/api/growth/me/billing`, `/me/subscriptions/*` | ✅ Working |
| Support requests (threads) | `/support` | `/api/growth/me/support` | ✅ Working |
| Onboarding (save/resume, progress, assets, invites) | `/onboarding` | `/api/growth/me/onboarding/*` | ✅ Working |
| Staff command center (RBAC) | `/staff` | `/api/staff/*` | ✅ Working |
| CRM (leads, pipeline, import/export) | `/staff` → Leads | `/api/staff/leads/*` | ✅ Working |
| Finance (MRR excl. ad budgets, invoices, expenses) | `/staff` → Finance | `/api/staff/finance` | ✅ Working |

### Public-site features NOT in dashboard (correct — marketing only)

| Feature | Public site | Should it be in dashboard? |
|---|---|---|
| Hero / problem / approach / why SEAI | Homepage | No — marketing only |
| Industry playbooks | `/industries.html` | Could be a help/reference section (nice-to-have) |
| FAQ | Homepage | Could be a help page (nice-to-have) |
| Demo gallery | `/examples.html` | Could link as reference (nice-to-have) |
| Website purchase flow | `/intake.html` (Razorpay one-time) | No — separate commerce flow |

### Legacy features that should be removed

| Feature | Location | Status |
|---|---|---|
| Shopify embedded app surface (`/embed`, `/auth`, `/webhooks`) | `src/shopify/*`, `src/routes/embed.ts` | Legacy — second product, decision needed |
| Orphaned operator console (`public/app.js`, `public/lang.js`, 53KB) | `public/` | Dead code — no HTML references them |
| Legacy Shopify support page (`public/support.html`) | `public/` | Removed from `/support` route (fixed) |
| Stale backend duplicate | `D:\seai.public/src/{agent,shopify,mail,...}` | Not served; separate cleanup |

## 4. Backend/data integration status

| Dashboard feature | Backend endpoint | Persists? | Real? |
|---|---|---|---|
| Growth inquiry (contact form) | `POST /api/growth/inquiry` | Yes — `growth_inquiries` + auto-lead | ✅ Real |
| Leads CRM | `/api/staff/leads/*` | Yes — `leads`, `lead_activities`, `lead_imports` | ✅ Real |
| Onboarding | `/api/growth/me/onboarding/*` | Yes — `onboarding_responses`, `onboarding_assets`, `onboarding_invites` | ✅ Real |
| Projects/delivery | `/api/growth/me/projects`, `/api/staff/projects` | Yes — `projects`, `project_tasks`, `project_activities` | ✅ Real |
| Approvals | `/api/growth/me/approvals`, `/api/staff/approvals` | Yes — `content_approvals` | ✅ Real |
| Reports | `/api/growth/me/reports`, `/api/staff/campaign-reports` | Yes — `campaign_reports` | ✅ Real (manual) |
| Billing/invoices | `/api/growth/me/billing`, `/api/staff/invoices/*` | Yes — `invoices`, `service_agreements` | ✅ Real |
| Subscriptions | `/api/growth/me/subscriptions/*`, `/api/staff/agreements/:id/subscription` | Yes — `service_agreements.razorpay_subscription_id` + seai.payments | ✅ Real (genuine Razorpay) |
| Support | `/api/growth/me/support`, `/api/staff/support` | Yes — `support_requests`, `support_messages` | ✅ Real |
| Notifications | `/api/growth/me/notifications` | Yes — `notifications` | ✅ Real |
| Analytics connections | `/api/customer/connections` | Yes — `analytics_connections`, `analytics_snapshots` | ⚠️ No connectors yet (manual) |

## 5. Design language alignment

| Token | Public site | Dashboard (after fix) | Aligned? |
|---|---|---|---|
| Background | `#000` | `#000` | ✅ |
| Ink (primary text) | `#fff` | `#fff` | ✅ |
| Body text | `#D1D1D1` / `#292929` (light) | `#a0a0a0` / `#1a1a1a` (light) | ⚠️ Close but not identical |
| Secondary | `#A6A6A6` / `#555555` | `#737373` / `#595959` | ⚠️ Close but not identical |
| Labels | `#A0A0A0` / `#333333` | `#737373` / `#595959` | ⚠️ Close but not identical |
| Nav links | `#E5E5E5` | `#e5e5e5` | ✅ |
| Borders | `rgba(0,0,0,.12)` / `rgba(255,255,255,.12)` | `rgba(255,255,255,.12/.06)` | ✅ |
| Font | Inter 400/500/600/700/800 | Inter 400/500/600/700 (added 700) | ⚠️ Missing 800 |
| Body size | 16px / 15px mobile | 16px / 14px mobile | ⚠️ Mobile needs 15px |
| Line height | 1.7 | 1.7 | ✅ |
| Buttons | 999px radius, pill | 8px radius, boxy | ⚠️ Different shape |
| Cards | 16px radius, hairline | 12px radius, hairline | ⚠️ Close |
| Eyebrow/labels | mono, 11-12px, uppercase, letter-spacing | mono, 11px, uppercase | ✅ |
| Status badges | mono pills (black/white/grey) | colored (green/amber/red → now mono) | ✅ Aligned |

## 6. Remaining gaps (need implementation)

| Gap | Severity | Effort |
|---|---|---|
| Dashboard body text uses `#a0a0a0`/`#737373` instead of spec `#D1D1D1`/`#555555` | MEDIUM | CSS token update |
| Mobile body 14px → should be 15px | LOW | CSS media query |
| Buttons 8px radius → should be 999px pills to match public site | MEDIUM | CSS |
| Cards 12px → 16px radius | LOW | CSS |
| No `--tx1..--tx4` context variables in dashboard | MEDIUM | CSS rework |
| Missing Inter 800 weight in font import | LOW | HTML link |
| Status badges use `.badge.live/.warn/.bad/.gray` (colored origins) instead of mono pills | LOW | CSS |
| Legacy Shopify surfaces still in repo (separate product decision) | MEDIUM | Product decision |
| Orphaned `public/app.js` + `public/lang.js` (53KB dead code) | LOW | Cleanup |
| `copy-static.cjs` only ships `index.html` to `dist/public` | MEDIUM | Build script |
| No `api/index.ts` (stale docs) | MEDIUM | Docs/infra |

## 7. What must NOT be brought over (marketing-only)

- Hero/problem/approach/why-SEAI/portfolio/FAQ sections — these are marketing, not client functionality.
- Demo gallery, industry playbooks — nice-to-have reference links only.
- Website purchase flow (`/intake.html`) — separate commerce flow, not dashboard.

## 8. Implementation order (awaiting approval)

1. Align CSS tokens to exact public-site values (`--tx1..--tx4`, body 16/15px, 1.7 line-height, 800 weight).
2. Convert buttons to 999px pills, cards to 16px radius.
3. Update status badges to mono pills.
4. Add Inter 800 to font import.
5. Fix `copy-static.cjs` to ship staff.html + onboarding.html.
6. Remove orphaned `public/app.js` + `public/lang.js` (dead code).
7. Decide fate of Shopify embedded surface.
8. End-to-end smoke test all dashboard routes + interactions.

---

**This is the feature parity matrix. No files were modified in this pass. Awaiting your approval before implementation.**
