import express, { type Express } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config, configuredKeyCount } from './config.js';
import { db } from './db/db.js';
import { authRouter } from './auth/routes.js';
import { requireAuthRedirect, requireAuth } from './auth/middleware.js';
import { aiGateway } from './ai/gateway.js';
import { runAgent } from './agent/loop.js';
import { listTools } from './agent/tools.js';
import { scopeReasons, validateScopes } from './shopify/scopes.js';
import { PERMISSION_REGISTRY, requiredScopes, validateRegistry } from './shopify/permissions.js';
import { saveSession, getAccessToken } from './shopify/sessions.js';
import { ShopService } from './shopify/services.js';
import { shopify } from './shopify/app.js';
import { verifyWebhook, enqueueEvent } from './events/webhooks.js';
import { startScheduler } from './scheduler/jobs.js';
import { Decisions } from './decisions/engine.js';
import { Experiments } from './experiments/engine.js';
import { listSlots, assignSlot } from './stores/registry.js';
import { Strategies } from './stores/strategies.js';
import { listConnections, verifyConnection, recordConnection, normalizeShop } from './stores/connections.js';
import { portfolioRollup } from './portfolio/intelligence.js';
import { startCreation, getCreation, approveSteps } from './creation/pipeline.js';
import { getBlueprint } from './blueprint/compiler.js';
import { bootstrapVault, vaultInfo } from './brain/bootstrap.js';
import { listNotes, readNote } from './brain/vault.js';
import { validateImport, type SourcedRow } from './sourcing/providers.js';
import { executeTool } from './agent/executor.js';
import { assertNoSecretsInResponse } from './security/validate.js';
import { embedRouter } from './routes/embed.js';

const app = express();
const here = dirname(fileURLToPath(import.meta.url));

// Lazy boot: the serverless preset imports this module without calling
// createApp(), so the FIRST request in any instance initializes shared state
// (db, vault, scheduler) exactly once, then proceeds. Local server.ts goes
// through the same path via createApp(). Boot never fails a request.
let boot: Promise<void> | null = null;
function ensureBoot(): Promise<void> {
  if (!boot) {
    boot = (async () => {
      try { await db.init(); } catch { /* memory fallback */ }
      try { bootstrapVault(); } catch { /* read-only fs */ }
      try { startScheduler(); } catch { /* never crash on schedule */ }
    })();
  }
  return boot;
}
app.use((_req, _res, next) => { ensureBoot().then(() => next()).catch(next); });

// Webhooks need raw body for HMAC — mount before json()
app.post('/webhooks/:topic', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const hmac = req.header('X-Shopify-Hmac-Sha256') ?? '';
  const shop = req.header('X-Shopify-Shop-Domain') ?? '';
  const topic = req.params.topic;
  if (!verifyWebhook(req.body as Buffer, hmac)) { res.status(401).send('bad hmac'); return; }
  let payload: any = {};
  try { payload = JSON.parse((req.body as Buffer).toString('utf8')); } catch { /* ignore */ }
  const id = await enqueueEvent(shop, topic, payload);
  // GDPR compliance: immediate deletion for redact topics (gateway owns token deletion,
  // SEAI deletes its own events/sessions for that shop). Return 200 quickly but
  // ensure data is purged for App Store review.
  if (topic === 'shop/redact' || topic === 'customers/redact' || topic === 'customers/data_request') {
    // fire-and-forget purge, do not block webhook response
    (async () => {
      try {
        if (topic === 'shop/redact') {
          try { await db.query('DELETE FROM shopify_sessions WHERE shop = $1', [shop]); } catch {}
          try { await db.query('DELETE FROM stores WHERE shop_domain = $1', [shop]); } catch {}
          try { await db.query('DELETE FROM events WHERE shop = $1', [shop]); } catch {}
          try { await db.query('DELETE FROM agent_runs WHERE store_id = $1', [shop]); } catch {}
        } else if (topic === 'customers/redact') {
          const custId = payload?.customer?.id || payload?.id;
          if (custId) {
            try { await db.query('DELETE FROM events WHERE payload::text LIKE $1', [`%${custId}%`]); } catch {}
          }
        }
        // customers/data_request is read-only — just log, no deletion
      } catch (e) { console.warn('[gdpr] purge failed', String((e as Error).message).slice(0,120)); }
    })();
  }
  res.status(202).json({ ok: true, eventId: id });
});

