---
title: SEAI — Decisions Log
updated: 2026-09-27T00:00:00.000Z
type: decisions
scope: seai
status: IN PROGRESS
provenance: user-provided decisions + code-verified conflicts 2026-09-27
---

# SEAI — Decisions Log

Locked decisions, and — more usefully — the places where the **code disagrees with the
decision**. Per the project rules, a contradiction is recorded here rather than silently
resolved in either direction.

## Locked decisions

| # | Decision | Status | Code agrees? |
|---|---|---|---|
| D-01 | Public domain `https://seai.store` | `LOCKED` | ✅ CORS allowlist, `config.publicUrl` |
| D-02 | No `www` required | `LOCKED` | ❌ **violated** — C-02 |
| D-03 | CDF domain `https://dash.seai.store` | `LOCKED` | ⚠ **partial** — C-01 |
| D-04 | `seai.public` owns acquisition and intake | `LOCKED` | ✅ matches repo role |
| D-05 | `seai` owns the customer relationship and fulfilment | `LOCKED` | ✅ |
| D-06 | `seai.payments` owns Razorpay and authoritative payment state | `LOCKED` | ✅ by design, ❌ in wiring — C-04 |
| D-07 | V1 is three **one-time** plans: ₹2,999 / ₹4,999 / ₹7,999 | `LOCKED` | ✅ **fully consistent** across all repos |
| D-08 | CDF has no checkout and does not own recurring maintenance billing | `LOCKED` | ✅ CDF holds no price catalogue |
| D-09 | Fana is customer-facing, authenticated, and scoped; never deploys or touches payments | `LOCKED` | ✅ enforced in code |
| D-10 | Fana model: `nvidia/nemotron-3-ultra-550b-a55b` via `integrate.api.nvidia.com/v1` | `LOCKED` | ✅ **exact match** — `src/fana/provider.ts:13-14` |
| D-11 | Six demo industries + original SEAI logo, no fabricated claims | `LOCKED` | ⚠ 7 pages, clinic assets missing — C-06 |
| D-12 | Carousel frame: one thin **black** 1px **sharp-cornered** edge, no glow/shadow/gradient | `LOCKED` | ❌ **not implemented** — C-03 |
| D-13 | Design: Zara × Apple × Palantir as principles; no generic SaaS, no fake glassmorphism | `LOCKED` | `[VERIFY]` visual judgement |
| D-14 | Production email links use only `seai.store` and `dash.seai.store` | `LOCKED` | ✅ enforced by URL safety |
| D-15 | Sender identity `workwithseai@gmail.com` | `LOCKED` | ✅ `config.mailFrom` |
| D-16 | One canonical email system; no bypass scripts | `LOCKED` | ✅ two bypasses deleted |
| D-17 | `seai.payments` is the single price authority | `LOCKED` | ✅ in `config/index.ts`; ⚠ duplicated 4× publicly |
| D-18 | Launch order as recorded in [[13 — Launch Checklist]] | `LOCKED` | n/a |

## Code-vs-decision conflicts

### C-01 — CDF has two different app URLs in one repo `IN PROGRESS`

**Decision:** CDF is `dash.seai.store`.
**Code:** `src/config.ts:59` defaults `appUrl` to `https://dash.seai.store` (this is what
every email link uses). But `shopify.app.toml:5,76` sets `application_url` and the OAuth
`redirect_urls` to **`https://gateway.seai.store`**, and `gateway/src/server.ts:169-170`
hardcodes that host. `docs/DEPLOYMENT.md` names a *third* answer, `https://seai.store`.
**Consequence:** `dash.seai.store` is the documented dashboard but `gateway.seai.store`
is what Shopify is actually configured with. An operator following the deployment doc
would break OAuth.
**Resolution needed:** decide whether CDF is `dash.seai.store` and the gateway is a
separate `gateway.seai.store` service (most likely, and consistent with the `gateway/`
sub-service existing), then fix `docs/DEPLOYMENT.md` and every `seai.store` reference.

### C-02 — `www.seai.store` is in production code `IN PROGRESS`

**Decision:** no `www`.
**Code:** `[app_preferences] url = "https://www.seai.store"` in both `shopify.app.toml:80`
and `gateway/shopify.app.toml:80`, and hardcoded in `public/privacy.html`,
`public/terms.html`, `public/support.html`, `docs/APP_STORE_LISTING.md`, and
`gateway/README.md`.
**Consequence:** every public legal page tells users the company operates at a hostname
the project does not intend to own.
**Resolution needed:** confirm whether `www` resolves and redirects to the apex. If not,
replace all occurrences with `seai.store` and set the Shopify app home to the apex.

### C-03 — The carousel frame decision has not been started `IN PROGRESS`

**Decision:** one thin black 1px sharp-cornered frame; no shadow, glow or gradient.
**Code:** `src/css/fan-carousel.css:20-45` (`.fan-card`) uses `border-radius: 1.1rem`
(rounded, line 33), `border: 1px solid rgba(10, 10, 11, 0.09)` (translucent grey, not
black, line 36), and `box-shadow: 0 12px 36px rgba(10, 10, 11, 0.08)` (line 37) rising to
`0 18px 48px` on hover (line 44), with a 260 ms transition animating both border and
shadow (line 39). A search across the project's five stylesheets for a black `#000`/`#111`
1px border returns exactly **one** hit — `.btn-dark:hover { border-color: #000 }` in
`base.css:145` — and nothing resembling a card frame.
**Consequence:** the current carousel is the visual opposite of the decision on all three
attributes.
**Resolution needed:** either implement the decision, or amend it deliberately — the
current soft-shadow treatment is a coherent choice, it just is not the recorded one.
Remember the card is `position: absolute` with GSAP transforms and `aspect-ratio: 3/4`;
restyling must not reintroduce flow layout.

