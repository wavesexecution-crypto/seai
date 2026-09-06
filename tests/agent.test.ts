import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test-secret';
process.env.SEAI_SCHEDULER = 'off';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-br-test-'));

function shopifyMock() {
  return vi.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    const q: string = body.query;
    const j = (data: any) => new Response(JSON.stringify({ data }), { status: 200 });
    if (q.includes('{ shop')) return j({ shop: { name: 'T', email: 'e', myshopifyDomain: 't.myshopify.com', currencyCode: 'USD' } });
    if (q.includes('products(')) return j({ products: { nodes: [{ id: 'gid://shopify/Product/1', title: 'Widget', handle: 'w', status: 'ACTIVE', priceRangeV2: { minVariantPrice: { amount: '10.00', currencyCode: 'USD' } }, totalInventory: 5 }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } });
    if (q.includes('product(id')) return j({ product: { id: 'x', title: 'Widget' } });
    if (q.includes('orders(')) return j({ orders: { nodes: [{ id: 'gid://shopify/Order/1', name: '#1', createdAt: new Date().toISOString(), displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', totalPriceSet: { shopMoney: { amount: '25.00', currencyCode: 'USD' } }, customer: { email: 'a@b.c' }, lineItems: { nodes: [{ title: 'Widget', quantity: 1 }] } }], pageInfo: { hasNextPage: false, endCursor: null } } });
    if (q.includes('customers(')) return j({ customers: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    if (q.includes('inventoryLevels')) return j({ inventoryLevels: { nodes: [{ id: '1', available: 2, item: { sku: 'S', variant: { product: { title: 'Widget' } } }, location: { name: 'Main' } }] } });
    if (q.includes('codeDiscountNodes')) return j({ codeDiscountNodes: { nodes: [] } });
    if (q.includes('collections(')) return j({ collections: { nodes: [] } });
    if (q.includes('{ pages')) return j({ pages: { nodes: [] } });
    if (q.includes('{ themes')) return j({ themes: { nodes: [] } });
    return j({});
  });
}

describe('shopify client', () => {
  it('paginates across cursors', async () => {
    const { paginate } = await import('../src/shopify/client.js');
    const orig = globalThis.fetch;
    let n = 0;
    (globalThis as any).fetch = vi.fn(async () => {
      n++;
      const hasNext = n === 1;
      return new Response(JSON.stringify({ data: { products: { nodes: [{ id: n }], pageInfo: { hasNextPage: hasNext, endCursor: 'c' } } } }), { status: 200 });
    });
    try {
      const out = await paginate('t.myshopify.com',
        (after) => ({ query: 'q', variables: { after } }),
        (d) => ({ nodes: d.products.nodes, pageInfo: d.products.pageInfo }),
        { accessToken: 'tok', maxPages: 5 });
      expect(out.length).toBe(2);
    } finally { (globalThis as any).fetch = orig; }
  });

  it('does not retry unsafe mutations blindly', async () => {
    const { shopifyGraphQL } = await import('../src/shopify/client.js');
    const orig = globalThis.fetch;
    let n = 0;
    (globalThis as any).fetch = vi.fn(async () => { n++; return new Response('err', { status: 500 }); });
    try {
      await expect(shopifyGraphQL('t.myshopify.com', 'mutation { x }', {}, { accessToken: 't', isMutation: true, retries: 0 })).rejects.toThrow();
      expect(n).toBe(1);
    } finally { (globalThis as any).fetch = orig; }
  });
});

describe('agent end-to-end (read-only, mocked Shopify)', () => {
  it('runs observe→understand loop and persists state', async () => {
    const orig = globalThis.fetch;
    (globalThis as any).fetch = shopifyMock();
    try {
      const { db } = await import('../src/db/db.js');
      await db.init();
      const { runAgent } = await import('../src/agent/loop.js');
      const out = await runAgent({ shop: 't.myshopify.com', storeId: 't.myshopify.com', prompt: 'Analyze my store.', kind: 'test', accessToken: 'tok', maxIterations: 8 });
      expect(out.status).toBe('completed');
      expect(out.iterations).toBeGreaterThan(3);
      expect(out.summary.length).toBeGreaterThan(20);
      const steps = await db.list('agent_steps', { run_id: out.runId } as any, 100);
      expect(steps.length).toBeGreaterThan(3);
    } finally { (globalThis as any).fetch = orig; }
  });

  it('policy blocks high-risk write at EXECUTE_SAFE without confirmation', async () => {
    const orig = globalThis.fetch;
    (globalThis as any).fetch = shopifyMock();
    try {
      const { executeTool } = await import('../src/agent/executor.js');
      const r = await executeTool('discounts.create', { title: 'Huge', code: 'HUGE50', percent: 50 }, { shop: 't.myshopify.com', storeId: 't', runId: 'r1', accessToken: 'tok' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/policy|confirmation/i);
    } finally { (globalThis as any).fetch = orig; }
  });

  it('approved mutation executes against Shopify and returns the result (controlled write path)', async () => {
    const calls: any[] = [];
    const orig = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (body.query.includes('productUpdate')) {
        return new Response(JSON.stringify({ data: { productUpdate: { product: { id: 'gid://shopify/Product/1', title: 'Widget', status: 'DRAFT' }, userErrors: [] } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    try {
      const { executeTool } = await import('../src/agent/executor.js');
      // medium-risk reversible write with explicit confirmation → policy allows
      const r = await executeTool('products.update', { id: 'gid://shopify/Product/1', status: 'DRAFT' }, { shop: 't.myshopify.com', storeId: 't', runId: 'r2', confirmed: true, accessToken: 'tok' });
      expect(r.ok).toBe(true);
      expect((r.result as any)?.title).toBe('Widget');
      expect(calls.some((c) => c.query.includes('productUpdate'))).toBe(true);
      // high-risk write WITHOUT confirmation → blocked, and no mutation is sent
      const nBefore = calls.length;
      const blocked = await executeTool('products.archive', { id: 'gid://shopify/Product/1' }, { shop: 't.myshopify.com', storeId: 't', runId: 'r2', accessToken: 'tok' });
      expect(blocked.ok).toBe(false);
      expect(calls.length).toBe(nBefore);
    } finally { (globalThis as any).fetch = orig; }
  });
});

describe('webhooks + experiments + security', () => {
  it('verifies HMAC and enqueues without blocking', async () => {
    process.env.SHOPIFY_API_SECRET = 's3cr3t';
    vi.resetModules();
    const { verifyWebhook, enqueueEvent } = await import('../src/events/webhooks.js');
    const raw = Buffer.from('{"id":1}');
    const good = createHmac('sha256', 's3cr3t').update(raw).digest('base64');
    expect(verifyWebhook(raw, good)).toBe(true);
    expect(verifyWebhook(raw, 'bogus')).toBe(false);
    const id = await enqueueEvent('t.myshopify.com', 'orders/create', { id: 1 });
    expect(id.length).toBeGreaterThan(5);
  });

  it('experiments refuse false certainty on small samples', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { Experiments } = await import('../src/experiments/engine.js');
    const ex = await Experiments.create('t', { hypothesis: 'Bundle lifts AOV by 10% over 2 weeks', metric: 'aov', baseline: { value: 100, n: 4 } });
    const ev = await Experiments.evaluate('t', ex.id, { metric: 'aov', value: 130 });
    expect(ev?.decision).toMatch(/sample too small|inconclusive/i);
    expect(ev?.confidence).toBeLessThan(0.5);
  });

  it('auth/session tokens are encrypted and never logged', async () => {
    const { encryptToken, decryptToken } = await import('../src/shopify/sessions.js');
    const enc = encryptToken('shpat_secret123');
    expect(enc).not.toContain('shpat_secret123');
    expect(decryptToken(enc)).toBe('shpat_secret123');
    const { sanitizeForModel } = await import('../src/security/validate.js');
    expect(JSON.stringify(sanitizeForModel({ t: 'shpat_secret123' }))).not.toContain('shpat_secret123');
  });
});