app.use(cors());
app.use(morgan('tiny'));
// First-party security headers. Inline to avoid a CJS-typings dependency entirely.
// CSP frame-ancestors replaces X-Frame-Options (which would block Shopify embedding).
// 'self' allows same-origin framing; Shopify Admin origins are explicitly allowed.
// default-src 'self' prevents loading scripts/styles from arbitrary origins.
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader(
    'Content-Security-Policy',
    [
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
      "default-src 'self'",
      // App Bridge + Shopify embed SDK are loaded from Shopify's CDN.
      "script-src 'self' https://cdn.shopify.com https://shopify-embed.shopifycloud.com",
      // App Bridge loads styles and makes XHR/fetch calls to the shop's admin.
      "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
      "img-src 'self' data: https://cdn.shopify.com",
      "connect-src 'self' https://*.myshopify.com https://admin.shopify.com",
    ].join('; ')
  );
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Auth API routes (sign-in, sign-up, forgot-password, reset-password, etc.)
app.use('/api/auth', authRouter);

// Shopify embedded gateway entry point (Phase 6). Mounts before the SPA shell
// so the ticket can be consumed and a session established on first load.
app.use('/embed', embedRouter);

// Protect all data API routes — require valid session (skip health + auth)
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

// Auth page routes — serve auth HTML pages
function authHtml(filename: string): string {
  for (const p of [join(here, 'public', filename), join(here, '..', 'public', filename)]) {
    try { accessSync(p, constants.R_OK); return p; } catch { /* try next */ }
  }
  return join(here, '..', 'public', filename);
}
for (const p of ['/sign-in', '/create-account', '/forgot-password', '/reset-password', '/verify-email']) {
  app.get(p, (_req, res) => { res.sendFile(authHtml(p.slice(1) + '.html')); });
}
// App Store required legal pages — serve at clean URLs without .html
for (const p of ['/privacy', '/terms', '/support']) {
  app.get(p, (_req, res) => { res.sendFile(authHtml(p.slice(1) + '.html')); });
}
app.use(express.static(join(here, '..', 'public')));

// VX page routes — every route serves the app shell; the client router renders the view.
// Prefers the build-bundled copy (dist/public, self-contained for serverless),
// falling back to the source tree for local dev.
function shellHtml(): string {
  for (const p of [join(here, 'public', 'index.html'), join(here, '..', 'public', 'index.html')]) {
    try { accessSync(p, constants.R_OK); return p; } catch { /* try next */ }
  }
  return join(here, '..', 'public', 'index.html');
}
for (const p of ['/overview', '/command', '/activity', '/provider', '/tools', '/system', '/portfolio', '/creation', '/start']) {
  app.get(p, requireAuthRedirect, (_req, res) => { res.sendFile(shellHtml()); });
}

const errSafe = (e: any) => ({ error: String(e?.message ?? e).slice(0, 500), code: e?.code });

export function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

// ---- Health / status ----
app.get('/api/health', async (_req, res) => {
  const keys = await aiGateway.keyHealth();
  res.json({
    ok: true, service: 'seai', driver: db.driver,
    autonomy: config.autonomyLevel,
    operator: config.operatorName,
    ollama: { configured: configuredKeyCount(), required: 6, keys: keys.map((k) => ({ keyId: k.keyId, status: k.status, requests: k.requestCount, avgLatencyMs: k.avgLatencyMs })) },
    shopify: { apiVersion: config.shopify.apiVersion, appConfigured: Boolean(config.shopify.apiKey && config.shopify.apiSecret) },
    runtime: isVercel() ? 'vercel' : 'node',
  });
});

app.get('/api/models', async (_req, res) => {
  try {
    const models = await aiGateway.listModels();
    const best = models[0]?.name ?? null;
    res.json({ ok: true, best, primary: config.aiPrimaryModel || null, count: models.length, models: models.slice(0, 30) });
  } catch (e: any) { res.status(503).json({ ok: false, ...errSafe(e) }); }
});

app.post('/api/ai/validate', async (_req, res) => {
  const keys = await aiGateway.validateKeys();
  res.json({ ok: true, keys }); // masked ids + status only, never secrets
});

app.get('/api/scopes', (_req, res) => {
  const v = validateScopes(config.shopify.scopes);
  const r = validateRegistry(config.shopify.scopes);
  res.json({ ok: true, scopes: config.shopify.scopes, reasons: scopeReasons(), unknown: v.unknown, registry: PERMISSION_REGISTRY, missingRequired: r.missingRequired });
});