### C-04 — `seai.payments` is the declared authority but is called by nobody `BLOCKED`

**Decision:** payments owns Razorpay and authoritative payment state.
**Code:** it owns it. But `seai.public` contains **zero** references to it and no
checkout, and `seai` names it in three comments only. `outbox_events` is written and
never read, so the CDF email intake has no live producer.
**Consequence:** the architecture is designed but unwired. Nothing collects money.
**Resolution needed:** build the public → payments order path and the payments → CDF
outbox relay, and agree the event-name contract with
`POST /api/internal/mail/events`.

### C-05 — Two candidate authorities for Shopify auth `VERIFY`

`docs/DEPLOYMENT.md` implies CDF serves `/auth/callback`. `shopify.app.toml` points the
callback at the gateway, and `gateway/` is a complete separate service that explicitly
"owns Shopify OAuth sessions, encrypted store-token storage, the Admin GraphQL proxy and
webhooks". The code does not resolve which is authoritative. Must be settled before
launch — the encrypted-token custody question follows directly from it.

### C-06 — The clinic demo was never given imagery `IN PROGRESS`

**Decision:** six demo industries including Clinic.
**Code:** all seven demo pages exist and the homepage links `/examples/clinic.html` from
both the examples carousel and the `BUSINESS_TYPES` list (`Homepage.tsx:58,62`), but
`scripts/demo-image-selection.json` contains **no `clinic` key** — the string does not
appear once in the file. There is also no `public/assets/demos/clinic/` directory, no
`CREDITS.json` entry, and `clinic.html` contains **one** `<img>` tag, which is the logo.
The page is fully authored (83 KB, comparable to `cafe.html` at 94 KB) and has **no
content photography whatsoever.**

So this is not a missing manifest row. The page was written without image slots and the
asset tooling was never extended to it. The other six demos are also not fully matched
(manifest slots vs committed files: restaurant 14/12, business 13/10, salon 10/9,
real-estate 8/7).
**Resolution needed:** add a `clinic` key to the manifest, add a `clinic` query map entry
to `fetch-demo-images.mjs`, add image slots to `clinic.html`, then re-run
`fetch:demo-images` and `optimize:demo-images`.

### C-08 — A seventh demo exists that the decision does not name `VERIFY`

`cafe.html` is the most complete demo in the repo — 12 committed images, 12 manifest
slots, a full credits trail, a carousel entry at `Homepage.tsx:17`, and a slot in
`inline-demo-css.mjs:18`. It is also **not one of the six industries in the locked
decision.** Meanwhile `restaurant` is one of the six *and* is fully built, so cafe is
additive rather than a replacement.
**Resolution needed:** either amend the decision to include Café, or state explicitly
that it is an extra. Right now the most polished demo in the project is the one with no
recorded authorisation.

### C-07 — Two subsystems bypass the config layer `IN PROGRESS`

Not a decision conflict, an inconsistency. Every other subsystem reads through
`src/config.ts`, which wraps each variable with a default and documents it. Two
subsystems read `process.env` **directly**:

- `src/fana/provider.ts:11-23` — `NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `NVIDIA_API_KEY`.
  Consequence: Fana's model cannot be overridden through the config surface and Fana is
  invisible to `/api/models`.
- `src/scheduler/jobs.ts:64-65` — `SEAI_SCHEDULER`. Consequence: the scheduler's
  on/off decision is invisible to config, and this one is *safety-relevant* — on Vercel
  the guard is `process.env.VERCEL` returning early, which is correct but only because
  the check was written twice rather than once.

Either deliberate isolation or an oversight in both cases. `[VERIFY]` with the author.

## Superseded, not conflicting

`seai.payments/ARCHITECTURE_ASSESSMENT.md:31,166` lists the older prices ₹12,999 /
₹14,999 / ₹17,999 **alongside** the current ₹2,999 / ₹4,999 / ₹7,999 as part of a
price-change analysis. This is a historical record, not a live discrepancy. **Do not
"correct" it.** The current catalogue is consistent everywhere else.

## Open decisions needing a human

1. Which host is canonical for CDF, and what role does `gateway.seai.store` play? (C-01, C-05)
2. Is `www.seai.store` live, and does it redirect to the apex? (C-02)
3. Implement the sharp black carousel frame, or amend the decision? (C-03)
4. Which repo hosts the order-creation endpoint, and how does a static public site hold
   a Razorpay secret? (C-04)
5. Confirm the three plan prices are final. (currently `LOCKED` and consistent — but
   the decision predates any money actually changing hands)
6. Is the brain vault a production system or a local developer tool? See
   [[10 — Deployment & Operations]].

## Related

- [[01 — Business Model]] · [[03 — Domains & Infrastructure]] · [[12 — Agent Roles]] ·
  [[13 — Launch Checklist]] · [[15 — Known Issues]]
