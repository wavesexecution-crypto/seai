# HUMAN ACTION REQUIRED — SEAI Business Ops Platform

This document lists **only** the items that genuinely require your action as the business owner. All engineering work has been completed and tested. These items require your personal credentials, account access, business decisions, or external provider approvals that cannot be obtained or configured autonomously.

---

## 1. Razorpay Production Credentials

**What you need to provide:**
- `RAZORPAY_KEY_ID` — Razorpay API Key ID
- `RAZORPAY_KEY_SECRET` — Razorpay API Key Secret  
- `RAZORPAY_WEBHOOK_SECRET` — Webhook signing secret (generate via Razorpay dashboard)

**Why:** Required for invoice payment order creation and webhook verification. Without these, invoice payments return 503 and cannot be processed.

**Where to obtain:** Razorpay Dashboard → Settings → API Keys & Webhooks

**Where to configure:** Add to `D:\seai\.env` or your production environment variables:
```
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

**Requires payment:** Yes (Razorpay account setup)

**Verification:** Once configured, `POST /api/ops/finance/invoices/:id/razorpay-order` will return a real Razorpay order ID instead of 503.

---

## 2. Meta (Facebook/Instagram/WhatsApp) OAuth Credentials

**What you need to provide:**
- `META_APP_ID` — Meta App ID
- `META_APP_SECRET` — Meta App Secret
- `META_REDIRECT_URI` — OAuth redirect URI (e.g., `https://ops.seai.store/api/ops/social/oauth/meta/callback`)
- `WHATSAPP_WEBHOOK_SECRET` — WhatsApp webhook verification secret

**Why:** Required for Meta/Instagram/WhatsApp OAuth connection, token refresh, and inbound webhook verification. Without these, social integrations return 503.

**Where to obtain:** Meta for Developers Dashboard → My Apps → Create App → Settings → Basic

**Where to configure:** Add to `D:\seai\.env` or production environment:
```
META_APP_ID=123456789012345
META_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_REDIRECT_URI=https://ops.seai.store/api/ops/social/oauth/meta/callback
WHATSAPP_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

**Requires verification:** Yes (Meta App review for certain permissions)

**Verification:** Once configured, `GET /api/ops/social/oauth/meta/url` returns a real OAuth URL instead of 503.

---

## 3. Google Ads Developer Token

**What you need to provide:**
- `GOOGLE_ADS_DEVELOPER_TOKEN` — Google Ads API developer token
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — Optional, for manager accounts
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials

**Why:** Required for Google Ads campaign launch and metrics sync. Without these, Google Ads operations return 503.

**Where to obtain:** Google Ads API Center → Developers → Get a developer token

**Where to configure:** Add to `D:\seai\.env` or production environment:
```
GOOGLE_ADS_DEVELOPER_TOKEN=xxxxxxxxxxxxxxxx
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890
GOOGLE_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

**Requires approval:** Yes (Google Ads API developer token approval)

**Verification:** Once configured, `POST /api/ops/ads/campaigns/:id/launch` will call the real Google Ads API instead of returning 503.

---

## 4. WhatsApp Business Account Approval

**What you need:**
- A Meta Verified WhatsApp Business Platform account
- A phone number ID for WhatsApp messaging
- Approved message templates (for template-based messaging)

**Why:** Required for actual WhatsApp message sending. Without a verified WhatsApp Business account, messages will fail with OAuth/invalid token errors.

**Where to obtain:** Meta for Developers → WhatsApp → Get Started

**Requires payment/approval:** Yes (WhatsApp Business verification)

**Verification:** Once configured, `POST /api/ops/whatsapp/send` will successfully send messages via the Meta Graph API.

---

## 5. Production Domain & Infrastructure

**What you need to provide:**
- Production domain (e.g., `ops.seai.store`)
- SSL/TLS certificates
- Hosting provider (Vercel, AWS, or self-hosted)

**Why:** The ops app is designed to run at `ops.seai.store` as a private single-user control centre.

**Where to configure:** Update `CORS_ALLOWED_ORIGINS`, `APP_URL`, `PUBLIC_URL` in `.env`

**Requires payment:** Yes (domain, hosting)