// ---- Shopify OAuth (user never pastes a token) ----
app.get('/auth', async (req, res) => {
  const shop = normalizeShop(req.query.shop);
  if (!shop) { res.status(400).send('missing ?shop=xxx.myshopify.com (bare store domain only)'); return; }
  try {
    await shopify.auth.begin({
      shop, callbackPath: '/auth/callback', isOnline: false, rawRequest: req, rawResponse: res,
    });
  } catch (e: any) { res.status(500).send(`auth begin failed: ${e.message}`); }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const cb: any = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
    const session = cb.session;
    await saveSession(session.shop, session.accessToken!, session.scope, session.isOnline);
    // Verify identity with a real Admin API read, THEN record. No session ⇒ no store.
    const v = await verifyConnection(session.shop);
    if (v.ok && v.identity) {
      await recordConnection(v.identity);
      try {
        const slots = await listSlots();
        const taken = new Set(slots.map((s) => s.shop));
        const free = slots.find((s) => !s.shop);
        if (free && !taken.has(session.shop)) await assignSlot(free.slot, session.shop);
      } catch { /* slot assignment is best-effort */ }
      try {
        await db.insert('audit_logs', { id: randomUUID(), store_id: session.shop, actor: 'system', action: 'shopify.connected', details: JSON.stringify({ shop: session.shop, name: v.identity.name, scope: session.scope }), created_at: new Date().toISOString() });
      } catch { /* ignore */ }
    }
    res.redirect(`/?shop=${encodeURIComponent(session.shop)}&connected=1`);
  } catch (e: any) { res.status(500).send(`auth callback failed: ${e.message}`); }
});

// Connected stores = verified OAuth sessions. The ONLY source of truth.
app.get('/api/stores', async (_req, res) => {
  res.json({ ok: true, connections: await listConnections() });
});

