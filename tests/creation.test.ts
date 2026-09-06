import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SEAI_DATA_DIR = mkdtempSync(join(tmpdir(), 'seai-cr-test-'));
process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-cr-brain-'));
process.env.SEAI_SCHEDULER = 'off';
process.env.SEAI_CREATION_MAX_PRODUCTS = '4';

const state = { products: [] as any[], collections: 0, collectionNames: [] as string[], pages: 0, policies: 0 };

function ollamaBody(url: string, init: any): any {
  const body = JSON.parse(init.body);
  const text = JSON.stringify(body.messages ?? body.prompt ?? '');
  const msg = (content: unknown) => ({ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } });
  if (url.endsWith('/api/tags')) return { models: [{ name: 'test-model' }] };
  if (text.includes('distinct opportunities') || text.includes('opportunities')) {
    return msg({ opportunities: [1, 2, 3].map((i) => ({
      market: `Test Market ${i}`, thesis: `A grounded thesis for test market ${i} with honest differentiation and real demand drivers.`,
      demand: 9 - i, competition: 3 + i, marginPotential: 8 - i, acquisitionPotential: 7,
      repeatPurchasePotential: 6 + i, operationalComplexity: 3, risk: 3, confidence: 0.7,
      justification: { demand: 'test' },
    })) });
  }
  if (text.includes('grounded brand')) {
    return msg({ name: 'Northfield Goods', positioning: 'Honest everyday essentials', voice: 'calm, plain, confident', colors: ['#1a1a1a', '#f5f3ee'], typography: 'grotesque sans', mood: 'quiet', naming: 'place + goods' });
  }
  if (text.includes('Plan up to')) {
    return msg({ products: [1, 2, 3].map((i) => ({
      title: `Field Tote ${i}`, descriptionHtml: `<p>A sturdy everyday tote, size ${i}.</p>`, productType: 'Bags',
      tags: 'tote everyday', price: `${20 + i * 5}.00`, marginNote: 'keystone markup assumed', seoTitle: `Field Tote ${i}`, seoDescription: `Everyday tote ${i}`, openingStock: 20, collection: 'Carry',
    })) });
  }
  if (text.includes('store pages')) {
    return msg({ pages: [{ title: 'About', handle: 'about', body: '<p>We make honest goods.</p>' }, { title: 'FAQ', handle: 'faq', body: '<p>Real answers.</p>' }], policies: { REFUND: 'Standard 30-day refund policy text that is long enough to be a real policy body for testing purposes.', PRIVACY: 'Privacy policy text that is long enough to be a real policy body for testing purposes here.' } });
  }
  return msg({});
}

