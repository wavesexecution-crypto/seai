# SEAI Growth System — Deployment & Ops Notes

Date: 2026-11-08 · Repos: `D:\seai` (CDF + CRM), `D:\seai.public` (seai.store), `D:\seai.payments` (Razorpay)

## 1. Migrations (apply once, in order)

**seai.payments** (against the payments Postgres):
```
# from D:\seai.payments
npm run db:migrate        # schema.sql already includes subscriptions (004 folded in)
# verify:
#   \d subscriptions
```
**seai (CDF, `D:\seai`)** — against the CDF Postgres:
```
DATABASE_URL=... npm run db:migrate   # runs schema*.sql incl. schema-growth.sql
```
`schema-growth.sql` adds: `users.role`, `growth_inquiries`, `leads`, `lead_activities`,
`lead_imports`, `clients`, `onboarding_responses`, `onboarding_assets`,
`onboarding_invites`, `service_agreements`, `projects`, `project_tasks`,
`project_activities`, `content_approvals`, `campaign_reports`, `invoices`,
`expenses`, `support_requests`, `support_messages`, `notifications`.
Local dev/tests run on the disk-backed fallback without migrations.

## 2. Environment (new / changed)

| Variable | Where | Purpose |
|---|---|---|
| `PAYMENTS_API_URL` | D:\seai | Base URL of seai.payments (e.g. `https://payments.seai.store`). Default `http://localhost:4101`. |
| `PAYMENTS_SERVICE_KEY` (or `SEAI_SERVICE_KEY`) | D:\seai | Service key for `/api/v1/*` calls to seai.payments (Bearer mode). Server-side only. |
| `SEAI_SERVICE_KEY` | seai.payments | Key accepted for the `seai` service identity. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | seai.payments | Razorpay. Test keys first. |
| `SEAI_EVENTS_SHARED_SECRET` | both | Mail-relay HMAC (already required for payment emails). |
| `SEAI_MAIL_RELAY_ENABLED=true` | seai.payments | Turns on outbox → D:\seai mail relay (renewal receipts, `payment.successful`). |
| `SEAI_TEMPORARY_PRICING=true` | seai.payments | **⚠️ Test mode only**: ₹1 orders / ₹1 subscriptions for end-to-end test charges. Never in production (`assertProductionSafe` throws). |

> No secret ever leaves its repo: service keys stay server-side; `key_id` shown in
> checkouts is Razorpay's publishable identifier, returned by seai.payments.

## 3. Razorpay go-live checklist (human)

1. Razorpay dashboard → Settings → Webhooks → add URL
   `https://payments.seai.store/api/v1/webhooks/razorpay` with your webhook secret.
   Events needed automatically: `subscription.activated`, `subscription.charged`,
   `subscription.cancelled`, `subscription.halted`, `subscription.completed`,
   `subscription.pending` (select all subscription events + `payment.captured`/`payment.failed`).
2. Sandbox test: with `SEAI_TEMPORARY_PRICING=true` + test keys, run
   one full mandate (create → checkout → verify → first `subscription.charged`)
   and confirm: subscription `active`, a `paid` recurring order row, a payments row
   with NULL `razorpay_order_id`, one outbox `payment.receipt`, one email.
3. Add a second charge (Razorpay: "charge now" in dashboard or test clock) and confirm
   a second recurring order + receipt — never an overwrite, never a duplicate payment.
4. Turn `SEAI_TEMPORARY_PRICING` off, redeploy, repeat one live mandate at real prices.
5. `npx tsx scripts/migrate.ts` on the payments DB if not done in step 1.

## 4. First staff user

Staff access = a normal user whose `role` is a staff role. After first deploy:
```sql
UPDATE users
SET role = 'admin'
WHERE email = '<your staff email>';   -- or seed the first admin, then use /staff → Staff & roles
```
Then sign in and open `/staff`. Customers always get 403 (API) / a notice (page).

## 5. What to verify after deploy

- seai.store: `/`, `/services.html`, `/industries.html`, `/pricing.html`, `/contact.html` render; contact submit → lead inside `/staff` (Leads + Inquiries).
- dash.seai.store: `/staff` (staff only), `/onboarding` (client), `/billing` → Set up auto-pay opens Razorpay with `subscription_id` (not `order_id`).
- Invoices: staff /staff → Client → Generate service/ad-budget invoice → Download (opens printable HTML).
- Ad budgets appear in Billing with CLIENT-FUNDED labelling and never in MRR.

## 6. Honest gaps (known, not hidden)

- **Live ad metrics**: `POST /api/staff/campaign-reports` is operator-entered (`manual`).
  `meta_api`/`google_ads_api` are label values reserved for when Meta/Google APIs are connected
  (requires app review) — never back-filled with estimates.
- **OCR**: scanned PDFs are rejected on import with a clear message. No OCR is implemented;
  CSV/text PDFs are the supported path.
- **seai.public stale backend**: `D:\seai.public\src/{agent,shopify,mail,…}` is a stale copy of the
  seai backend (its `typecheck` fails pre-existing). The live site is the React/Vite frontend;
  this copy is not served. Removing it is a separate cleanup — do not wire anything into it.
- **Live money movement** was not exercised in this build (no Razorpay credentials in session);
  everything is covered by mocked-gateway tests + real-Postgres schema validation.
