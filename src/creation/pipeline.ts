import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { verifyConnection, normalizeShop } from '../stores/connections.js';
import { getAccessToken } from '../shopify/sessions.js';
import { executeTool } from '../agent/executor.js';
import { getTool } from '../agent/tools.js';
import { evaluatePolicy } from '../policy/autonomy.js';
import { config } from '../config.js';
import { aiGateway } from '../ai/gateway.js';
import { elicitOpportunities, trademarkScreen, type Opportunity } from '../research/providers.js';
import { Decisions } from '../decisions/engine.js';
import { Strategies } from '../stores/strategies.js';
import { Memory } from '../memory/store.js';
import { recordDecision } from '../brain/writer.js';
import { slotForShop } from '../stores/registry.js';
import { compileBlueprint, getBlueprint } from '../blueprint/compiler.js';
import { runReadiness, type ReadinessReport } from './readiness.js';
import { ShopService, ProductService } from '../shopify/services.js';

export type CreationPhase =
  | 'blueprint' | 'research' | 'opportunity' | 'brand' | 'catalog' | 'collections'
  | 'storefront' | 'design' | 'domain' | 'readiness' | 'launch' | 'optimize';

export const PHASES: CreationPhase[] = [
  'blueprint', 'research', 'opportunity', 'brand', 'catalog', 'collections',
  'storefront', 'design', 'domain', 'readiness', 'launch', 'optimize',
];

export type StepStatus = 'pending' | 'pending_approval' | 'approved' | 'done' | 'failed' | 'skipped';

export interface PhaseCtx {
  shop: string;
  storeId: string;
  runId: string;
  tag: string;
  accessToken?: string;
}

const MAX_PRODUCTS = Number(process.env.SEAI_CREATION_MAX_PRODUCTS ?? 10);

async function step(runId: string, phase: string, kind: string, status: StepStatus, payload: unknown, result: unknown): Promise<string> {
  const id = randomUUID();
  try {
    await db.insert('creation_steps', {
      id, run_id: runId, phase, kind, status,
      payload: JSON.stringify(payload ?? {}).slice(0, 20000),
      result: JSON.stringify(result ?? {}).slice(0, 20000),
      created_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }
  return id;
}

async function doneSteps(runId: string, phase: string): Promise<any[]> {
  try {
    const rows = await db.list('creation_steps', { run_id: runId } as any, 200);
    return rows.filter((r) => r.phase === phase && (r.status === 'done' || r.status === 'skipped'));
  } catch { return []; }
}

/** Phase completion marker — a phase resumes unless its completion step exists.
 * (Individual tool steps being done/skipped does NOT complete a phase.) */
async function phaseDone(runId: string, phase: string, kind: string): Promise<boolean> {
  return (await doneSteps(runId, phase)).some((r) => r.kind === kind);
}

async function setRun(runId: string, patch: Record<string, any>): Promise<void> {
  try {
    const rows = await db.list('creation_runs', { id: runId } as any, 1);
    if (rows[0]) await db.update('creation_runs', runId, { ...patch, updated_at: new Date().toISOString() });
  } catch { /* ignore */ }
}

/** Run one Shopify tool inside creation. High/critical risk becomes an approval step instead of executing. */
async function gatedTool(ctx: PhaseCtx, phase: string, tool: string, args: Record<string, any>, preview?: string): Promise<{ executed: boolean; stepId: string; result?: unknown; error?: string }> {
  // Idempotent resume: identical work already done/approved is never repeated
  try {
    const rows = await db.list('creation_steps', { run_id: ctx.runId } as any, 200);
    const prior = rows.find((r) => {
      if (r.phase !== phase || (r.status !== 'done' && r.status !== 'approved')) return false;
      try {
        const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        return p.tool === tool && JSON.stringify(p.args ?? {}) === JSON.stringify(args);
      } catch { return false; }
    });
    if (prior) {
      let result: unknown = {};
      try { result = typeof prior.result === 'string' ? JSON.parse(prior.result) : prior.result; } catch { /* ignore */ }
      return { executed: true, stepId: prior.id, result };
    }
  } catch { /* ignore */ }
  const def = getTool(tool);
  const risk = def?.riskLevel ?? 'medium';
  const verdict = evaluatePolicy(tool, risk, { reversible: def?.reversible ?? true, confirmed: false, autonomyLevel: config.autonomyLevel });
  if (!verdict.allowed) {
    const id = await step(ctx.runId, phase, `tool:${tool}`, 'pending_approval', { tool, args, preview: preview ?? `${tool} ${JSON.stringify(args).slice(0, 500)}`, reason: verdict.reason }, {});
    return { executed: false, stepId: id, error: verdict.reason };
  }
  const out = await executeTool(tool, args, { shop: ctx.shop, storeId: ctx.storeId, runId: ctx.runId, accessToken: ctx.accessToken });
  const id = await step(ctx.runId, phase, `tool:${tool}`, out.ok ? 'done' : 'failed', { tool, args }, out.ok ? out.result : { error: out.error });
  return out.ok ? { executed: true, stepId: id, result: out.result } : { executed: false, stepId: id, error: out.error };
}

async function modelJson(prompt: string, schema: unknown, maxTokens: number, storeId: string | null): Promise<any> {
  const raw = await aiGateway.toolCall('creation', 'SEAI store creation. Emit ONLY valid JSON matching the schema. No markdown.', schema, prompt, { maxTokens }, storeId);
  if (typeof raw === 'object' && raw !== null && !(raw as any)._raw) return raw;
  const s = typeof raw === 'string' ? raw : (raw as any)._raw ?? '';
  const cleaned = String(s).replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned);
}

// ---------------- phases ----------------

async function phBlueprint(ctx: PhaseCtx, brief: { domain?: string; context?: string }, plan?: any): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'blueprint', 'compiled')) return { blocked: [] };
  if (plan?.blueprint) {
    // Compiled at start (fail-fast); record the milestone without recompiling
    await step(ctx.runId, 'blueprint', 'compiled', 'done', { domain: brief.domain ?? null }, { sections: Object.keys(plan.blueprint).length });
    return { blocked: [] };
  }
  if (!brief.context) {
    await step(ctx.runId, 'blueprint', 'compiled', 'skipped', {}, { note: 'No user brief — fully autonomous discovery mode.' });
    return { blocked: [] };
  }
  const bp = await compileBlueprint(ctx.storeId, brief.domain ?? ctx.shop, brief.context);
  await step(ctx.runId, 'blueprint', 'compiled', 'done', { domain: brief.domain ?? null }, { sections: Object.keys(bp).length });
  return { blocked: [] };
}