function shopifyBody(body: any): any {
  const q: string = body.query;
  const j = (data: any) => ({ data });
  // Specific mutations first — generic '{ shop' substring-matches mutation bodies
  if (q.includes('productCreate')) {
    const p = { id: `gid://shopify/Product/${100 + state.products.length}`, title: body.variables.input.title, price: '25.00', stock: 0 };
    state.products.push(p);
    return j({ productCreate: { product: { id: p.id, title: p.title, handle: 'h', status: 'DRAFT' }, userErrors: [] } });
  }
  if (q.includes('productUpdate')) return j({ productUpdate: { product: { id: 'x', title: 't', status: 'ACTIVE' }, userErrors: [] } });
  if (q.includes('variants(first')) {
    return j({ product: { variants: { nodes: [{ inventoryItem: { id: 'gid://shopify/InventoryItem/1' }, inventoryQuantity: 0 }] } }, locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'Main' }] } });
  }
  if (q.includes('inventoryAdjustQuantities')) {
    if (state.products.length) state.products[state.products.length - 1].stock = 20;
    return j({ inventoryAdjustQuantities: { inventoryAdjustmentGroup: { createdAt: '' }, userErrors: [] } });
  }
  if (q.includes('collectionCreate')) { state.collections++; state.collectionNames.push(body.variables.input.title); return j({ collectionCreate: { collection: { id: 'gid://shopify/Collection/1', title: 't', handle: 'h' }, userErrors: [] } }); }
  if (q.includes('collections(')) return j({ collections: { nodes: state.collectionNames.map((t) => ({ id: '1', title: t, handle: 'h', productsCount: { count: 1 } })) } });
  if (q.includes('collectionAddProducts')) return j({ collectionAddProducts: { job: { id: '1' }, userErrors: [] } });
  if (q.includes('pageCreate')) { state.pages++; return j({ pageCreate: { page: { id: '1', title: 't', handle: 'h' }, userErrors: [] } }); }
  if (q.includes('shopPolicyUpdate')) { state.policies++; return j({ shopPolicyUpdate: { shopPolicy: { type: 'REFUND', body: 'x' }, userErrors: [] } }); }
  if (q.includes('themeFilesUpsert')) return j({ themeFilesUpsert: { upsertedThemeFiles: [{ filename: 'assets/seai-custom.css' }], userErrors: [] } });
  if (q.includes('refundPolicy')) return j({ shop: { refundPolicy: { body: 'x' }, shippingPolicy: null, termsOfService: null, privacyPolicy: { body: 'x' } } });
  if (q.includes('{ shop')) {
    return j({ shop: { name: 'Creation Test Store', email: 't@t.t', myshopifyDomain: 'creation-test.myshopify.com', currencyCode: 'USD', primaryDomain: { host: 'creation-test.myshopify.com' }, plan: { displayName: 'Test' } } });
  }
  if (q.includes('products(')) {
    return j({ products: { nodes: state.products.map((p) => ({ id: p.id, title: p.title, handle: 'h', status: 'ACTIVE', priceRangeV2: { minVariantPrice: { amount: p.price, currencyCode: 'USD' } }, totalInventory: p.stock })), pageInfo: { hasNextPage: false, endCursor: null } } });
  }
  if (q.includes('{ themes')) return j({ themes: { nodes: [{ id: 'gid://shopify/Theme/1', name: 'Dawn', role: 'MAIN' }] } });
  if (q.includes('codeDiscountNodes')) return j({ codeDiscountNodes: { nodes: [] } });
  if (q.includes('orders(')) return j({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  return j({});
}

beforeEach(() => {
  state.products = []; state.collections = 0; state.collectionNames = []; state.pages = 0; state.policies = 0;
  (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
    const u = String(url);
    if (u.startsWith('https://ollama.com')) return new Response(JSON.stringify(ollamaBody(u, init)), { status: 200 });
    return new Response(JSON.stringify(shopifyBody(JSON.parse(init.body))), { status: 200 });
  });
});

describe('opportunity research', () => {
  it('scores and ranks honestly, rejects garbage', async () => {
    const { scoreOpportunity, OpportunitySchema } = await import('../src/research/providers.js');
    const good = { market: 'Test Market', thesis: 't'.repeat(50), demand: 9, competition: 2, marginPotential: 8, acquisitionPotential: 7, repeatPurchasePotential: 8, operationalComplexity: 3, risk: 2, confidence: 0.7, justification: {} };
    const bad = { ...good, demand: 2, competition: 9, marginPotential: 2, risk: 9 };
    expect(scoreOpportunity(OpportunitySchema.parse(good))).toBeGreaterThan(scoreOpportunity(OpportunitySchema.parse(bad)));
    expect(() => OpportunitySchema.parse({ ...good, demand: 11 })).toThrow();
    expect(() => OpportunitySchema.parse({ ...good, confidence: 2 })).toThrow();
  });

  it('trademark screen catches in-catalog collisions, demands human review otherwise', async () => {
    const { trademarkScreen } = await import('../src/research/providers.js');
    const hit = await trademarkScreen('s', 'Northfield Goods', ['Northfield Goods Tote']);
    expect(hit.clear).toBe(false);
    expect(hit.note).toMatch(/collision/i);
    const miss = await trademarkScreen('s', 'Northfield Goods', ['Other Thing']);
    expect(miss.clear).toBe(false);
    expect(miss.note).toMatch(/human legal review/i);
  });
});

describe('sourcing import', () => {
  it('validates rows strictly', async () => {
    const { validateImport } = await import('../src/sourcing/providers.js');
    expect(validateImport([]).ok).toBe(false);
    expect(validateImport([{ title: 'x', price: 'free' }]).ok).toBe(false);
    const good = validateImport([{ title: 'Real Tote', price: '29.99', openingStock: 10 }]);
    expect(good.ok).toBe(true);
    expect(good.rows?.[0].title).toBe('Real Tote');
  });
});

