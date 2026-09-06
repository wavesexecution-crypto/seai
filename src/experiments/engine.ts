import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { recordExperiment } from '../brain/writer.js';
import { slotForShop } from '../stores/registry.js';

export interface Experiment {
  id: string; hypothesis: string; metric: string; baseline: any;
  start_time: string; end_time: string | null; variant: any; control: any;
  status: string; result: any; confidence: number; decision: string; rollback_plan: any;
}

export const Experiments = {
  async create(storeId: string, e: { hypothesis: string; metric: string; baseline?: any; variant?: any; control?: any; rollbackPlan?: any }): Promise<Experiment> {
    const ex: Experiment = {
      id: randomUUID(), hypothesis: e.hypothesis, metric: e.metric, baseline: e.baseline ?? {},
      start_time: new Date().toISOString(), end_time: null, variant: e.variant ?? {}, control: e.control ?? {},
      status: 'running', result: {}, confidence: 0, decision: '', rollback_plan: e.rollbackPlan ?? {},
    };
    try {
      await db.insert('experiments', {
        id: ex.id, store_id: storeId, hypothesis: ex.hypothesis, metric: ex.metric,
        baseline: JSON.stringify(ex.baseline), start_time: ex.start_time, end_time: null,
        variant: JSON.stringify(ex.variant), control: JSON.stringify(ex.control),
        status: 'running', result: '{}', confidence: 0, decision: '', rollback_plan: JSON.stringify(ex.rollback_plan),
      });
    } catch { /* ignore */ }
    return ex;
  },
  async evaluate(storeId: string, id: string, after: { metric: string; value: number }): Promise<Experiment | null> {
    try {
      const rows = await db.list('experiments', { id } as any, 1);
      if (!rows[0]) return null;
      const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };
      const baseline = parse(rows[0].baseline);
      const baseVal = Number(baseline?.value ?? baseline?.revenue ?? 0);
      const delta = baseVal === 0 ? null : Number((((after.value - baseVal) / Math.abs(baseVal)) * 100).toFixed(1));
      // Never pretend certainty on small samples
      const n = Number(baseline?.n ?? baseline?.orders ?? 0);
      const confidence = n < 10 ? 0.2 : n < 30 ? 0.5 : 0.75;
      const decision = delta === null ? 'inconclusive — no baseline' : confidence < 0.5 ? 'inconclusive — sample too small, keep running' : delta > 5 ? 'keep variant' : delta < -5 ? 'rollback' : 'no effect — rollback or iterate';
      const result = { metric: after.metric, value: after.value, baseline: baseVal, deltaPct: delta, sampleNote: n < 30 ? `small sample (n≈${n}); do not claim significance` : 'adequate sample for directional read' };
      await db.update('experiments', id, { result: JSON.stringify(result), confidence, decision, status: decision.startsWith('keep') ? 'completed' : decision === 'rollback' ? 'rolled_back' : 'running', end_time: decision.startsWith('keep') || decision === 'rollback' ? new Date().toISOString() : null });
      // Concluded experiments become permanent knowledge (hypothesis → result → learning)
      try {
        if (decision.startsWith('keep') || decision === 'rollback') {
          const slot = await slotForShop(storeId).catch(() => null);
          recordExperiment(storeId, slot?.label ?? null, {
            title: String(rows[0].hypothesis ?? 'experiment').slice(0, 60),
            store: storeId,
            hypothesis: String(rows[0].hypothesis ?? ''),
            objective: `Move ${after.metric}`,
            metric: after.metric,
            variant: parse(rows[0].variant),
            control: parse(rows[0].control),
            result,
            interpretation: decision,
            decision,
            learning: decision === 'rollback'
              ? 'Variant underperformed baseline — reverted; do not repeat without a new hypothesis.'
              : 'Variant beat baseline — keep and watch for decay.',
            experimentId: id,
          });
        }
      } catch { /* brain write never fails evaluation */ }
      return { ...(rows[0] as any), result, confidence, decision } as any;
    } catch { return null; }
    void storeId;
  },
  async rollback(storeId: string, id: string): Promise<{ ok: boolean; plan: any }> {
    try {
      const rows = await db.list('experiments', { id } as any, 1);
      if (!rows[0]) return { ok: false, plan: null };
      const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };
      await db.update('experiments', id, { status: 'rolled_back', decision: 'rolled back by operator', end_time: new Date().toISOString() });
      return { ok: true, plan: parse(rows[0].rollback_plan) };
    } catch { return { ok: false, plan: null }; }
    void storeId;
  },
  async list(storeId: string, limit = 20): Promise<any[]> {
    try { return await db.list('experiments', { store_id: storeId } as any, limit); } catch { return []; }
  },
};
