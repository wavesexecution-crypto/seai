import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';

export interface Decision {
  decision_id: string;
  objective: string;
  observation: string;
  hypothesis: string;
  evidence: unknown[];
  proposed_action: string;
  expected_outcome: string;
  risk_level: string;
  confidence: number;
  required_permissions: string[];
  execution_status: string;
  result: unknown;
  measurement_plan: string;
}

export const Decisions = {
  async propose(storeId: string, runId: string | null, d: Omit<Decision, 'decision_id' | 'execution_status' | 'result'>): Promise<Decision> {
    const full: Decision = { ...d, decision_id: randomUUID(), execution_status: 'proposed', result: {} };
    try {
      await db.insert('decisions', {
        id: full.decision_id, store_id: storeId, run_id: runId,
        objective: d.objective, observation: d.observation, hypothesis: d.hypothesis,
        evidence: JSON.stringify(d.evidence), proposed_action: d.proposed_action,
        expected_outcome: d.expected_outcome, risk_level: d.risk_level, confidence: d.confidence,
        required_permissions: JSON.stringify(d.required_permissions),
        execution_status: 'proposed', result: '{}', measurement_plan: d.measurement_plan,
        created_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }
    return full;
  },
  async mark(storeId: string, decisionId: string, status: string, result: unknown): Promise<void> {
    try {
      const rows = await db.list('decisions', { id: decisionId } as any, 1);
      if (rows[0]) await db.update('decisions', decisionId, { execution_status: status, result: JSON.stringify(result ?? {}) });
    } catch { /* ignore */ }
    void storeId;
  },
  async recent(storeId: string, limit = 20): Promise<any[]> {
    try { return await db.list('decisions', { store_id: storeId } as any, limit); } catch { return []; }
  },
};
