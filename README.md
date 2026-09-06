# SEAI V1 — AI that operates your Shopify business

Autonomous commerce operating system for Shopify. Shopify is the commerce
infrastructure; SEAI is the intelligence, reasoning, decision, execution,
experimentation, monitoring, and optimization layer.

```
SHOPIFY → SEAI → OBSERVE → UNDERSTAND → REASON → DECIDE → ACT → MEASURE → LEARN → REPEAT
```

## Quickstart (first-run)

1. `npm install`
2. `cp .env.example .env` — fill **only** the six `OLLAMA_API_KEY_*` values.
   Get keys at https://ollama.com/settings/keys (Ollama Cloud, `https://ollama.com/api`).
3. Shopify Partner dashboard → create app → set App URL `http://localhost:3000`,
   redirect `http://localhost:3000/auth/callback`, paste Client ID/Secret into
   `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. Or use Shopify CLI with `shopify.app.toml`.
4. `npm run db:migrate` (needs `DATABASE_URL`; without it SEAI runs on a safe
   in-memory store for dev/tests — Postgres schema in `src/db/schema.sql` is canonical).
5. `npm run dev` → open http://localhost:3000
6. Enter `your-store.myshopify.com` → **Connect Shopify** (OAuth; no manual token paste).
7. **Validate 6 keys** → model discovery picks the strongest tool-capable model.
8. Run **"Analyze my store."** — the agent performs iterative Shopify tool calls,
   policy-gated, and writes decisions/memories. Restart-safe (all runs persist).

## Architecture (layers are separate)

- `src/ai/gateway.ts` — ONLY module that touches Ollama keys. 6-key pool,
  health/cooldown/failover, timeout, error classification, discovery, scoring,
  `generate/chat/toolCall/stream/listModels/getModelCapabilities`.
- `src/shopify/` — OAuth (`app.ts`), encrypted sessions, GraphQL client with
  throttling/pagination (`client.ts`), typed services (`services.ts`), scope
  registry (`scopes.ts`). Agent code never writes raw GraphQL.
- `src/agent/` — tool registry (`tools.ts`), policy-gated executor
  (`executor.ts`), iterative loop (`loop.ts`), context budgets (`context.ts`).
- `src/policy/autonomy.ts` — OBSERVE/ASSIST/EXECUTE_SAFE/AUTONOMOUS gate between model and Shopify.
- `src/intelligence/commerce.ts` — revenue/orders/AOV/concentration with interpretation.
- `src/decisions`, `src/experiments`, `src/memory`, `src/scheduler`, `src/events`,
  `src/security`, `src/db` (Postgres-first, store-scoped everywhere).

## Autonomy

Default `AUTONOMY_LEVEL=EXECUTE_SAFE`: reads + safe reversible writes auto-run;
high-risk (big discounts, deletes, price/theme changes) requires the
**confirm writes** checkbox (explicit authorization) until policy permits.
The model can never bypass `evaluatePolicy` → `executeTool`.

## Tests

`npm test` — gateway failover/rate-limit/discovery, policy, schemas,
Shopify pagination + no-blind-mutation-retry, end-to-end read-only agent run
(mocked Shopify), webhooks, experiments, encryption. All green required.

## Security

Keys/tokens/secrets never reach the browser, model, logs, Git, or error
responses. Sessions encrypted at rest (`SEAI_ENCRYPTION_KEY`). Tool args are
Zod-validated against an allowlist. `.gitignore` blocks `.env`.
