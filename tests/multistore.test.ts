import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate multi-store tests from the live dev store (fresh throwaway dir per run).
process.env.SEAI_DATA_DIR = mkdtempSync(join(tmpdir(), 'seai-ms-test-'));
process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-ms-brain-'));

process.env.SEAI_SCHEDULER = 'off';

describe('store isolation', () => {
  it('never mixes memories between stores', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { Memory } = await import('../src/memory/store.js');
    await Memory.remember('store-a.myshopify.com', 'PRODUCT_MEMORY', 'hero', { title: 'Alpha' });
    await Memory.remember('store-b.myshopify.com', 'PRODUCT_MEMORY', 'hero', { title: 'Beta' });
    const a = await Memory.recall('store-a.myshopify.com', 'PRODUCT_MEMORY');
    const b = await Memory.recall('store-b.myshopify.com', 'PRODUCT_MEMORY');
    expect(a['PRODUCT_MEMORY:hero'].title).toBe('Alpha');
    expect(b['PRODUCT_MEMORY:hero'].title).toBe('Beta');
    expect(JSON.stringify(a)).not.toContain('Beta');
  });

  it('never mixes decisions, runs, or observations between stores', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { Decisions } = await import('../src/decisions/engine.js');
    await Decisions.propose('store-a.myshopify.com', null, {
      objective: 'A', observation: 'obs-a', hypothesis: 'hyp', evidence: [],
      proposed_action: 'act-a', expected_outcome: 'out', risk_level: 'low',
      confidence: 0.5, required_permissions: [], measurement_plan: 'm',
    });
    const da = await Decisions.recent('store-a.myshopify.com', 50);
    const db2 = await Decisions.recent('store-b.myshopify.com', 50);
    expect(da.some((d) => String(d.proposed_action).includes('act-a'))).toBe(true);
    expect(db2.some((d) => String(d.proposed_action).includes('act-a'))).toBe(false);
    const runsA = await db.list('agent_runs', { store_id: 'store-a.myshopify.com' } as any, 50);
    expect(runsA.every((r) => r.store_id === 'store-a.myshopify.com')).toBe(true);
  });

  it('strategies are per-store and start unformed', async () => {
    const { Strategies } = await import('../src/stores/strategies.js');
    const s = await Strategies.get('fresh-store.myshopify.com');
    expect(s.status).toBe('unformed');
    expect(s.thesis).toBe('');
    await Strategies.propose('fresh-store.myshopify.com', { thesis: 'Serve repeat buyers of consumables with subscriptions and bundles.' }, 'run-1');
    const after = await Strategies.get('fresh-store.myshopify.com');
    expect(after.status).toBe('proposed');
    const other = await Strategies.get('other-store.myshopify.com');
    expect(other.status).toBe('unformed');
    await expect(Strategies.propose('x.myshopify.com', { thesis: 'short' }, null)).rejects.toThrow();
  });
});

describe('store slots', () => {
  it('exposes six neutral slots with no predetermined identity', async () => {
    const { listSlots, assignSlot } = await import('../src/stores/registry.js');
    const slots = await listSlots();
    expect(slots.length).toBe(6);
    expect(slots.map((s) => s.label)).toEqual(['Store 01', 'Store 02', 'Store 03', 'Store 04', 'Store 05', 'Store 06']);
    expect(JSON.stringify(slots).toLowerCase()).not.toMatch(/fashion|beauty|electronics|niche/);
    await expect(assignSlot(0, 'x.myshopify.com')).rejects.toThrow();
    await expect(assignSlot(1, 'not-a-shop')).rejects.toThrow();
    const bound = await assignSlot(1, 'clean-one.myshopify.com');
    expect(bound.shop).toBe('clean-one.myshopify.com');
    await expect(assignSlot(2, 'clean-one.myshopify.com')).rejects.toThrow(/already bound/);
  });
});

describe('connection model', () => {
  it('normalizeShop accepts bare domains and rejects everything else', async () => {
    const { normalizeShop } = await import('../src/stores/connections.js');
    expect(normalizeShop('my-store.myshopify.com')).toBe('my-store.myshopify.com');
    expect(normalizeShop('https://my-store.myshopify.com/')).toBe('my-store.myshopify.com');
    expect(normalizeShop('https://admin.shopify.com/store/abc123/settings/domains')).toBeNull();
    expect(normalizeShop('admin.shopify.com/store/x')).toBeNull();
    expect(normalizeShop('not-a-shop')).toBeNull();
    expect(normalizeShop('')).toBeNull();
    expect(normalizeShop(null)).toBeNull();
  });

  it('unconnected shops verify false and create no records', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { verifyConnection, listConnections } = await import('../src/stores/connections.js');
    const v = await verifyConnection('ghost-store.myshopify.com');
    expect(v.ok).toBe(false);
    const conns = await listConnections();
    expect(conns.some((c) => c.shop === 'ghost-store.myshopify.com')).toBe(false);
    const rows = await db.list('stores', { shop_domain: 'ghost-store.myshopify.com' } as any, 5);
    expect(rows.length).toBe(0);
  });

  it('slots report available until a real session exists', async () => {
    const { listSlots } = await import('../src/stores/registry.js');
    const slots = await listSlots();
    for (const s of slots) {
      expect(['available', 'assigned', 'connected']).toContain(s.status);
      if (!s.shop) expect(s.status).toBe('available');
    }
  });
});

describe('portfolio intelligence', () => {
  it('ranks on measured data only and never fabricates', async () => {
    const { db } = await import('../src/db/db.js');
    await db.init();
    const { portfolioRollup } = await import('../src/portfolio/intelligence.js');
    const p = await portfolioRollup();
    expect(p.stores.length).toBe(6);
    expect(p.ranking.length).toBe(6);
    expect(p.insights.note).toMatch(/never triggers shutdown|evidence/i);
    // no measured revenue anywhere in a fresh test env → honest nulls
    for (const s of p.stores) {
      if (s.shop === null) {
        expect(s.revenue).toBeNull();
        expect(s.runs).toBe(0);
      }
    }
  });

  it('strategy tools execute through the policy-gated executor', async () => {
    const { executeTool } = await import('../src/agent/executor.js');
    const prop = await executeTool('strategy.propose', { thesis: 'Test thesis for an isolated neutral store experiment here.' }, { shop: 'tool-store.myshopify.com', storeId: 'tool-store.myshopify.com', runId: 'r-strat' });
    expect(prop.ok).toBe(true);
    const got = await executeTool('strategy.get', {}, { shop: 'tool-store.myshopify.com', storeId: 'tool-store.myshopify.com', runId: 'r-strat' });
    expect(got.ok).toBe(true);
    expect((got.result as any).status).toBe('proposed');
    const pf = await executeTool('portfolio.get', {}, { shop: 'tool-store.myshopify.com', storeId: 'tool-store.myshopify.com', runId: 'r-strat' });
    expect(pf.ok).toBe(true);
    expect((pf.result as any).stores.length).toBe(6);
  });
});