// ---- Agent command interface ----
// Pre-flight: an agent NEVER runs without a verified live Shopify session.
// No session ⇒ 409. No store records are fabricated here.
app.post('/api/agent/run', async (req, res) => {
  const { shop, prompt, confirmed } = req.body ?? {};
  if (!shop || !prompt) { res.status(400).json({ ok: false, error: 'shop and prompt required' }); return; }
  const clean = normalizeShop(shop);
  if (!clean) { res.status(400).json({ ok: false, code: 'BAD_SHOP', error: 'not a valid myshopify.com store domain' }); return; }
  try {
    const v = await verifyConnection(clean);
    if (!v.ok) {
      res.status(409).json({ ok: false, code: 'NO_STORE_CONNECTED', error: v.error ?? 'Connect a Shopify store before running this command.' });
      return;
    }
    const accessToken = (await getAccessToken(clean)) ?? undefined;
    const out = await runAgent({ shop: clean, storeId: clean, prompt: String(prompt), confirmed: Boolean(confirmed), accessToken });
    res.json({ ok: true, ...out });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

app.get('/api/runs', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  try {
    const runs = await db.list('agent_runs', storeId ? ({ store_id: storeId } as any) : {}, 20);
    const safe = runs.map((r) => ({ ...r }));
    assertNoSecretsInResponse(safe);
    res.json({ ok: true, runs: safe });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

app.get('/api/runs/:id', async (req, res) => {
  try {
    const steps = await db.list('agent_steps', { run_id: req.params.id } as any, 100);
    const tools = await db.list('tool_calls', { run_id: req.params.id } as any, 100);
    res.json({ ok: true, steps, toolCalls: tools.map((t) => ({ ...t, args: safeJson(t.args), result: safeJson(t.result) })) });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

function safeJson(v: any) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } }

app.get('/api/decisions', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  res.json({ ok: true, decisions: storeId ? await Decisions.recent(storeId).catch(() => []) : [] });
});

app.get('/api/experiments', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  res.json({ ok: true, experiments: storeId ? await Experiments.list(storeId) : [] });
});

app.get('/api/tools', (_req, res) => {
  res.json({ ok: true, tools: listTools().map((t) => ({ name: t.name, description: t.description, permission: t.requiredPermission, risk: t.riskLevel, confirm: t.requiresConfirmation, reversible: t.reversible, idempotent: t.idempotent })) });
});

// ---- Multi-store: slots, strategy, portfolio (all neutral; no predetermined niche) ----
app.get('/api/portfolio', async (_req, res) => {
  try {
    const [rollup, slots] = await Promise.all([portfolioRollup(), listSlots()]);
    res.json({ ok: true, ...rollup, slots });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

app.post('/api/portfolio/assign', async (req, res) => {
  try {
    const { slot, shop } = req.body ?? {};
    if (!slot || !shop) { res.status(400).json({ ok: false, error: 'slot (1-6) and shop required' }); return; }
    const out = await assignSlot(Number(slot), String(shop));
    try {
      await db.insert('audit_logs', { id: randomUUID(), store_id: out.shop, actor: 'user', action: 'store.assigned', details: JSON.stringify({ slot: out.slot, shop: out.shop }), created_at: new Date().toISOString() });
    } catch { /* ignore */ }
    res.json({ ok: true, slot: out });
  } catch (e: any) { res.status(400).json({ ok: false, ...errSafe(e) }); }
});

app.get('/api/strategy', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  if (!storeId) { res.status(400).json({ ok: false, error: 'storeId required' }); return; }
  res.json({ ok: true, strategy: await Strategies.get(storeId) });
});

// ---- Zero-config onboarding: EXACTLY two inputs (domain + free-form context) ----
app.post('/api/onboard', async (req, res) => {
  try {
    const { validateOnboardInput } = await import('./blueprint/compiler.js');
    const { domain, context } = validateOnboardInput(req.body?.domain, req.body?.context);
    // Resolve the domain to a CONNECTED store: exact primary-domain match, else the
    // single connected store if only one exists. Never invent a connection.
    const connections = await listConnections();
    let match: string | null = null;
    if (connections.length === 1) {
      match = connections[0].shop;
    } else if (connections.length > 1) {
      const identities = await Promise.all(connections.map(async (c) => {
        try {
          const info: any = await ShopService.getStore(c.shop, (await getAccessToken(c.shop)) ?? undefined);
          return { shop: c.shop, primary: String(info?.primaryDomain?.host ?? '').toLowerCase() };
        } catch { return { shop: c.shop, primary: '' }; }
      }));
      const hit = identities.find((i) => i.primary === domain);
      if (hit) match = hit.shop;
    }
    if (!match) {
      res.status(409).json({
        ok: false, code: 'NO_MATCHING_STORE',
        error: connections.length === 0
          ? 'No Shopify store is connected. Connect the store with this domain first, then create.'
          : `Domain ${domain} does not match a connected store. Connect it first, then create.`,
        connected: connections.length,
      });
      return;
    }
    const out = await startCreation(match, { domain, context });
    const bp = await getBlueprint(match);
    res.json({ ok: true, storeId: match, ...out, blueprint: bp?.blueprint ?? null });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    res.status(msg.includes('domain') || msg.includes('tell SEAI') || msg.includes('too long') ? 400 : 500).json({ ok: false, ...errSafe(e) });
  }
});

app.get('/api/blueprint', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  if (!storeId) { res.status(400).json({ ok: false, error: 'storeId required' }); return; }
  const { getBlueprint: getBp, summarizeBlueprint } = await import('./blueprint/compiler.js');
  const bp = await getBp(storeId);
  if (!bp) { res.json({ ok: true, blueprint: null }); return; }
  res.json({ ok: true, domain: bp.domain, status: bp.status, sections: summarizeBlueprint(bp.blueprint) });
});

// ---- Autonomous store creation pipeline ----
app.post('/api/creation/start', async (req, res) => {
  try {
    const { shop, customDomain, domain, context } = req.body ?? {};
    if (!shop) { res.status(400).json({ ok: false, error: 'shop required' }); return; }
    if (customDomain && !/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,}$/i.test(String(customDomain).trim())) {
      res.status(400).json({ ok: false, error: 'customDomain is not a valid domain' });
      return;
    }
    const out = await startCreation(String(shop), {
      customDomain: customDomain ? String(customDomain).trim().toLowerCase() : undefined,
      domain: domain ? String(domain).trim().toLowerCase() : undefined,
      context: context ? String(context) : undefined,
    });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    const err = errSafe(e);
    const code = (e as any)?.code === 'NO_STORE_CONNECTED' ? 409 : 400;
    res.status(code).json({ ok: false, code: (e as any)?.code ?? err.error, error: err.error });
  }
});

app.get('/api/creation/:id', async (req, res) => {
  const run = await getCreation(req.params.id);
  if (!run) { res.status(404).json({ ok: false, error: 'creation run not found' }); return; }
  res.json({ ok: true, run });
});

app.get('/api/creation', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  if (!storeId) { res.status(400).json({ ok: false, error: 'storeId required' }); return; }
  try {
    const runs = await db.list('creation_runs', { store_id: storeId } as any, 1);
    if (!runs[0]) { res.json({ ok: true, run: null }); return; }
    res.json({ ok: true, run: await getCreation(runs[0].id) });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

app.post('/api/creation/:id/approve', async (req, res) => {
  try {
    const { stepIds } = req.body ?? {};
    if (!Array.isArray(stepIds) || !stepIds.length) { res.status(400).json({ ok: false, error: 'stepIds[] required' }); return; }
    res.json({ ok: true, ...(await approveSteps(req.params.id, stepIds.map(String))) });
  } catch (e: any) { res.status(400).json({ ok: false, ...errSafe(e) }); }
});

// Grounded product import: real rows in, real products out. Nothing invented.
app.post('/api/creation/import', async (req, res) => {
  try {
    const { shop, rows, confirmed } = req.body ?? {};
    const clean = normalizeShop(shop);
    if (!clean) { res.status(400).json({ ok: false, error: 'valid shop required' }); return; }
    const v = await verifyConnection(clean);
    if (!v.ok) { res.status(409).json({ ok: false, code: 'NO_STORE_CONNECTED', error: v.error }); return; }
    const parsed = validateImport(rows);
    if (!parsed.ok) { res.status(400).json({ ok: false, error: parsed.error }); return; }
    const token = (await getAccessToken(clean)) ?? undefined;
    const created: any[] = [];
    for (const r of parsed.rows as SourcedRow[]) {
      const out = await executeTool('products.create',
        { title: r.title, descriptionHtml: r.descriptionHtml, vendor: r.vendor, productType: r.productType, tags: r.tags },
        { shop: clean, storeId: clean, runId: `import-${Date.now()}`, confirmed: Boolean(confirmed), accessToken: token });
      if (!out.ok) { res.status(502).json({ ok: false, error: out.error, created }); return; }
      created.push(out.result);
    }
    res.json({ ok: true, created: created.length, products: created });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

// ---- Admin/debug: provider health, runs, errors, latency (no secrets ever) ----
app.get('/api/admin/overview', async (_req, res) => {
  try {
    const [keys, models, runs, events, reqs] = await Promise.all([
      aiGateway.keyHealth(),
      aiGateway.listModels().catch(() => []),
      db.list('agent_runs', {}, 10).catch(() => []),
      db.list('events', {}, 10).catch(() => []),
      db.list('ai_requests', {}, 20).catch(() => []),
    ]);
    res.json({
      ok: true,
      provider: { keys, activeModel: models[0]?.name ?? null, modelCount: models.length },
      runs: runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, model: r.model, started: r.started_at })),
      events: events.map((e) => ({ id: e.id, topic: e.topic, status: e.status, shop: e.shop })),
      aiLatency: reqs.map((r) => ({ model: r.model, ms: r.latency_ms, ok: r.ok, err: r.error_class })),
      autonomy: config.autonomyLevel,
    });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

// ---- Persistent brain (Obsidian vault): knowledge index, never raw filesystem ----
app.get('/api/brain', async (_req, res) => {
  try {
    const notes = listNotes('');
    const byArea: Record<string, number> = {};
    for (const n of notes) {
      const area = n.path.split('/')[0] || 'root';
      byArea[area] = (byArea[area] ?? 0) + 1;
    }
    res.json({ ok: true, vault: vaultInfo().name, notes: notes.length, areas: byArea, recent: notes.slice(0, 12) });
  } catch (e: any) { res.status(500).json({ ok: false, ...errSafe(e) }); }
});

app.get('/api/brain/note', async (req, res) => {
  const rel = String(req.query.path ?? '');
  if (!rel.endsWith('.md')) { res.status(400).json({ ok: false, error: 'markdown notes only' }); return; }
  try {
    const body = readNote(rel);
    if (body === null) { res.status(404).json({ ok: false, error: 'note not found' }); return; }
    assertNoSecretsInResponse({ body: body.slice(0, 100) });
    res.json({ ok: true, path: rel, body: body.slice(0, 20000) });
  } catch (e: any) { res.status(400).json({ ok: false, ...errSafe(e) }); }
});

export async function createApp(): Promise<Express> {
  await ensureBoot();
  return app;
}

// Default export: Vercel's Express preset detects this file as the app
// entrypoint (imports express + default-exports the application).
export default app;
