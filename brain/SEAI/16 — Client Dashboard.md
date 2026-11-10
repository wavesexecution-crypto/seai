---
title: SEAI — Client Dashboard (Customer Control Centre)
updated: 2026-09-27T00:00:00.000Z
type: system
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27
---

# SEAI — Client Dashboard

> **The product the customer actually pays for.** Everything else in this vault is
> plumbing around it. It is the only customer-facing surface, and it is the only place
> a paying customer logs in.

> **This note is A-to-Z.** It covers the entry path, every screen, every tab, every API
> call, the full data model, the auth lifecycle, and what is broken. Nothing here is
> inferred from the backend alone.

## The single most confusing fact in this codebase

`D:\seai\public` contains **two entirely different frontends** that both live in
`public/`, and they are easy to mistake for each other:

| | **Client dashboard** | **Operator console** |
|---|---|---|
| File | `public/index.html` (36.6 KB, **inline JS**, 489 lines) | `public/app.js` (53 KB) + `public/index.html` shell |
| Who logs in | The paying customer | SEAI staff |
| API prefix | `/api/customer/*` and `/api/fana/*` | `/api/admin/*`, `/api/runs`, `/api/agent/run`, `/api/portfolio/*`, `/api/creation/*`, `/api/stores`, `/api/tools`, `/api/decisions`, `/api/experiments`, `/api/blueprint`, `/api/onboard`, `/api/models`, `/api/scopes`, `/api/brain` |
| Sections | Overview, Modify, Maintenance | Command, Activity, Provider, Tools, System, Portfolio, Creation |
| Owns | `change_requests`, `attachments`, `maintenance_subscriptions`, Fana conversation | agent runs, decisions, experiments, portfolio, store brain |

`app.js` contains **zero** `/api/customer` calls, and the client `index.html` contains
**zero** operator calls. They share only `auth.css`, `logo.*`, favicons and
`privacy/terms/support.html`. A search for `/api/customer` in the whole repo returns
exactly **one** non-backend hit: `public/index.html:184`.

## 🔴 Launch blocker: 2 of 3 client routes do not exist on Vercel

`src/app.ts:197` registers the shell for **19** paths, including all three client
sections:

```
/overview  /modify  /maintenance  /performance  /changes  /projects  /create
/templates /deployments  /domains  /settings  /command  /activity  /provider
/tools  /system  /portfolio  /creation  /start
```

`vercel.json` rewrites only **9** of them: `/overview`, `/command`, `/activity`,
`/provider`, `/tools`, `/system`, `/portfolio`, `/creation`, `/start`.

**Missing from `vercel.json`:**

| Missing | Consequence |
|---|---|
| `/modify` | "Modify" nav is a dead link / 404 — customers cannot raise a change request |
| `/changes` | same, alias route |
| `/maintenance` | "Maintenance" nav is a dead link / 404 — customers cannot view or activate their plan |
| `/performance` | performance tab unreachable |
| `/projects` `/create` `/templates` `/deployments` `/domains` `/settings` | future/unused, but also dead |

**Two-thirds of the client dashboard's navigation is broken in production** while
working perfectly in local dev, because Express serves the shell for those paths and
Vercel does not. The nav links in `index.html` are `/overview`, `/modify`,
`/maintenance` — of which only one survives. Add the missing rewrites. See
[[15 — Known Issues]] K-48.

## Entry path and auth lifecycle

Five static auth pages in `public/`, all driven by the shared `public/auth.js` helper
(which builds `'/api/auth' + path`, so the endpoint names are not greppable in the HTML):

| Page | Server route | Notes |
|---|---|---|
| `sign-in.html` | `POST /api/auth/sign-in` | `auth/routes.ts:84` |
| `create-account.html` | `POST /api/auth/sign-up` | `auth/routes.ts:102` |
| `forgot-password.html` | `POST /api/auth/forgot-password` | `auth/routes.ts:122` |
| `reset-password.html` | `POST /api/auth/validate-reset-token` + `/reset-password` | `auth/routes.ts:243, 159` |
| `verify-email.html` | `POST /api/auth/verify-email`, `/resend-verification` | `auth/routes.ts:194, 209` |
| — | `POST /api/auth/sign-out`, `GET /api/auth/me` | called from `index.html:435` |

- `app.ts:181` serves any `/auth/*` page as a file; `app.ts:185` redirects `/` →
  `/overview` behind `requireAuthRedirect`, which bounces to `/sign-in`.
- Unauthenticated HTML routes are protected by `requireAuthRedirect`; every
  `/api/customer/*` and `/api/fana/*` call sits behind `requireAuth`.
- Password hashing, session hashing and token TTLs are covered in [[04 — CDF]] and
  [[11 — Security]]. They are solid.