describe('readiness', () => {
  it('blocks an empty store with evidence', async () => {
    const { runReadiness } = await import('../src/creation/readiness.js');
    const r = await runReadiness('creation-test.myshopify.com', 'tok');
    expect(r.ready).toBe(false);
    expect(r.checks.some((c) => !c.pass && c.severity === 'blocking')).toBe(true);
  });
});

describe('creation pipeline gate', () => {
  it('refuses to start without a verified session and creates nothing', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { startCreation } = await import('../src/creation/pipeline.js');
    await expect(startCreation('ghost-creation.myshopify.com')).rejects.toMatchObject({ code: 'NO_STORE_CONNECTED' });
    expect(await db.list('creation_runs', { store_id: 'ghost-creation.myshopify.com' } as any, 5)).toHaveLength(0);
  });
});

describe('creation pipeline end-to-end (mocked)', () => {
  it('researches, brands, builds, pauses for theme approval, then launches', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { saveSession } = await import('../src/shopify/sessions.js');
    await saveSession('creation-test.myshopify.com', 'tok', 'all', false);
    const { startCreation, getCreation, approveSteps, advance } = await import('../src/creation/pipeline.js');
    const { runId } = await startCreation('creation-test.myshopify.com');
    // wait for background run to reach the approval pause
    for (let i = 0; i < 40; i++) {
      const r = await getCreation(runId);
      if (r && (r.status === 'awaiting_approval' || r.status === 'completed' || r.status === 'failed' || r.status === 'blocked')) break;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    let run = await getCreation(runId);
    expect(['awaiting_approval', 'blocked', 'completed']).toContain(run.status);
    let pending = (run.steps as any[]).filter((s) => s.status === 'pending_approval');
    // High-risk policy publishing must never auto-execute — approval queue is the proof
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((s) => JSON.stringify(s.payload).includes('policies.update'))).toBe(true);
    // products + pages really built before the pause
    expect(state.products.length).toBe(3);
    expect(state.pages).toBe(2);
    let out = await approveSteps(runId, pending.map((s) => s.id));
    expect(out.approved).toBe(pending.length);
    // approving resumes the run; the second policy also needs approval — drain the queue
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < 40; i++) {
        run = await getCreation(runId);
        if (run && (run.status === 'awaiting_approval' || run.status === 'completed' || run.status === 'failed' || run.status === 'blocked')) break;
        await new Promise((r2) => setTimeout(r2, 250));
      }
      const more = ((run.steps as any[])).filter((s) => s.status === 'pending_approval' && JSON.stringify(s.payload).includes('policies.update'));
      if (!more.length) break;
      out = await approveSteps(runId, more.map((s) => s.id));
      expect(out.approved).toBe(more.length);
    }
    expect(state.policies).toBe(2);
    // pipeline resumes, builds collections, then pauses for critical theme work
    for (let i = 0; i < 40; i++) {
      run = await getCreation(runId);
      if (run && (run.status === 'awaiting_approval' || run.status === 'completed' || run.status === 'failed' || run.status === 'blocked')) break;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    pending = ((run.steps as any[])).filter((s) => s.status === 'pending_approval');
    const themePending = pending.filter((s) => JSON.stringify(s.payload).includes('themes.upload'));
    expect(themePending.length).toBeGreaterThan(0);
    expect(state.collections).toBeGreaterThan(0);
    // approve theme step → pipeline resumes to launch
    out = await approveSteps(runId, themePending.map((s) => s.id));
    expect(out.approved).toBe(themePending.length);
    for (let i = 0; i < 40; i++) {
      run = await getCreation(runId);
      if (run && (run.status === 'completed' || run.status === 'failed' || run.status === 'blocked')) break;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    expect(run.status).toBe('completed');
    // strategy went proposed → active, launch recorded
    const { Strategies } = await import('../src/stores/strategies.js');
    expect((await Strategies.get('creation-test.myshopify.com')).status).toBe('active');
    void advance;
  }, 60000);
});