function briefContext(plan: any): string {
  const b = plan?.blueprint;
  if (!b) return '';
  const pick = (sec: string, fields: string[]) => {
    const node = b[sec] ?? {};
    return fields.map((f) => node[f]?.value).filter(Boolean).join(' | ');
  };
  return [
    `USER BRIEF (domain ${plan.domain ?? 'n/a'}): ${plan.context ?? ''}`,
    `BLUEPRINT business: ${pick('business', ['concept', 'category', 'model', 'commercialObjective'])}`,
    `BLUEPRINT customer: ${pick('customer', ['target', 'needs', 'motivations'])}`,
    `BLUEPRINT product: ${pick('product', ['strategy', 'categories', 'hero', 'pricing'])}`,
    `BLUEPRINT brand: ${pick('brand', ['positioning', 'personality', 'voice', 'colors', 'typography'])}`,
    `BLUEPRINT commerce: ${pick('commerce', ['pricing', 'margins', 'aov'])}`,
    `UNKNOWN (do not invent): ${(b.unknowns ?? []).join('; ')}`,
  ].join('\n');
}

async function phResearch(ctx: PhaseCtx, plan: any): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'research', 'opportunities')) return { blocked: [] };
  const opps = await elicitOpportunities(ctx.storeId, 3, plan?.context ? briefContext(plan) : undefined);
  await step(ctx.runId, 'research', 'opportunities', 'done', { count: opps.length, source: 'model-estimated' }, { opportunities: opps });
  await Memory.remember(ctx.storeId, 'STORE_MEMORY', 'creation_opportunities', opps);
  return { blocked: [] };
}