**Note on sign-up:** `POST /api/auth/sign-up` creates the account, but nothing links a
new account to a paid order. There is no order→user reconciliation anywhere, because
[[08 — Payments]] K-01 means no order exists. So a customer who paid would have to sign
up and **manually** have their website attached. `[VERIFY]` — the operator must attach
`customer_websites` by hand today, via `PUT /api/customer/website`.

## The three sections

Navigation is `data-nav` driven with `history.pushState` + a `popstate` listener
(`index.html:419-423`). `section()` (line 198) maps `pathname` → section:
`/modify` or `/changes` → modify, `/maintenance` → maintenance, everything else →
overview.

### 1. Overview — `/overview`

Heading: *"Is my website live and how is it performing?"* Three tabs via
`?tab=`:

- **`website`** (default) — `renderWebsitePanel` (242): site name, domain, deployment
  status, SSL status, an **"Open site"** button that opens `https://<domain>` in a new
  tab (line 209), connected analytics providers, active change requests (everything not
  `completed`), and the maintenance state.
- **`performance`** — `renderPerfPanel` (286): period selector
  `7d / 30d / 90d / 12m` (default `30d`), reading real `analytics_snapshots` rows via
  `perfData` (282). Renders the **empty state honestly** when no provider is connected
  rather than inventing numbers.
- **`analytics`** — `renderAnalyticsPanel` (307): per-provider detail for
  GA4, Search Console, PageSpeed, GBP, each with a human description
  (`CONN_DESC`, line 195).

### 2. Modify — `/modify`

*"Request any website change."* This is the retention mechanic and the heart of the
product. Three tabs:

- **`requests`** (default) — recent-activity card (last 5) plus the active feed, filtered
  to `status !== 'completed'`.
- **`new`** — `renderComposer` (345). Fields: title (max 160, required), page (max 253),
  description, priority (`normal` / `important` / `urgent`), and **up to 5 file
  attachments**. Attachments are read client-side as **data URLs** and posted one at a
  time; images get inline thumbnails. Over-5 MB files are rejected with a visible alert.
  On success the cache is invalidated and the client routes straight to the new request.
- **`completed`** — the same feed filtered to `status === 'completed'`.
- **Detail** — `renderModifyDetail` (366) at `/modify?id=<uuid>`: request body, page,
  created/updated dates, attachment chips, the full conversation with `SEAI`/`You`
  attribution, and a reply box. Back link and conversation both post through the API.

### 3. Maintenance — `/maintenance`

*"Website maintenance."* Three tabs: `plan`, `billing`, `requests`.

- **`plan`** (default) — ₹457/month from server config, status badge, and an
  **"Activate maintenance"** button. Plus a plain-language inclusions list: content
  updates, image replacements, minor changes, technical fixes, broken-link checks,
  deployment support.
- **`billing`** — price, status badge, next billing date, `payment_status`,
  `renewal_status`, and the same activate button.
- **`requests`** — a shortcut into the Modify composer (`/modify?tab=new`).

**Honesty detail worth preserving:** `POST /maintenance/activate`
(`customer/routes.ts:305-311`) **never** sets `active`. Because no payment provider is
wired, activation is recorded as `pending_payment` / `unpaid`, and the UI renders
*"Pending payment — activation completes after payment. Nothing has been charged."*
The developer wrote this deliberately so the dashboard cannot display a fake active
subscription. Do not "fix" this by hardcoding `active`. See [[13 — Launch Checklist]].

## Fana drawer

A slide-over `<aside id="fana">` available from every section, wired to `/api/fana`
via its own `fanaApi` helper (line 438) — deliberately separate from the `/api/customer`
helper so a Fana outage cannot break the rest of the dashboard.

- Opens via `#fanaBtn`, closes via `#fanaClose` or `Escape`.
- `fanaLoad` (458) fetches `/conversation` **once per page load** (`fanaLoaded` flag)
  and replays the last **30** messages. Empty state introduces Fana.
- `fanaMsg` (448) escapes text, converts newlines, and — if the response carries a
  `request_id` — appends a **"View request →"** deep link into `/modify?id=…`. So a Fana
  conversation converts into a real change request in the normal UI, not a dead end.
- Typing indicator `#fanaTyping`; input `maxlength=2000` matching the server's Zod cap.
- Failure path renders *"Fana is temporarily unavailable. Please try again later."*
- Backend detail in [[05 — Fana]].

## Data model — `src/db/schema-customer.sql`

