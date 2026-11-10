---
title: SEAI — Fana
updated: 2026-09-27T00:00:00.000Z
type: system
scope: seai
status: IN PROGRESS
provenance: code-verified 2026-09-27
---

# SEAI — Fana

Fana is the customer-facing AI assistant inside CDF. Four files, ~330 lines total:
`src/fana/provider.ts`, `agent.ts`, `tools.ts`, `routes.ts`. Schema in
`src/db/schema-fana.sql`.

**Status `IN PROGRESS`:** fully implemented and internally consistent, but there is no
evidence it has ever run against a live model. `[VERIFY]`

## Position in the architecture

Fana is *not* a developer tool and *not* an operator tool. It is the thing a paying
customer talks to about their own website. The system prompt
(`src/fana/agent.ts:4-20`) is explicit and, notably, well written:

> "You are Fana, the customer's personal SEAI website assistant… Never ask the customer
> for facts you can look up… Never invent metrics, statuses, prices, or dates — if data
> is missing, say it is not connected or unavailable."

Hard rules stated in the prompt, all of which match the project decision:

- She never modifies, deploys, or claims to deploy websites, DNS, hosting, SSL,
  databases, or payments.
- She never claims a change is completed unless the backend status says completed.
- She never fabricates payment or subscription state; she reports exactly what
  `get_maintenance_status` returns.
- She never submits a change request without explicit customer confirmation, and never
  skips the draft step.

## Model provider — matches the locked decision

`src/fana/provider.ts:11-23`

| Setting | Value |
|---|---|
| Base URL | `NVIDIA_BASE_URL`, default **`https://integrate.api.nvidia.com/v1`** |
| Model | `NVIDIA_MODEL`, default **`nvidia/nemotron-3-ultra-550b-a55b`** |
| Credential | `NVIDIA_API_KEY`, read server-side only |
| Protocol | OpenAI-compatible `POST {baseUrl}/chat/completions` |

If the key is missing, `apiKey()` throws a generic unavailability message, and
`routes.ts:42-45` short-circuits to 503 *before* any model call. Errors are mapped to a
generic 502; upstream status codes and bodies are never returned to the client. Tool
argument JSON that fails to parse is swallowed rather than crashing the turn
(`provider.ts:68-71`).

This matches the locked intent exactly: `nvidia/nemotron-3-ultra-550b-a55b` on the
NVIDIA OpenAI-compatible endpoint.

> **Configuration inconsistency worth fixing.** Fana reads `process.env` **directly**,
> bypassing the `config` module every other subsystem uses. `src/config.ts` is the
> app's single config surface (it wraps everything else in `need()` with defaults and
> documents each variable) and Fana is the one exception. The result: Fana's model
> cannot be overridden through the config layer, and Fana is invisible to
> `/api/models`. Deliberate isolation, or an oversight — `[VERIFY]`.

## Not Fana: the operator agent stack

`src/config.ts:13-31` also configures an **Ollama Cloud** pool (`https://ollama.com`,
six keys `OLLAMA_API_KEY_1`…`_6`, masked as `key_1`…`key_6`) and an **Experiential Labs**
gateway (`https://api.experientiallabs.ai/v1`, model `claude-fable-5.1`, used to route
that model through `api.experientiallabs.ai` instead of calling Anthropic directly).

These are for the **operator/agent** subsystem (`/api/agent/run`, `/api/models`).
**They are not Fana's provider.** Do not conflate them. Fana = NVIDIA Nemotron.
Operator agent = Ollama pool and/or Experiential. The two coexist in one repo and
neither references the other.

## The seven tools

Declared in `tools.ts:10-18`, dispatched in `runTool()`. The model's choice of *which*
tool is advisory; the function decides *what is allowed*.