async function phOpportunity(ctx: PhaseCtx): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'opportunity', 'select')) return { blocked: [] };
  const prior = await doneSteps(ctx.runId, 'research');
  const opps: Opportunity[] = prior[0] ? JSON.parse(prior[0].result).opportunities : [];
  if (!opps.length) throw new Error('no researched opportunities to choose from');
  const [top] = opps;
  if (top.confidence < 0.35) {
    await step(ctx.runId, 'opportunity', 'select', 'pending_approval',
      { options: opps.map((o) => ({ market: o.market, score: o.score, confidence: o.confidence })) },
      { note: 'Top opportunity confidence below 0.35 — human must choose the market before SEAI builds.' });
    return { blocked: ['opportunity confidence too low — awaiting human market choice'] };
  }
  await Strategies.propose(ctx.storeId, {
    thesis: `Operate a ${top.market} store: ${top.thesis}`,
    market: top.market,
    businessModel: 'Direct-to-consumer catalog retail; measured, experiment-led growth.',
    rationale: `Selected by structured opportunity score ${top.score}/100 (confidence ${top.confidence}). Alternatives: ${opps.slice(1).map((o) => `${o.market} ${o.score}`).join('; ')}. Estimates are model-derived, recorded as such.`,
  }, ctx.runId);
  await Decisions.propose(ctx.storeId, ctx.runId, {
    objective: 'Select the business this blank store should become',
    observation: `Blank store. Researched ${opps.length} opportunities.`,
    hypothesis: top.thesis,
    evidence: opps,
    proposed_action: `Build a ${top.market} store`,
    expected_outcome: 'Launch-ready catalog and storefront within this run',
    risk_level: 'medium', confidence: top.confidence,
    required_permissions: ['write_products', 'write_content'],
    measurement_plan: 'Launch readiness checklist, then revenue/orders/AOV vs baseline zero',
  });
  await step(ctx.runId, 'opportunity', 'select', 'done', { market: top.market }, { opportunity: top });
  return { blocked: [] };
}

async function phBrand(ctx: PhaseCtx, plan: any): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'brand', 'identity')) return { blocked: [] };
  const strat = await Strategies.get(ctx.storeId);
  const direction = plan?.blueprint ? ` Blueprint brand direction (inferred guidance only — never contradict user-stated constraints): ${JSON.stringify(plan.blueprint.brand ?? {})}.` : '';
  const pkg = await modelJson(
    `Market: ${strat.market}. Thesis: ${strat.thesis}.${direction} Invent a grounded brand: name (2 words max, no existing-brand collision by construction avoidance), positioning (1 line), voice (3 adjectives), visual direction (colors as hex, typography style, mood), product naming pattern. No fake claims, no certifications, no reviews.`,
    { type: 'object', properties: { name: { type: 'string' }, positioning: { type: 'string' }, voice: { type: 'string' }, colors: { type: 'array', items: { type: 'string' } }, typography: { type: 'string' }, mood: { type: 'string' }, naming: { type: 'string' } }, required: ['name', 'positioning', 'voice', 'colors', 'typography'] },
    900, ctx.storeId);
  const existing = await ProductService.getProducts(ctx.shop, 50, ctx.accessToken).catch(() => []);
  const screen = await trademarkScreen(ctx.shop, String(pkg.name ?? 'Unnamed'), existing.map((p: any) => p.title));
  await Memory.remember(ctx.storeId, 'STORE_MEMORY', 'brand', { ...pkg, trademark: screen });
  await step(ctx.runId, 'brand', 'identity', 'done', { market: strat.market }, { brand: pkg, trademark: screen });
  return { blocked: [] };
}

