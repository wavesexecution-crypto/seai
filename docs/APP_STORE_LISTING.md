# SEAI — Shopify App Store Listing (Submission-Ready)

**App name:** SEAI  
**Client ID:** 60755f0a9ca2782bc89ad891c4a2011c  
**App ID:** 1126248775681 (Partner Dashboard: https://dev.shopify.com/dashboard/234239180/apps/421113757697)  
**Gateway:** https://gateway.seai.store (embedded entry `https://gateway.seai.store/embed`)  
**SEAI:** https://www.seai.store  

## Subtitle
AI that operates your Shopify store — products, orders, content and reports on command.

## Description
SEAI is an autonomous commerce operating system for Shopify. It connects to your store via Shopify OAuth, verifies every action through policy-gated tools, and executes only after your explicit approval under your chosen autonomy level (OBSERVE, ASSIST, EXECUTE_SAFE, AUTONOMOUS).

Connect your store in one click, then tell SEAI what you want in plain language: create products from real supplier rows, edit themes, manage inventory, run reports, and automate operations. SEAI never fabricates products, orders or customer data — every product is created from grounded supplier rows, every decision is logged with evidence, and every tool call is reversible where possible.

Built for embedded Shopify Admin (App Bridge, session tokens), SEAI keeps Shopify access tokens encrypted at rest (AES-256-GCM) and never exposes them to the browser.

## Features
- One-click Shopify OAuth with shop-bound state, HMAC verification and encrypted token storage
- Embedded Admin (App Bridge, session-token auth, `frame-ancestors` CSP, SameSite=None cookies)
- Gateway ticket (HMAC-SHA256, 5-min TTL, one-time nonce, replay protection) → SEAI embedded session
- Policy-gated Shopify tools (products, orders, inventory, themes, discounts, content, reports) via GraphQL Admin API `2025-07`
- Incremental scope request (16 scopes at install, 54 optional at runtime per tool)
- Multi-store portfolio (6 neutral slots, store-isolated decisions/runs)
- GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact` + `app/uninstalled`, `shop/update` (HMAC, idempotent)
- Audit trail, experiments, and vault knowledge base

## How it works
1. Merchant searches “SEAI” in Shopify App Store → Install
2. Shopify redirects to `https://gateway.seai.store/auth?shop=YOUR-STORE.myshopify.com` → Approve
3. Gateway stores encrypted token, redirects to `https://gateway.seai.store/embed?shop=...&host=...` (App Bridge)
4. App Bridge `idToken()` → `GET /embed/activity` → gateway verifies session token → mints HMAC ticket
5. Iframe navigates to `https://www.seai.store/embed/activity?shop=...&ticket=...` → SEAI verifies HMAC, consumes nonce, sets `seai_session_embedded` (Secure, HttpOnly, SameSite=None, 8h)
6. If not yet linked, `302 /connect/start?shop=...` → SEAI account linking → back to `/activity`
7. Merchant reaches SEAI dashboard `/activity` (embedded), can refresh/reopen with same session

## Pricing
Free during App Store review. Future paid plans will use Shopify Billing API (Managed Billing) and will be presented before any charge. No external checkout.

## Category
Store management → Automation and workflow

## Tags
ai, automation, shopify-operations, inventory, product-creation

## Support
- **Support URL:** https://www.seai.store/support
- **Support email:** support@seai.store
- **Emergency contact:** support@seai.store (24h response)

## Privacy
- **Privacy policy:** https://www.seai.store/privacy (public, describes shop domain, encrypted tokens, GDPR handling)
- **Terms:** https://www.seai.store/terms

## Testing instructions for reviewers
- Test store: `cim9xc-fs.myshopify.com` (development store, already installed with 16 scopes)
- For fresh install as new merchant: open `https://gateway.seai.store/auth?shop=NEW-STORE.myshopify.com` → Approve → embedded SEAI loads. If linking required, create account at `https://www.seai.store/create-account` then return.
- Host param is dynamic (admin.shopify.com/store/... base64) — preserved exactly, no hardcoding

## Screenshots required (to be captured from production UI)
- 1280x800: SEAI activity feed, command surface, portfolio overview (actual UI, not mock)
- App icon: 1024x1024 PNG `public/logo-1024.png` / 1200x1200 `public/logo-1200.png` (512 source upscaled, solid #0a0a0b background)
- Demo screencast: 30-60s showing install → embedded load → ticket → activity (record via Shopify Admin)

## Distribution
- Desired: PUBLIC, Full visibility (Shopify App Store search “SEAI”)
- Current: Embedded `true`, `application_url=https://gateway.seai.store/embed`, `api_version=2025-07`, webhooks declared
- Manual dashboard step required (see Final Report): Partner Dashboard → App Setup → Distribution → Manage → “Public distribution” → “Unlisted” or “Listed” → Save

## Submission checklist
- [x] Embedded, App Bridge, session tokens
- [x] OAuth shop-bound state, HMAC, redirect `https://gateway.seai.store/auth/callback`
- [x] Tokens encrypted at rest, never in browser/logs
- [x] GDPR topics declared and handled (gateway deletes tokens/stores, SEAI deletes events/sessions on `shop/redact`)
- [x] GraphQL only, 2025-07 pinned, throttle handling
- [x] CSP `frame-ancestors`, Secure/SameSite=None cookies, HSTS
- [x] Privacy/Terms/Support pages at `/privacy` `/terms` `/support` (public)
- [ ] Screenshots + screencast (needs manual capture from `https://www.seai.store/activity` with real store)
- [ ] App icon 1024 confirmed in dashboard (upload `logo-1024.png`)
- [ ] Manual dashboard: set Privacy URL, Terms, Support email, Distribution → Public

## Notes
- No billing code yet (free) — will add `appSubscriptionCreate` via GraphQL when monetizing
- API version 2025-07 is within 12-month support window until 2026-07; bump to 2025-10 before sunset
- All shops isolated by `shopDomain` key (sessions, nonces, tickets, events)