Seven tables. **Every row carries `user_id`**, every FK cascades on user delete, and the
API layer enforces ownership independently of the database.

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `customer_websites` | one per user (`user_id UNIQUE`) | `site_name`, `domain`, `deployment_status`, `last_deployment_at`, `ssl_status` | all statuses default `'unknown'` |
| `analytics_connections` | one per (user, provider) `UNIQUE(user_id, provider)` | `provider`, `status`, `external_id`, `last_synced_at` | supports ga4, search_console, pagespeed, gbp |
| `analytics_snapshots` | one per metric/period | `provider`, `metric`, `period`, `payload` **TEXT JSON**, `collected_at` | real data only, by design |
| `change_requests` | one per request | `title`, `description`, `page`, `priority`, `status` | `status` default `submitted` |
| `change_messages` | conversation | `request_id`, `author_role` (`client`/`seai`), `body` | |
| `attachments` | file metadata + data URL | `filename`, `mime_type`, `size_bytes`, `data_url` | **5 MB cap enforced in the API**, stored inline as a data URL |
| `maintenance_subscriptions` | one per user (`user_id UNIQUE`) | `plan_name`, `price_inr` **default 457**, `status`, `next_billing_date`, `payment_status`, `renewal_status` | price duplicated in schema, `config.ts`, and payments |

**Design note:** `attachments.data_url` stores file bytes **inside Postgres as base64**.
That is a deliberate simplicity choice and it is also a scaling and backup hazard — five
5 MB attachments per request is ~33 MB of base64 per row. Worth revisiting with object
storage before volume grows.

## API surface — `/api/customer`

Twelve routes, every one scoped to `req.user!.id` (`uid(req)`) on top of
`requireAuth`:

| Route | Purpose |
|---|---|
| `GET /overview` | website, connections, recent requests, maintenance, plan |
| `PUT /website` | link/update the customer's own website |
| `GET /performance` | connections + real snapshots (empty when none) |
| `POST /connections` | connect or update a data source |
| `GET /requests` | own change-request feed |
| `POST /requests` | create a change request |
| `GET /requests/:id` | full detail: request + messages + attachments |
| `POST /requests/:id/messages` | customer reply |
| `POST /requests/:id/status` | **status write — no transition allow-list, K-20** |
| `POST /requests/:id/attachments` | metadata + data URL, 5 MB cap |
| `GET /maintenance` | plan (from config) + subscription state |
| `POST /maintenance/activate` | request activation, never fakes `active` |

Client-side caching: `cache = {overview, perf, requests, maintenance}` (line 197).
`overview` is memoised for the page lifetime; `perf` is keyed by period; the composer
invalidates `cache.requests` after a successful create. Navigating between tabs does
**not** refetch. Acceptable for V1, but it means a status change made by SEAI will not
appear until a full page reload.

### XSS posture

Every interpolated value goes through `esc()` (line 182), which escapes `& < > " '`.
It is applied to request titles, descriptions, page names, filenames, message bodies and
Fana output. Two inline `data-url` thumbnails are built as `<img src="'+r.result+'">`
where `r.result` is a browser-generated `data:` URL from `FileReader`, not server data.
This is genuinely well-handled — see [[11 — Security]] for the one exception
(`'unsafe-inline'` CSP).

## What works, what doesn't

**Genuinely finished:** the three-section IA, tab routing, the change-request lifecycle
end to end, attachment upload with previews, the conversation thread, period-based
performance, provider metadata, the Fana deep-link into a real request, the honest
maintenance pending state, and consistent `esc()` on all user data.

**Not finished:**

- 🔴 `/modify` and `/maintenance` do not exist on Vercel — K-48, the blocker above.
- 🔴 A customer can mark their own request `completed` — K-20.
- 🟠 No order→user reconciliation, so website attachment is a manual operator step.
- 🟠 Attachments stored as base64 in Postgres.
- 🟠 Client cache is page-lifetime only; SEAI-side status changes need a reload.
- 🟠 `[VERIFY]` 404 behaviour for a non-existent `/modify?id=<uuid>` — the code renders an
  inline error card, which is correct, but has no browser test.
- 🟠 `[VERIFY]` No automated browser test exists for this UI. `playwright-core` is a
  devDependency in `seai.public` but no test uses it. The carousel, the modify flow and
  the Fana drawer are all untested against a real browser.
- 🟠 **K-49** — `POST /api/customer/connections` is reachable from the API but **no UI in
  `index.html` ever calls it**. The Overview and Performance panels *display* connections,
  but there is no "connect provider" control anywhere in the client dashboard, so a
  customer can never actually connect GA4, Search Console, PageSpeed or GBP. The
  analytics tabs can therefore only ever render their empty state. `[VERIFY]` whether
  connections are meant to be established by an operator — but either way the promise is
  currently unmet.

That last one is worth a human decision: the analytics tabs are a visible promise with
no path to fulfil it.

## Related

- [[04 — CDF]] · [[05 — Fana]] · [[06 — Public Site]] · [[09 — Email System]] ·
  [[10 — Deployment & Operations]] · [[11 — Security]] · [[15 — Known Issues]]