async function phCatalog(ctx: PhaseCtx, plan: any): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'catalog', 'built')) return { blocked: [] };
  const strat = await Strategies.get(ctx.storeId);
  const brand = await Memory.recall(ctx.storeId).then((m) => (m['STORE_MEMORY:brand'] as any) ?? {});
  const commerce = plan?.blueprint ? ` Pricing architecture (guidance): ${JSON.stringify(plan.blueprint.commerce ?? {})}. Product strategy (guidance): ${JSON.stringify(plan.blueprint.product ?? {})}.` : '';
  const plan_ = await modelJson(
    `Brand: ${JSON.stringify(brand)}. Market: ${strat.market}.${commerce} Plan up to ${MAX_PRODUCTS} real products: 1 hero + supporting + 1 bundle concept (as a product only if sensible). Each: title, descriptionHtml (honest, no fake claims/reviews/certifications/origins), vendor=brand name, productType, tags, price (with margin rationale), seoTitle, seoDescription, openingStock (modest declared quantity), collection. Prices in store currency.`,
    { type: 'object', properties: { products: { type: 'array', maxItems: MAX_PRODUCTS, items: { type: 'object', properties: { title: { type: 'string' }, descriptionHtml: { type: 'string' }, productType: { type: 'string' }, tags: { type: 'string' }, price: { type: 'string' }, marginNote: { type: 'string' }, seoTitle: { type: 'string' }, seoDescription: { type: 'string' }, openingStock: { type: 'integer' }, collection: { type: 'string' } }, required: ['title', 'descriptionHtml', 'price'] } } }, required: ['products'] },
    4000, ctx.storeId);
  const created: any[] = [];
  for (const p of (plan_.products ?? []).slice(0, MAX_PRODUCTS)) {
    const r = await gatedTool(ctx, 'catalog', 'products.create', {
      title: p.title, descriptionHtml: p.descriptionHtml, vendor: brand.name ?? undefined,
      productType: p.productType ?? undefined, tags: `${ctx.tag}${p.tags ? ' ' + p.tags : ''}`,
    });
    if (!r.executed) return { blocked: [`catalog halted: ${r.error}`] };
    const id = (r.result as any)?.id;
    if (id && (p.seoTitle || p.seoDescription)) {
      await gatedTool(ctx, 'catalog', 'products.update', { id, status: 'ACTIVE', seo: { title: p.seoTitle, description: p.seoDescription } });
    } else if (id) {
      await gatedTool(ctx, 'catalog', 'products.update', { id, status: 'ACTIVE' });
    }
    if (id && Number.isFinite(Number(p.openingStock))) {
      const inv = await gatedTool(ctx, 'catalog', 'inventory.ensure', { productId: id, quantity: Math.max(0, Math.min(500, Number(p.openingStock))) });
      if (id) await Memory.remember(ctx.storeId, 'PRODUCT_MEMORY', String(id).slice(-12), { title: p.title, openingStockDeclared: p.openingStock, marginNote: p.marginNote ?? '' });
      void inv;
    }
    created.push({ id, title: p.title, collection: p.collection ?? null });
  }
  await step(ctx.runId, 'catalog', 'built', 'done', { planned: (plan_.products ?? []).length }, { created });
  return { blocked: [] };
}

async function phCollections(ctx: PhaseCtx): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'collections', 'built')) return { blocked: [] };
  const cat = await doneSteps(ctx.runId, 'catalog');
  const created: any[] = cat[0] ? JSON.parse(cat[0].result).created : [];
  const byCollection = new Map<string, string[]>();
  for (const c of created) {
    if (!c.collection || !c.id) continue;
    if (!byCollection.has(c.collection)) byCollection.set(c.collection, []);
    byCollection.get(c.collection)!.push(c.id);
  }
  // Always ensure at least a hero/entry collection so merchandising exists
  if (!byCollection.size && created.length) byCollection.set('Shop All', created.map((c) => c.id).filter(Boolean));
  for (const [title, ids] of byCollection) {
    const r = await gatedTool(ctx, 'collections', 'collections.create', { title });
    if (!r.executed) return { blocked: [`collections halted: ${r.error}`] };
    const cid = (r.result as any)?.id;
    if (cid && ids.length) {
      const a = await gatedTool(ctx, 'collections', 'collections.addProducts', { collectionId: cid, productIds: ids.slice(0, 50) });
      if (!a.executed) return { blocked: [`collection fill halted: ${a.error}`] };
    }
  }
  await step(ctx.runId, 'collections', 'built', 'done', { groups: [...byCollection.keys()] }, { groups: [...byCollection.keys()] });
  return { blocked: [] };
}

