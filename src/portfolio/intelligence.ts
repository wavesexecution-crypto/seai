import { db } from '../db/db.js';
import { listSlots, type StoreSlot } from '../stores/registry.js';
import { Strategies, type Strategy } from '../stores/strategies.js';

// Portfolio intelligence: reads ONLY recorded per-store state (runs, decisions,
// experiments, measured commerce reports, strategies). Never fabricates, never
// shares business state between stores — each store is measured in isolation,
// then compared on identical metrics.
export interface StoreMetrics {
  slot: number;
  label: string;
  shop: string | null;
  status: 'available' | 'assigned' | 'connected';
  strategy: Strategy;
  runs: number;
  completedRuns: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  decisions: number;
  experimentsOpen: number;
  experimentsTotal: number;
  revenue: number | null;
  orders: number | null;
  aov: number | null;
  measuredAt: string | null;
}

export interface PortfolioRollup {
  generatedAt: string;
  stores: StoreMetrics[];
  ranking: string[];
  insights: {
    leader: string | null;
    leaderWhy: string;
    mostActive: string | null;
    needsAttention: { store: string; reason: string }[];
    note: string;
  };
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function measured(storeId: string): Promise<{ revenue: number | null; orders: number | null; aov: number | null; at: string | null }> {
  try {
    const rows = await db.list('observations', { store_id: storeId, category: 'commerce_report' } as any, 5);
    const r = rows[0];
    if (!r) return { revenue: null, orders: null, aov: null, at: null };
    let c: any = {};
    try { c = typeof r.content === 'string' ? JSON.parse(r.content) : r.content; } catch { /* ignore */ }
    return { revenue: num(c.revenue), orders: num(c.orders), aov: num(c.aov), at: r.created_at ?? null };
  } catch {
    return { revenue: null, orders: null, aov: null, at: null };
  }
}

export async function storeMetrics(slot: StoreSlot): Promise<StoreMetrics> {
  const empty: StoreMetrics = {
    slot: slot.slot, label: slot.label, shop: slot.shop, status: slot.status,
    strategy: await Strategies.get(slot.shop ?? `slot:${slot.slot}`),
    runs: 0, completedRuns: 0, lastRunAt: null, lastRunStatus: null,
    decisions: 0, experimentsOpen: 0, experimentsTotal: 0,
    revenue: null, orders: null, aov: null, measuredAt: null,
  };
  if (!slot.shop) return empty;
  const id = slot.shop;
  try {
    const runs = await db.list('agent_runs', { store_id: id } as any, 50);
    empty.runs = runs.length;
    empty.completedRuns = runs.filter((r) => r.status === 'completed').length;
    if (runs[0]) { empty.lastRunAt = runs[0].started_at ?? null; empty.lastRunStatus = runs[0].status ?? null; }
    const dec = await db.list('decisions', { store_id: id } as any, 200);
    empty.decisions = dec.length;
    const exp = await db.list('experiments', { store_id: id } as any, 50);
    empty.experimentsTotal = exp.length;
    empty.experimentsOpen = exp.filter((e) => e.status === 'running').length;
    const m = await measured(id);
    empty.revenue = m.revenue; empty.orders = m.orders; empty.aov = m.aov; empty.measuredAt = m.at;
  } catch { /* partial metrics are fine; never invent */ }
  return empty;
}

export async function portfolioRollup(): Promise<PortfolioRollup> {
  const slots = await listSlots();
  const stores = await Promise.all(slots.map(storeMetrics));
  const measuredStores = stores.filter((s) => s.revenue !== null);
  const ranking = [...stores].sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1)).map((s) => s.label);
  const leader = measuredStores.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0] ?? null;
  const mostActive = [...stores].sort((a, b) => b.runs - a.runs)[0] ?? null;
  const needsAttention = stores
    .filter((s) => s.status !== 'connected' || (s.runs > 0 && s.lastRunStatus !== 'completed') || (s.status === 'connected' && s.runs === 0))
    .map((s) => ({
      store: s.label,
      reason: s.status === 'available'
        ? 'empty slot — assign a clean store to begin'
        : s.status === 'assigned'
          ? 'shop assigned but not authorized — complete Shopify OAuth to begin'
          : s.runs === 0 ? 'connected but never analyzed' : `last run ${s.lastRunStatus}`,
    }));
  return {
    generatedAt: new Date().toISOString(),
    stores,
    ranking,
    insights: {
      leader: leader?.label ?? null,
      leaderWhy: leader
        ? `${leader.label} leads on measured revenue (${leader.revenue} across ${leader.orders} sampled orders, AOV ${leader.aov}). Rank reflects recorded data only — unmeasured stores are not penalized.`
        : 'No store has measured revenue yet. Run analysis on a connected store first.',
      mostActive: mostActive && mostActive.runs > 0 ? mostActive.label : null,
      needsAttention,
      note: 'Stores are independent experiments. Poor performance alone never triggers shutdown — evidence plus autonomy policy govern any change.',
    },
  };
}