**Verification:** Once configured, update `CORS_ALLOWED_ORIGINS` in `.env` and deploy.

---

## 6. Production Database (Neon)

**What you need:**
- Neon PostgreSQL production project
- `DATABASE_URL` connection string

**Why:** Production data persistence. Currently configured for local development.

**Where to obtain:** Neon Console → Create Project → Connection String

**Where to configure:** Add `DATABASE_URL` to production environment

**Requires payment:** Yes (Neon production plan)

**Verification:** `GET /api/ops/settings/health` reports `database: { ok: true }`

---

## 7. SMTP Email Configuration

**What you need:**
- SMTP host, port, credentials
- `MAIL_FROM`, `MAIL_FROM_NAME`

**Why:** Required for password reset emails, inquiry notifications, and support communications.

**Where to configure:** Add to `D:\seai\.env`:
```
MAIL_SMTP_HOST=smtp.gmail.com
MAIL_SMTP_PORT=587
MAIL_SMTP_SECURE=false
MAIL_SMTP_USER=workwithseai@gmail.com
MAIL_SMTP_PASS=xxxxxxxxxxxxxxxx
MAIL_FROM=workwithseai@gmail.com
MAIL_FROM_NAME=SEAI
```

**Requires payment:** Optional (depends on email provider)

**Verification:** Password reset emails are delivered successfully.

---

## 8. SEAI Staff API Key

**What you need:**
- `SEAI_STAFF_API_KEY` — Shared secret for staff-authoritative operations

**Why:** Required for staff-only API routes. Without this, staff operations return 503.

**Where to configure:** Generate a secure random string:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Add to `D:\seai\.env`:
```
SEAI_STAFF_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
```

**Requires payment:** No

**Verification:** `GET /api/ops/settings/health` reports `staff_api_key: { ok: true }`

---

## 9. CRON Secret (Optional)

**What you need:**
- `CRON_SECRET` — For scheduled maintenance via Vercel Cron

**Why:** Required for automated maintenance jobs (mail reaper, password reset purge, overdue invoice transition).

**Where to configure:** Add to production environment:
```
CRON_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

**Requires payment:** No

**Verification:** Cron-triggered maintenance endpoint responds with 200.

---

## 10. SEAI Encryption Key

**What you need:**
- `SEAI_ENCRYPTION_KEY` — Token encryption key

**Why:** Required for encrypting social integration tokens at rest. Without this, token storage will fail.

**Where to configure:** Generate:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Add to `D:\seai\.env`:
```
SEAI_ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
```

**Requires payment:** No

**Verification:** Social integrations can store and retrieve encrypted tokens.

---

## Deployment Checklist

Once all credentials above are provided:

1. Set all environment variables in production
2. Run `npm run db:migrate` against production Neon database
3. Run `npx tsc --noEmit` to verify TypeScript compilation
4. Run `npm run build` for production build
5. Deploy to hosting provider
6. Verify `GET /api/ops/settings/health` returns `ok: true` for all checks
7. Test end-to-end with real credentials

---

## What Does NOT Require Your Action

The following have been fully implemented and tested:

- ✅ All 17 backend API modules with full CRUD
- ✅ Razorpay order creation + webhook verification + idempotency
- ✅ Meta OAuth (state nonce, long-lived token exchange, permission validation)
- ✅ Meta token refresh (fb_exchange_token grant)
- ✅ WhatsApp inbound webhook with HMAC verification
- ✅ WhatsApp templates, messages, conversations, send
- ✅ Google Ads API (campaign launch, metrics sync via GAQL)
- ✅ Scheduled social publishing with retry handling
- ✅ Client conversion (lead → client)
- ✅ Client onboarding (responses, assets, invites)
- ✅ Expense listing + overdue invoice transition
- ✅ Proposal PDF generation
- ✅ Notifications CRUD
- ✅ Audit log viewer
- ✅ Rate limiting on auth endpoints
- ✅ CORS configuration (configurable origins)
- ✅ Content scheduling with retry logic
- ✅ Service category validation
- ✅ TypeScript compiles cleanly (`tsc --noEmit` exits 0)
- ✅ Database migrations applied to Neon
- ✅ All existing customer/business data preserved