| Tool | Reads / writes | Scoping |
|---|---|---|
| `get_website` | `customer_websites` | `{ user_id }` |
| `get_analytics_summary` | `analytics_connections`, `analytics_snapshots` | `{ user_id }` |
| `get_maintenance_status` | `maintenance_subscriptions` | `{ user_id }` |
| `get_change_requests` | `change_requests`, optional status filter, limit 50 | `{ user_id }` |
| `get_change_request` | one request + `change_messages` + `attachments` | `{ id, user_id }` |
| `create_change_draft` | **writes** `fana_drafts`, `status: 'draft'` | `{ user_id }` |
| `submit_change_request` | **writes** `change_requests` + flips draft to `submitted` | `{ id, user_id }` |

**Scoping is correct.** Every single tool takes `userId` from the authenticated session
and filters on it. `get_change_request` filters on `{ id, user_id }` together, so
guessing another customer's request UUID returns "Request not found" rather than the
row. `submit_change_request` re-checks draft ownership the same way. The browser never
supplies a customer or website id — `routes.ts` derives identity from `req.user!` only.
This satisfies the locked constraint that Fana is strictly customer-scoped.

## The change-request workflow

Fana's write path is the most interesting design in the codebase — it is a
**draft → confirm → submit** gate, and the confirmation requirement is enforced in code,
not just in the prompt:

1. `create_change_draft` requires a title and a request body; it **rejects a draft with
   no `page`** and tells the model to go ask which page. It maps `High`/`urgent` →
   `urgent`, `Medium`/`important` → `important`, else `normal`.
2. `submit_change_request` returns an error unless `args.confirmed === true`
   (`tools.ts:100`) — literally `if (args.confirmed !== true) return {error: 'The
   customer must explicitly confirm before submitting.'}`.
3. It re-verifies draft ownership, refuses to submit a draft already marked
   `submitted`, and resolves the linked website for context.
4. It flattens the draft into a human-readable `description` block prefixed
   `FANA CHANGE REPORT`, including customer identity, site, page, section, current vs
   desired state, assets, priority, and `Client confirmed: Yes`.
5. It inserts a real `change_requests` row with `status: 'submitted'` and marks the draft
   `submitted`.

The honest weakness: `confirmed: true` is set by the *model*, and the model decides
whether the customer actually confirmed. The prompt instructs it to ask
"Want me to submit this?", and there is a deliberate hint that attachments must go
through Modify because Fana cannot accept files. So the human-in-the-loop is
**model-enforced, not transport-enforced** — there is no server-side nonce proving a
customer said yes. Adequate for V1; document it as a trust assumption.

### ⚠ The "backend status" Fana defers to is customer-writable

Fana's hard rule is *"Never claim a change is completed unless the backend status says
completed"* (`agent.ts:18`). That rule is only as strong as the backend, and the
backend lets the customer set the status themselves:
`POST /api/customer/requests/:id/status` accepts **any** of
`submitted | reviewing | in_progress | waiting_for_client | completed` on the
customer's own request, with an ownership check but **no transition allow-list**
(`src/customer/routes.ts:235-241`). The comment above it says "limited client
transitions", which the code does not implement.

So a customer can mark their own change `completed`, and `notifyChangeStatus` will then
email them a completion notice. Fana's honesty rule is therefore defeatable by the very
person it is meant to protect. This is the highest-value fix in CDF: constrain the
customer route to `waiting_for_client` (and reopening) and let only SEAI-side code
advance the lifecycle. See [[15 — Known Issues]] K-20.

## Agent loop

`agent.ts:31-71`. `MAX_TURNS = 6`. History is truncated to the last 30 messages; each
tool result is JSON-serialised and cut to 4000 characters before returning to the model.
Every turn (assistant tool-call message and each tool result) is persisted to
`fana_messages`, then a final plain assistant message carrying the user-visible reply is
inserted. If the loop exhausts all 6 turns, the user gets a neutral
"Let me pause there — could you confirm how you would like to proceed?" rather than an
error — a good failure mode.

## State

`src/db/schema-fana.sql` provides `fana_conversations`, `fana_messages`, `fana_drafts`.
`activeConversation()` reuses the most recent conversation for the user or creates one.
`GET /conversation` filters persisted messages down to non-empty user/assistant text, so
tool plumbing never leaks into the UI.

## Related

- [[04 — CDF]] · [[11 — Security]] · [[15 — Known Issues]]