async function phStorefront(ctx: PhaseCtx): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'storefront', 'built')) return { blocked: [] };
  const strat = await Strategies.get(ctx.storeId);
  const brand = await Memory.recall(ctx.storeId).then((m) => (m['STORE_MEMORY:brand'] as any) ?? {});
  const pages = await modelJson(
    `Brand ${brand.name} (${strat.market}): write 3 store pages as HTML bodies (About with honest positioning and NO fake history/claims, Shipping & Returns with standard placeholders for rates/timeframes clearly marked as defaults, FAQ with 5 real questions). Plus 5 shop policies as plain text (refund/shipping/terms/privacy where applicable; standard, jurisdiction-neutral, no legal advice).`,
    { type: 'object', properties: { pages: { type: 'array', maxItems: 4, items: { type: 'object', properties: { title: { type: 'string' }, handle: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] } }, policies: { type: 'object' } }, required: ['pages'] },
    5000, ctx.storeId);
  for (const pg of (pages.pages ?? []).slice(0, 4)) {
    const r = await gatedTool(ctx, 'storefront', 'content.create', { title: pg.title, body: pg.body, handle: pg.handle });
    if (!r.executed) return { blocked: [`pages halted: ${r.error}`] };
  }
  for (const [type, body] of Object.entries((pages.policies ?? {}) as Record<string, string>)) {
    const t = type.toUpperCase();
    if (!['REFUND', 'SHIPPING', 'TERMS_OF_SERVICE', 'PRIVACY', 'SUBSCRIPTION'].includes(t)) continue;
    const r = await gatedTool(ctx, 'storefront', 'policies.update', { type: t, body: String(body).slice(0, 8000) });
    if (!r.executed) return { blocked: [`policies halted: ${r.error}`] };
  }
  await step(ctx.runId, 'storefront', 'built', 'done', {}, { pages: (pages.pages ?? []).length, policies: Object.keys(pages.policies ?? {}).length });
  return { blocked: [] };
}

async function phDesign(ctx: PhaseCtx): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'design', 'visual-system')) return { blocked: [] };
  const brand = await Memory.recall(ctx.storeId).then((m) => (m['STORE_MEMORY:brand'] as any) ?? {});
  const css = `:root{\n  --brand-accent: ${(brand.colors ?? ['#111111'])[0]};\n}\n/* SEAI visual direction for ${brand.name ?? 'store'}: ${brand.mood ?? ''}. Applied as additive custom.css only. */\n`;
  const themes = await executeTool('themes.get', {}, { shop: ctx.shop, storeId: ctx.storeId, runId: ctx.runId, accessToken: ctx.accessToken });
  const main = ((themes.result as any[]) ?? []).find((t) => t.role === 'MAIN') ?? ((themes.result as any[]) ?? [])[0];
  if (!main?.id) {
    await step(ctx.runId, 'design', 'visual-system', 'done', { brand }, { note: 'No theme found — visual system recorded, nothing uploaded.', human: ['Install a theme, then approve the pending custom.css'] });
    return { blocked: [] };
  }
  // Critical-risk write: NEVER auto-executes. Human sees exact file + content, then approves.
  const r = await gatedTool(ctx, 'design', 'themes.upload',
    { themeId: main.id, filename: 'assets/seai-custom.css', value: css },
    `Upload assets/seai-custom.css to theme "${main.name}" (${main.id}): additive brand accent only, no existing files touched.`);
  await step(ctx.runId, 'design', 'visual-system', 'done', { brand, theme: main.name }, { themeFile: r.executed ? 'uploaded' : 'awaiting approval' });
  return { blocked: r.executed ? [] : ['theme customization awaiting approval'] };
}

async function phDomain(ctx: PhaseCtx, customDomain?: string): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'domain', 'status')) return { blocked: [] };
  const info: any = await ShopService.getStore(ctx.shop, ctx.accessToken).catch(() => null);
  const primary = info?.primaryDomain?.host ?? null;
  const wanted = (customDomain ?? '').trim().toLowerCase();
  let state = 'myshopify-default';
  if (wanted && primary === wanted) state = 'verified';
  else if (wanted) state = 'dns-human-action';
  await step(ctx.runId, 'domain', 'status', wanted && state !== 'verified' ? 'done' : 'done',
    { wanted: wanted || null }, {
      primaryDomain: primary, wanted: wanted || null, state,
      human: state === 'dns-human-action' ? ['Point DNS to Shopify and verify in Settings > Domains — DNS lives outside Shopify APIs; SEAI will not claim configuration until Shopify confirms.'] : [],
    });
  return { blocked: [] };
}

async function phReadiness(ctx: PhaseCtx): Promise<{ blocked: string[]; report?: ReadinessReport }> {
  const report = await runReadiness(ctx.shop, ctx.accessToken);
  await step(ctx.runId, 'readiness', 'checklist', report.ready ? 'done' : 'done', {}, report);
  const blocking = report.checks.filter((c) => !c.pass && c.severity === 'blocking');
  return { blocked: blocking.map((c) => c.name + ': ' + c.detail), report };
}

