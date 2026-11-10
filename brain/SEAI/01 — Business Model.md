---
title: SEAI — Business Model
updated: 2026-09-27T00:00:00.000Z
type: business-model
scope: seai
status: IN PROGRESS
provenance: user-provided intent + code-verified prices 2026-09-27
---

# SEAI — Business Model

## What SEAI sells

Two distinct products. Conflating them is the most common error in this project.

1. **A website** — a one-time, fixed-scope build. This is the acquisition product.
2. **A maintenance relationship** — ongoing care for a site SEAI built. This is the
   retention product. `seai` is explicitly *not* the owner of recurring maintenance
   billing in the current architecture.

## Who buys

Real businesses, not developers. The examples carousel and demo showroom target the six
`LOCKED` industries — gym, restaurant, salon, clinic, real estate, business — plus a
seventh `cafe.html` that exists in code and is, in fact, the **most complete demo in the
repo** (12 committed images vs 7–12 elsewhere). Café is not one of the six named in the
decision. These are **demos**, not customers. See [[07 — Demo Sites]] and
[[14 — Decisions Log]] C-08.

## Pricing — LOCKED and confirmed consistent in code

Three **one-time** plans, no recurring checkout in V1:

| Plan | Price | Public site (4 independent copies) | Payments authority |
|---|---|---|---|
| STARTER | **₹2,999** | `src/components/homepage/Homepage.tsx:49`, `src/intake.js:12`, `intake.html:265`, `terms.html:44` | `src/config/index.ts:33` → `amountPaise: 299900` |
| BUSINESS | **₹4,999** | `Homepage.tsx:50`, `intake.js:13`, `intake.html:273`, `terms.html:44` | `config/index.ts:34` → `499900` |
| COMPLETE | **₹7,999** | `Homepage.tsx:51`, `intake.js:14`, `intake.html:282`, `terms.html:44` | `config/index.ts:35` → `799900` |

All three plans are typed `one_time` in `seai.payments`. Marketing copy states
"One-time payment. No subscriptions. No monthly fees." (`Homepage.tsx:436`).

**Pricing is the one part of this project that is fully reconciled.** The public site
duplicates the catalogue four times, the payments service holds the server-authoritative
version, and they agree to the paisa. The only older figures — ₹12,999 / ₹14,999 /
₹17,999 — appear in `seai.payments/ARCHITECTURE_ASSESSMENT.md:31,166`, which lists old
and new **side by side** as part of its price-change analysis. That is a historical
record, not a live contradiction. Do not "fix" it.

> ⚠ **Caveat:** the duplication itself is a risk. Four copies of the price list in the
> public site and a fifth authoritative copy in payments means a price change needs
> five coordinated edits. `[VERIFY]` whether `intake.html` / `intake.js` prices are
> generated or hand-maintained; if hand-maintained, make `seai.payments` the single
> source and fetch at build time.

## Plan differentiation (from `Homepage.tsx:49-51`)

| | STARTER | BUSINESS (featured) | COMPLETE |
|---|---|---|---|
| Layout | single page | multi-section (5+) | everything in BUSINESS |
| Copy | professional | professional | custom copywriting, all pages |
| SEO | fundamentals | + Google Maps | full setup & submission |
| Revisions | 2 rounds | 4 rounds | unlimited, 30 days |
| Extras | — | blog/news | domain purchase, priority deploy, analytics setup, 3 months support |

## Maintenance — the retention product

**₹457**, and it is consistent across repos:

- `seai.payments/src/config/index.ts:38` → `maintenance: { amountPaise: 45700, type: 'recurring' }`
- `seai/src/config.ts:53-55` → `MAINTENANCE_PRICE_INR` default `457`, `MAINTENANCE_CURRENCY` `INR`, `MAINTENANCE_PLAN_NAME` "Website Maintenance"
- `seai/src/db/schema-customer.sql:87` → `457` default

**But the recurring subsystem does not exist.** No `maintenance_subscriptions` table in
`seai.payments`, no renewal job, no maintenance routes. The plan is unreachable dead
config. CDF has a `maintenance_subscriptions` table and Fana can *read* maintenance
status, so CDF can display a subscription it has no way to create or bill. See
[[08 — Payments]] issue 8.

## Revenue mechanics as actually built

Intended path: public site → Razorpay order → CDF order record → SEAI fulfils → customer
control centre shows the site.

**This path is not wired.** `seai.public` has no Razorpay integration, no checkout code,
and no HTTP call to `seai.payments`. Nothing collects money today. `[VERIFY]`

CDF deliberately has **no checkout** (`LOCKED`). CDF holds no product price catalogue at
all — consistent with that decision, and confirmed by a full-repo price sweep.

## Unit economics — unknown

`[VERIFY]` No margin, cost-to-serve, or pricing-rationale model exists in any repo.
Delivery labour, model inference (NVIDIA Nemotron for Fana; Ollama six-key pool and
Experiential for the operator agent), Razorpay fees (typically ~2% + GST `[VERIFY]`),
hosting, Postgres, and Vercel function costs are all unquantified. At ₹2,999 a single
percentage point of payment fee is ~₹30 — worth an explicit model before launch.

## Customer acquisition

`seai.public` owns acquisition. The intake flow (`intake.html` + `src/intake.js`) is the
lead-capture surface, and the homepage CTAs deep-link into it with the plan preselected:
`/intake.html?plan=${plan.plan}` (`Homepage.tsx:432`).

`seai.payments` is already prepared for the handoff: `domain/types.ts:92` defines a
`'seai' | 'seai.public'` customer `source` discriminator, and `scripts/schema.sql:9,12`
anticipate an `external_id` that is "user_id from seai, or intake reference from
seai.public". The schema is ready. No code performs the handoff.

## Related

- [[02 — Architecture]] · [[06 — Public Site]] · [[08 — Payments]] ·
  [[14 — Decisions Log]] · [[15 — Known Issues]]
