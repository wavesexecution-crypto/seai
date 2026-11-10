---
title: SEAI — Master Context
updated: 2026-09-27T00:00:00.000Z
type: master-context
scope: seai
status: IN PROGRESS
provenance: user-provided intent + code-verified 2026-09-27
---

# SEAI — Master Context

Canonical entry point for the SEAI project. Start here, then follow the links.

> This is a **persistent knowledge layer**, not live runtime state. Live state lives in
> Postgres (`seai`, `seai.payments`) and Shopify. Never treat this note as a database.

**Evidence date:** 2026-09-27. Anything marked `[VERIFY]` was not confirmed in code or environment.

## The one-paragraph version

SEAI sells AI-built websites to real businesses. Three separate repos cooperate:
`seai.public` (marketing site + demo showroom + intake) sells and captures leads,
`seai` (CDF — Customer Dashboard/Fulfillment) is the operator + customer control centre and
owns the customer relationship and email system, and `seai.payments` owns Razorpay and all
authoritative payment state. Fana is the customer-facing AI assistant inside CDF. The
one-time purchase is a website; the ongoing relationship is a maintenance relationship.

## Non-negotiable rules for every agent

1. **No secrets in Obsidian.** Never write API keys, passwords, tokens, SMTP credentials,
   Razorpay keys, Shopify credentials, or customer payment data. Record only variable *names*.
2. **Never invent facts.** Mark anything unverified as `[VERIFY]` with a provenance tag.
3. **Provenance tags:** `user-provided`, `code-verified`, `inferred`, `assumed`, `unknown`.
4. **Status vocabulary:** `LOCKED`, `IN PROGRESS`, `BLOCKED`, `COMPLETE`, `VERIFY`, `FUTURE`.
5. **Update, don't duplicate.** Check this folder and the existing store-scoped vault before
   creating a new note.
6. **Conflicts go in the log.** If the codebase contradicts a decision, record the observed
   reality in [[14 — Decisions Log]] rather than silently rewriting the decision.

## The three-repository architecture

```
                    ┌──────────────────────────────────────────┐
                    │  seai.public   (Vite + React 19)         │
                    │  seai.store — marketing, demos, intake   │
                    └───────────────┬──────────────────────────┘
                                    │  BROKEN: no checkout code exists
                                    │  no Razorpay, no SDK, no calls
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  seai.payments  (Express 4 + TS ESM)     │
                    │  payments.seai.store — Razorpay, orders  │
                    │  9 tables, idempotency layer, webhooks   │
                    └───────────────┬──────────────────────────┘
                                    │  BROKEN: no outbox relay
                                    │  nothing is ever published
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  seai = CDF  (Express 4 + TS, vanilla-JS UI)  │
                    │  dash.seai.store / gateway.seai.store    │
                    │  operator console + customer control ctr │
                    │  Fana + email system + brain vault       │
                    └──────────────────────────────────────────┘
```

**This diagram is the single most important fact in this knowledge base:** both
cross-service arrows are currently *dashed and broken*. Nothing is wired between
`seai.public` and `seai.payments`, and nothing is wired from `seai.payments`
back into `seai`. See [[08 — Payments]] and [[15 — Known Issues]].

## Note index

| Note | Covers |
|---|---|
| [[01 — Business Model]] | What is sold, to whom, at what price, and the maintenance/recurring gap |
| [[02 — Architecture]] | System topology, request flow, data stores, trust boundaries |
| [[03 — Domains & Infrastructure]] | Every hostname found in code, what it is for, and which are contradictory |
| [[04 — CDF]] | `D:\seai` — operator dashboard, customer control centre, gateway sub-service |
| [[05 — Fana]] | Customer-facing AI assistant: model, tools, safety rules, state |
| [[06 — Public Site]] | `D:\seai.public` — marketing site, demo showroom, intake, FOUC status |
| [[07 — Demo Sites]] | Seven demo sites, the image manifest, the carousel asset rules |
| [[08 — Payments]] | `D:\seai.payments` — Razorpay, orders, webhooks, the blocking defects |
| [[09 — Email System]] | 31 templates, HMAC event intake, retries, delivery records |
| [[10 — Deployment & Operations]] | Vercel, Docker, migrations, environments, runbook |
| [[11 — Security]] | Findings across all three repos, ranked by severity |
| [[12 — Agent Roles]] | Which agent owns which repo, decision rights, escalation |
| [[13 — Launch Checklist]] | The ordered path from now to public launch |
| [[14 — Decisions Log]] | Locked decisions plus code-vs-decision contradictions |
| [[15 — Known Issues]] | Every confirmed defect and gap, with file:line evidence |
| [[16 — Client Dashboard]] | The customer control centre A-to-Z: both frontends, every section, the data model, auth, K-48 |

## Current project status at a glance

| Component | Status | Confidence |
|---|---|---|
| CDF operator console | `COMPLETE`, live in production | high |
| **CDF client dashboard** | **`COMPLETE`, live in production** (all 3 sections resolve) | high |
| Email system | **`COMPLETE` and delivering in production** — welcome, password reset, payment events all `250 OK` | high |
| Fana | `IN PROGRESS` — implemented, no live-model evidence | medium |
| Public site | `COMPLETE`, live at `seai.store` | high |
| Demo sites | `IN PROGRESS` — 7 pages, clinic demo has no images | high |
| Payments service | **`DEPLOYED`** at `payments.seai.store`, Neon DB migrated, webhook signature verification live | high |
| Public ↔ payments integration | `BLOCKED` — no checkout flow on the public site | high |
| Payments → email | **`COMPLETE`** — transactional outbox + HMAC relay, verified end to end | high |
| Domain / canonical URL | `BLOCKED` — `www.seai.store` has no DNS record | high |

> **Production state as of 2026-09-29.** All three services are deployed with valid TLS
> and are reachable: `seai.store`, `dash.seai.store`, `payments.seai.store`. Real email
> now delivers end to end, verified against Gmail (`250 2.0.0 OK`), including a
> payment-successful email produced by the payments outbox → HMAC relay → CDF → SMTP
> chain, and a replayed event proven to send exactly one email.
>
> Two earlier findings in this vault were **wrong and have been corrected**: the CDF
> was never missing an entrypoint (Vercel uses the Express preset), and K-48
> (`/modify` + `/maintenance` 404) was a false alarm from reading `vercel.json` without
> testing the live host. See [[10 — Deployment & Operations]] and [[15 — Known Issues]].

## How to read the other store-scoped notes

`D:\seai\brain` already contained a Shopify store-operations brain
(`00_SYSTEM`, `01_PORTFOLIO`, `02_STORES`, `03_MARKET`, `04_EXPERIMENTS`,
`05_DECISIONS`, `06_LEARNINGS`, `07_ARCHIVE`, 101 notes). That is a **different
scope** — per-store optimisation, not the SEAI product business. It was left
untouched. The SEAI project notes live in this `SEAI/` subfolder. The
`Portfolio Overview` note describing "six independent store experiments" does not
describe this business and must not be treated as authoritative for SEAI.

See [[00_SYSTEM/README]] and [[00_SYSTEM/Memory Rules]] for the inherited vault rules.