async function phLaunch(ctx: PhaseCtx, report: ReadinessReport): Promise<{ blocked: string[] }> {
  if (await phaseDone(ctx.runId, 'launch', 'declared')) return { blocked: [] };
  await Strategies.setStatus(ctx.storeId, 'active').catch(() => undefined);
  await Decisions.propose(ctx.storeId, ctx.runId, {
    objective: 'Launch the newly built store',
    observation: `Readiness: ${report.ready ? 'READY' : 'BLOCKED'} (${report.checks.filter((c) => c.pass).length}/${report.checks.length} checks pass)`,
    hypothesis: 'A complete, honest catalog + storefront converts cold traffic worth testing.',
    evidence: [report],
    proposed_action: 'Declare store launched; begin autonomous operation loop',
    expected_outcome: 'First revenue within the measurement window',
    risk_level: 'medium', confidence: 0.55,
    required_permissions: ['read_orders', 'read_products'],
    measurement_plan: 'Daily revenue/orders/AOV vs launch baseline (zero)',
  });
  await Memory.remember(ctx.storeId, 'STORE_MEMORY', 'launch', { at: new Date().toISOString(), readiness: report.ready });
  try {
    const slot = await slotForShop(ctx.storeId).catch(() => null);
    recordDecision(ctx.storeId, slot?.label ?? null, {
      title: 'Store launch declared',
      store: ctx.shop,
      decision: 'Declare the newly built store launched; begin autonomous operation.',
      reason: `Launch readiness ${report.ready ? 'READY' : 'BLOCKED'}: ${report.checks.filter((c) => c.pass).length}/${report.checks.length} checks pass.`,
      evidence: report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`),
      alternatives: ['Hold launch until every warning clears'],
      expectedOutcome: 'First revenue within the measurement window',
      confidence: 0.55,
      status: 'completed',
      runId: ctx.runId,
    });
  } catch { /* ignore */ }
  await step(ctx.runId, 'launch', 'declared', 'done', {}, { ready: report.ready });
  return { blocked: [] };
}

// ---------------- orchestration ----------------

export interface CreationOpts {
  customDomain?: string;
  /** Public store domain from onboarding (example.com) */
  domain?: string;
  /** Free-form user brief; compiled to a blueprint before research */
  context?: string;
}

export async function startCreation(shop: string, opts: { customDomain?: string } | CreationOpts = {}): Promise<{ runId: string }> {
  const clean = normalizeShop(shop);
  if (!clean) throw new Error('not a valid myshopify.com store domain');
  const customDomain = opts.customDomain;
  const context = (opts as CreationOpts).context?.trim() ?? '';
  const domain = (opts as CreationOpts).domain?.trim().toLowerCase() ?? '';
  if (context && (context.length < 20 || context.length > 8000)) throw new Error('context must be 20–8000 characters');
  const v = await verifyConnection(clean);
  if (!v.ok) throw Object.assign(new Error(v.error ?? 'Connect a Shopify store first.'), { code: 'NO_STORE_CONNECTED' });
  const runId = randomUUID();
  // Compile the blueprint up front so a bad brief fails fast, before any build work
  let blueprint: unknown = null;
  if (context) blueprint = await compileBlueprint(clean, domain || clean, context);
  try {
    await db.insert('creation_runs', {
      id: runId, store_id: clean, status: 'running', current_phase: context ? 'blueprint' : 'research',
      plan: JSON.stringify({ customDomain: customDomain ?? null, domain: domain || null, context: context || null, blueprint }),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  } catch (e: any) { throw new Error(`creation start failed: ${e.message}`); }
  setImmediate(() => advance(runId).catch((e) => setRun(runId, { status: 'failed', plan: JSON.stringify({ error: String(e.message).slice(0, 500) }) })));
  return { runId };
}

export async function getCreation(runId: string): Promise<any> {
  const runs = await db.list('creation_runs', { id: runId } as any, 1);
  if (!runs[0]) return null;
  const steps = await db.list('creation_steps', { run_id: runId } as any, 200);
  return { ...runs[0], plan: safeParse(runs[0].plan), steps: steps.map((s) => ({ ...s, payload: safeParse(s.payload), result: safeParse(s.result) })) };
}

function safeParse(v: any) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } }

export async function approveSteps(runId: string, stepIds: string[]): Promise<{ approved: number }> {
  let n = 0;
  for (const id of stepIds) {
    try {
      const rows = await db.list('creation_steps', { id } as any, 1);
      const st = rows[0];
      if (!st || st.run_id !== runId || st.status !== 'pending_approval') continue;
      const payload = safeParse(st.payload);
      const runs = await db.list('creation_runs', { id: runId } as any, 1);
      const shop = runs[0]?.store_id;
      if (!shop) continue;
      const token = (await getAccessToken(shop)) ?? undefined;
      const out = await executeTool(payload.tool, payload.args ?? {}, { shop, storeId: shop, runId, confirmed: true, accessToken: token });
      await db.update('creation_steps', id, { status: out.ok ? 'approved' : 'failed', result: JSON.stringify(out.ok ? out.result : { error: out.error }).slice(0, 20000) });
      if (out.ok) n++;
    } catch { /* continue */ }
  }
  const run = await getCreation(runId);
  if (run && (run.status === 'awaiting_approval' || run.status === 'running' || run.status === 'blocked')) {
    // Mark running synchronously so status readers never observe a stale pause
    await setRun(runId, { status: 'running' });
    setImmediate(() => advance(runId).catch(() => undefined));
  }
  return { approved: n };
}

export async function advance(runId: string): Promise<void> {
  const run = await getCreation(runId);
  if (!run || run.status === 'completed' || run.status === 'failed') return;
  const shop = run.store_id;
  const token = (await getAccessToken(shop)) ?? undefined;
  const ctx: PhaseCtx = { shop, storeId: shop, runId, tag: `seai-${runId.slice(0, 8)}`, accessToken: token };
  const plan = run.plan ?? {};
  await setRun(runId, { status: 'running' });

  const handlers: Record<CreationPhase, () => Promise<{ blocked: string[]; report?: ReadinessReport }>> = {
    blueprint: () => phBlueprint(ctx, { domain: plan.domain, context: plan.context }, plan),
    research: () => phResearch(ctx, plan),
    opportunity: () => phOpportunity(ctx),
    brand: () => phBrand(ctx, plan),
    catalog: () => phCatalog(ctx, plan),
    collections: () => phCollections(ctx),
    storefront: () => phStorefront(ctx),
    design: () => phDesign(ctx),
    domain: () => phDomain(ctx, plan.customDomain),
    readiness: () => phReadiness(ctx),
    launch: async () => {
      const rd = await doneSteps(runId, 'readiness');
      const report = rd[0] ? JSON.parse(rd[0].result) : null;
      if (!report) return { blocked: ['readiness not completed'] };
      if (!report.ready) {
        await setRun(runId, { status: 'blocked', current_phase: 'readiness' });
        return { blocked: report.checks.filter((c: any) => !c.pass && c.severity === 'blocking').map((c: any) => c.name) };
      }
      return phLaunch(ctx, report);
    },
    optimize: async () => {
      if (await phaseDone(runId, 'optimize', 'handoff')) return { blocked: [] };
      await step(runId, 'optimize', 'handoff', 'done', {}, { note: 'Creation complete. Autonomous operation loop owns the store from here.' });
      return { blocked: [] };
    },
  };

  for (const phase of PHASES) {
    await setRun(runId, { current_phase: phase });
    try {
      const { blocked } = await handlers[phase]();
      // Fresh pending approvals pause the run for human authorization (policy is final authority)
      const pend = (await getCreation(runId))?.steps?.filter((s: any) => s.status === 'pending_approval') ?? [];
      if (blocked.length || pend.length) {
        await setRun(runId, { status: pend.length ? 'awaiting_approval' : 'blocked', current_phase: phase });
        await Memory.remember(shop, 'STORE_MEMORY', 'creation_state', { runId, phase, blocked });
        return;
      }
    } catch (e: any) {
      await step(runId, phase, 'error', 'failed', {}, { error: String(e.message).slice(0, 500) });
      await setRun(runId, { status: 'failed', current_phase: phase });
      return;
    }
  }
  await setRun(runId, { status: 'completed', current_phase: 'optimize' });
}
