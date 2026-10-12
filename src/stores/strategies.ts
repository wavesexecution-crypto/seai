import { db } from '../db/db.js';
import { recordStrategy } from '../brain/writer.js';
import { slotForShop } from './registry.js';

// Per-store business strategy. Starts UNFORMED for every store — SEAI forms it
// through investigation, never from a template. One strategy per store,
// fully isolated by store_id.
export type StrategyStatus = 'unformed' | 'proposed' | 'active' | 'retired';

export interface Strategy {
  storeId: string;
  status: StrategyStatus;
  thesis: string;
  market: string;
  businessModel: string;
  rationale: string;
  formedByRun: string | null;
  updatedAt: string;
}

const FALLBACK: Strategy = {
  storeId: '', status: 'unformed', thesis: '', market: '', businessModel: '',
  rationale: '', formedByRun: null, updatedAt: '',
};

function row(r: any): Strategy {
  return {
    storeId: r.store_id ?? r.id, status: r.status ?? 'unformed',
    thesis: r.thesis ?? '', market: r.market ?? '', businessModel: r.business_model ?? '',
    rationale: r.rationale ?? '', formedByRun: r.formed_by_run ?? null,
    updatedAt: r.updated_at ?? '',
  };
}

export const Strategies = {
  async get(storeId: string): Promise<Strategy> {
    try {
      const rows = await db.list('strategies', { store_id: storeId } as any, 1);
      if (rows[0]) return row(rows[0]);
      const alt = await db.list('strategies', { id: storeId } as any, 1);
      if (alt[0]) return row(alt[0]);
    } catch { /* ignore */ }
    return { ...FALLBACK, storeId };
  },

  async propose(storeId: string, s: { thesis: string; market?: string; businessModel?: string; rationale?: string }, runId: string | null): Promise<Strategy> {
    if (!s.thesis || s.thesis.trim().length < 20) throw new Error('thesis must be a substantive grounded statement (20+ chars)');
    const rec = {
      id: storeId, store_id: storeId, status: 'proposed',
      thesis: s.thesis.trim(), market: (s.market ?? '').trim(),
      business_model: (s.businessModel ?? '').trim(), rationale: (s.rationale ?? '').trim(),
      formed_by_run: runId, updated_at: new Date().toISOString(),
    };
    try {
      const ex = await db.list('strategies', { store_id: storeId } as any, 1);
      const alt = ex[0] ? [] : await db.list('strategies', { id: storeId } as any, 1);
      if (ex[0] || alt[0]) await db.update('strategies', storeId, rec);
      else await db.insert('strategies', rec);
    } catch (e: any) {
      throw new Error(`strategy propose failed: ${e.message}`);
    }
    try {
      const slot = await slotForShop(storeId).catch(() => null);
      recordStrategy(storeId, slot?.label ?? null,
        { status: 'proposed', thesis: rec.thesis, market: rec.market, businessModel: rec.business_model, rationale: rec.rationale },
        `proposed${runId ? ` in run ${runId}` : ''}`);
    } catch { /* brain write never fails strategy */ }
    return this.get(storeId);
  },

  async setStatus(storeId: string, status: StrategyStatus): Promise<Strategy> {
    if (!['proposed', 'active', 'retired'].includes(status)) throw new Error('invalid status');
    const cur = await this.get(storeId);
    if (cur.status === 'unformed') throw new Error('no strategy to transition — propose one first');
    try {
      await db.update('strategies', storeId, { status, updated_at: new Date().toISOString() });
    } catch (e: any) {
      throw new Error(`strategy transition failed: ${e.message}`);
    }
    return this.get(storeId);
  },
};
