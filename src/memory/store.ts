import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';

export type MemoryCategory =
  | 'STORE_MEMORY' | 'PRODUCT_MEMORY' | 'CUSTOMER_MEMORY' | 'EXPERIMENT_MEMORY'
  | 'DECISION_MEMORY' | 'ACTION_MEMORY' | 'PERFORMANCE_MEMORY' | 'FAILURE_MEMORY';

export const Memory = {
  async remember(storeId: string, category: MemoryCategory, key: string, value: unknown): Promise<void> {
    const row = {
      id: `${storeId}:${category}:${key}`, store_id: storeId, category, key,
      value: JSON.stringify(value), updated_at: new Date().toISOString(),
    };
    try {
      const ex = await db.list('memories', { id: row.id } as any, 1);
      if (ex[0]) await db.update('memories', row.id, row);
      else await db.insert('memories', { ...row, created_at: new Date().toISOString() });
    } catch { /* ignore */ }
  },
  async recall(storeId: string, category?: MemoryCategory): Promise<Record<string, any>> {
    try {
      const rows = await db.list('memories', category ? ({ store_id: storeId, category } as any) : ({ store_id: storeId } as any), 200);
      const out: Record<string, any> = {};
      for (const r of rows) {
        try { out[`${r.category}:${r.key}`] = JSON.parse(r.value); } catch { out[`${r.category}:${r.key}`] = r.value; }
      }
      return out;
    } catch { return {}; }
  },
  async recordRun(storeId: string, runId: string, kind: string, content: Record<string, any>): Promise<void> {
    try {
      await db.insert('observations', {
        id: randomUUID(), store_id: storeId, run_id: runId, category: kind,
        content: JSON.stringify(content), created_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }
  },
};