describe('zero-config onboarding', () => {
  it('accepts exactly domain + context, rejects everything else', async () => {
    const { validateOnboardInput } = await import('../src/blueprint/compiler.js');
    const ok = validateOnboardInput('https://example.com/', 'I want a premium skincare brand for men with strong margins and DTC growth.');
    expect(ok.domain).toBe('example.com');
    expect(() => validateOnboardInput('not a domain', 'long enough context here for the test case minimum')).toThrow();
    expect(() => validateOnboardInput('example.com', 'too short')).toThrow();
    expect(() => validateOnboardInput('https://admin.shopify.com/store/x/settings', 'long enough context here for the test case minimum')).toThrow();
  });

  it('compiles a provenance-labeled blueprint and persists it', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
      const u = String(url);
      if (u.startsWith('https://ollama.com')) {
        if (u.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 't' }] }), { status: 200 });
        const leaf = (v: string, p: string) => ({ value: v, provenance: p });
        const sec = (fields: string[], p: string) => Object.fromEntries(fields.map((f) => [f, leaf(`${f} value`, p)]));
        return new Response(JSON.stringify({
          message: {
            content: JSON.stringify({
              business: sec(['concept', 'category', 'model', 'commercialObjective', 'strategicObjective', 'geography', 'assumptions'], 'inferred'),
              customer: sec(['target', 'segments', 'demographics', 'needs', 'problems', 'motivations', 'objections', 'triggers', 'intent'], 'inferred'),
              market: sec(['definition', 'opportunity', 'demand', 'competition', 'positioning', 'differentiation', 'risks'], 'inferred'),
              product: sec(['strategy', 'categories', 'hero', 'supporting', 'bundles', 'crossSells', 'upsells', 'hierarchy', 'attributes', 'pricing'], 'inferred'),
              brand: sec(['positioning', 'personality', 'voice', 'naming', 'visual', 'colors', 'typography', 'imagery', 'packaging', 'rules'], 'inferred'),
              storefront: sec(['homepage', 'architecture', 'navigation', 'collections', 'productPage', 'merchandising', 'search', 'cart', 'conversion', 'trust', 'mobile'], 'inferred'),
              commerce: sec(['pricing', 'offers', 'discounts', 'margins', 'aov', 'repeat', 'retention'], 'inferred'),
              growth: sec(['acquisition', 'organic', 'paid', 'content', 'seo', 'cro', 'experimentation'], 'inferred'),
              operations: sec(['inventory', 'fulfillment', 'support', 'dependencies', 'integrations'], 'inferred'),
              analytics: sec(['kpis', 'primaryObjective', 'secondaryMetrics', 'thresholds', 'experimentMetrics'], 'inferred'),
              risks: sec(['business', 'operational', 'compliance', 'platform', 'unknowns'], 'unknown'),
              decisionsStated: ['premium brand'], decisionsInferred: ['DTC model'], seaiMustDecide: ['hero product'],
              unknowns: ['exact CAC'], mustResearch: ['competitor pricing'],
            }),
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    const { compileBlueprint, getBlueprint, summarizeBlueprint } = await import('../src/blueprint/compiler.js');
    const bp: any = await compileBlueprint('bp-store.myshopify.com', 'example.com', 'I want a premium skincare brand for men with strong margins and DTC growth.');
    expect(bp.business.concept.provenance).toBe('inferred');
    expect(bp.risks.unknowns.provenance).toBe('unknown');
    const stored = await getBlueprint('bp-store.myshopify.com');
    expect(stored?.domain).toBe('example.com');
    const summary = summarizeBlueprint(bp);
    expect(summary.some((s) => s.section === 'Business')).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/products\.create|inventory\.get/);
  });
});

describe('permission registry', () => {
  it('documents every requested scope and detects protected-scope denials', async () => {
    const { PERMISSION_REGISTRY, validateRegistry, requiredScopes, isScopeError } = await import('../src/shopify/permissions.js');
    const { config } = await import('../src/config.js');
    const v = validateRegistry(config.shopify.scopes);
    expect(v.unknown).toEqual([]);
    expect(v.missingRequired).toEqual([]);
    expect(requiredScopes()).toContain('write_products');
    expect(requiredScopes()).toContain('write_files');
    for (const p of PERMISSION_REGISTRY) {
      expect(p.scope).toBeTruthy();
      expect(p.purpose).toBeTruthy();
      expect(p.features.length).toBeGreaterThan(0);
    }
    expect(isScopeError('Access denied: missing write_products scope')).toBe(true);
    expect(isScopeError('productCreate: some validation error')).toBe(false);
  });
});
