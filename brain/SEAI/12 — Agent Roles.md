---
title: SEAI — Agent Roles
updated: 2026-09-27T00:00:00.000Z
type: governance
scope: seai
status: IN PROGRESS
provenance: user-provided intent + code-verified 2026-09-27
---

# SEAI — Agent Roles

Who owns what, and who may decide what. This note exists so that two agents never edit
the same thing, and so no agent silently changes a locked decision.

## Repository ownership

| Repo | Owner agent | Owns | Must not touch |
|---|---|---|---|
| `D:\seai.public` | **public-site** agent | Marketing site, demo showroom, intake flow, examples carousel, legal pages, public copy | Payment logic, order state, customer data, email templates |
| `D:\seai` (CDF) | **cdf** agent | Operator console, customer control centre, Fana, email system, brain vault, Shopify gateway config | Plan pricing authority, Razorpay SDK usage, public site copy |
| `D:\seai.payments` | **payments** agent | Razorpay, orders, payments, refunds, idempotency, webhooks, outbox, the **authoritative plan prices** | Email rendering, customer-facing copy, public site layout |
| `D:\seai\brain` (this vault) | **knowledge** agent | These 16 notes and the store-scoped brain | Application code in any repo |

`seai.payments` is the single source of truth for plan prices. `seai.public` displays
them and currently duplicates them four times — a public-site change to pricing must be
coordinated with payments, never authored independently.

## Operating modes

`AUTONOMY_LEVEL` in `src/config.ts:10`, default **`EXECUTE_SAFE`**. Recognised values:
`OBSERVE`, `ASSIST`, `EXECUTE_SAFE`, `AUTONOMOUS`. The default is the correct posture
for a production system holding live Shopify write scopes. Raising it to `AUTONOMOUS`
should be an explicit, recorded human decision, not a default.

Bounds: `AGENT_MAX_ITERATIONS` (default 12) and `AGENT_REQUEST_TIMEOUT_MS` (default
60000).

## Fana's authority — deliberately narrow

Fana is a **customer-facing assistant, not a developer tool and not an operator tool.**
Its scope is stated in `src/fana/agent.ts:4-20` and enforced in `src/fana/tools.ts`.

**Fana may:** read the customer's own website, analytics, maintenance state and change
requests; create a change draft; submit a change request **after the customer explicitly
confirms**; answer questions about the customer's own SEAI site.

**Fana may never:** deploy or modify a website, DNS, hosting, SSL, a database, or
payment state; claim a change is complete unless the backend says so; fabricate metrics,
statuses, prices or dates; invent payment or subscription state; submit a change without
confirmation or skip the draft step.

Fana's seven tools are read-mostly; only `create_change_draft` and `submit_change_request`
write, and both are hard-scoped to the session user. **No agent should extend Fana's tool
set without a recorded decision.** A new write tool is a security change, not a feature
change.

## Decision rights

| Decision | Who decides | Recorded in |
|---|---|---|
| Domain and canonical URL | Human only | [[14 — Decisions Log]] |
| Plan pricing | Human; implemented by payments agent | [[01 — Business Model]] |
| Launch readiness ("are we live?") | Human only | [[13 — Launch Checklist]] |
| Payment correctness and idempotency | Payments agent, human reviews | [[08 — Payments]] |
| Email content and triggers | CDF agent | [[09 — Email System]] |
| Public copy, demo assets, design | Public-site agent | [[06 — Public Site]] |
| Fana behaviour, tools, model | Human approves; CDF agent implements | [[05 — Fana]] |
| Deploying to production | Human only | [[10 — Deployment & Operations]] |
| Editing this vault | Knowledge agent | `00 — MASTER CONTEXT` |

## Standing rules for any agent

1. **Never write a secret into this vault.** Variable *names* only. See [[11 — Security]].
2. **Never overwrite a decision.** If code contradicts a locked decision, write the
   observed reality into [[14 — Decisions Log]] with file:line evidence and stop. Do not
   silently "fix" either side.
3. **Never run a real send.** `npm run email:preview -- --send=…` sends 31 real emails.
   It requires an explicit human instruction, every time.
4. **Never migrate production without a backup and a human present.**
5. **Never reset the dirty `D:\seai` worktree.** It holds uncommitted email and Fana work.
6. **Mark uncertainty as `[VERIFY]`** rather than guessing. An honest unknown is more
   useful than a confident fabrication.
7. **Preserve accessibility work.** The demo carousel's real focus rings
   (`fan-carousel.css:111-128`) were added deliberately to fix a keyboard-accessibility
   regression. Do not reintroduce `outline: none` without an equivalent.

## Escalation

If an agent finds a defect that spans repos — for example public copy promising a payment
flow that does not exist — the correct move is to record it in [[15 — Known Issues]] with
evidence and surface it, **not** to implement a cross-repo fix unilaterally.

## Related

- [[05 — Fana]] · [[11 — Security]] · [[13 — Launch Checklist]] ·
  [[14 — Decisions Log]]
