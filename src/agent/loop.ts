import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/db.js';
import { aiGateway } from '../ai/gateway.js';
import { listTools, getTool } from './tools.js';
import { executeTool } from './executor.js';
import { buildAgentSystemPrompt, summarizeForContext, fitBudget, DEFAULT_BUDGET } from './context.js';
import { Memory } from '../memory/store.js';
import { Decisions } from '../decisions/engine.js';
import { analyzeCommerce } from '../intelligence/commerce.js';
import { retrieve, formatForContext } from '../brain/retrieve.js';
import { recordDecision, recordObservation } from '../brain/writer.js';
import { slotForShop } from '../stores/registry.js';

export interface AgentRunInput {
  shop: string;
  storeId: string;
  prompt: string;
  kind?: string;
  confirmed?: boolean;
  maxIterations?: number;
  accessToken?: string;
}

export interface AgentRunResult {
  runId: string;
  status: string;
  summary: string;
  iterations: number;
  model: string;
}

/** Real agent loop: iterative tool calls with max iterations, persisted state, restart-safe. */
export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const runId = randomUUID();
  const maxIterations = input.maxIterations ?? config.agentMaxIterations;
  const kind = input.kind ?? 'command';
  let model = 'heuristic';
  try { model = await aiGateway.selectBestModel({ requireTools: true }); } catch { /* offline */ }

  try {
    await db.insert('agent_runs', {
      id: runId, store_id: input.storeId, kind, input: input.prompt.slice(0, 4000),
      model, status: 'running', autonomy_level: config.autonomyLevel, started_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }

  const step = async (n: number, skind: string, content: unknown) => {
    try {
      await db.insert('agent_steps', { id: randomUUID(), run_id: runId, n, kind: skind, content: JSON.stringify(content).slice(0, 8000), created_at: new Date().toISOString() });
    } catch { /* ignore */ }
  };

  const mem = await Memory.recall(input.storeId);
  const memBlock = Object.entries(mem).slice(0, 20).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 300)}`).join('\n');
  // Persistent brain: scoped retrieval (own store + generalized portfolio), budgeted — never the whole vault
  let vaultBlock = '';
  try {
    const slot = await slotForShop(input.storeId).catch(() => null);
    vaultBlock = formatForContext(retrieve({ storeId: input.storeId, slotLabel: slot?.label ?? null, query: input.prompt }));
  } catch { /* brain unavailable — run proceeds on live state */ }
  const system = buildAgentSystemPrompt({ store: input.shop, autonomyLevel: config.autonomyLevel, tools: listTools().map((t) => t.name), memory: [memBlock, vaultBlock].filter(Boolean).join('\n'), operator: config.operatorName });
  const history: string[] = [`USER: ${input.prompt}`];
  let iterations = 0;
  let finalSummary = '';

  // Fast path: deterministic read-only plans for core commands so V1 works
  // even when the LLM is unreachable; the LLM path below upgrades reasoning.
  const heuristicPlan = planHeuristic(input.prompt);

  const ctx = { shop: input.shop, storeId: input.storeId, runId, confirmed: input.confirmed, accessToken: input.accessToken };

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    let directive: { tool: string | null; args: any; think: string; done: boolean; final?: string };
    if (i < heuristicPlan.length) {
      const p = heuristicPlan[i];
      directive = { tool: p.tool, args: p.args, think: p.think, done: false };
    } else {
      directive = await nextDirective(system, history, model, input.storeId);
    }
    await step(i, 'thought', { think: directive.think, tool: directive.tool });
    if (!directive.tool || directive.done) {
      finalSummary = directive.final ?? directive.think ?? 'done';
      break;
    }
    const res = await executeTool(directive.tool, directive.args ?? {}, ctx);
    await step(i, 'tool', { tool: directive.tool, ok: res.ok, policy: res.policyDecision });
    const block = summarizeForContext(`${directive.tool} → ${res.ok ? 'ok' : 'blocked/error'}`, res.ok ? res.result : { error: res.error, policy: res.policyDecision });
    history.push(block);
    if (history.length > DEFAULT_BUDGET.maxToolResults + 2) history.splice(1, history.length - (DEFAULT_BUDGET.maxToolResults + 2));
    finalSummary = res.ok ? `Executed ${directive.tool}.` : `Blocked/failed ${directive.tool}: ${(res.error ?? '').slice(0, 200)}`;
  }

  // Commerce interpretation pass over gathered orders (no fake data).
  // If Shopify was unreachable, say so plainly — never present errors as an empty store.
  try {
    const toolRows = await db.list('tool_calls', { run_id: runId } as any, 50);
    const reads = toolRows.filter((r) => (getTool(r.tool)?.riskLevel ?? 'low') === 'low');
    const okReads = reads.filter((r) => r.ok);
    const ordersRow = toolRows.find((r) => r.tool === 'orders.list');
    let orders: any[] | null = null;
    if (ordersRow?.ok) {
      try { const p = JSON.parse(ordersRow.result); if (Array.isArray(p)) orders = p; } catch { /* ignore */ }
    }
    if (orders) {
      const report = analyzeCommerce(orders);
      finalSummary += `\n\n${report.narrative}`;
      await Memory.remember(input.storeId, 'PERFORMANCE_MEMORY', `run_${runId.slice(0, 8)}`, { revenue: report.revenue, orders: report.orders, aov: report.aov });
      await Memory.recordRun(input.storeId, runId, 'commerce_report', report as any);
      const decision = await Decisions.propose(input.storeId, runId, {
        objective: input.prompt.slice(0, 300), observation: report.narrative.slice(0, 1000),
        hypothesis: (report.opportunities[0] ?? 'no action justified').slice(0, 500),
        evidence: report.insights, proposed_action: report.opportunities[0] ?? 'monitor',
        expected_outcome: 'measured in next cycle', risk_level: 'low', confidence: 0.6,
        required_permissions: ['read_orders', 'read_products'], measurement_plan: 're-run analytics.get next cycle; compare revenue/orders/AOV',
      });
      // Persistent brain: mirror significant conclusions (never raw logs)
      try {
        const slot = await slotForShop(input.storeId).catch(() => null);
        const label = slot?.label ?? null;
        recordDecision(input.storeId, label, {
          title: decision.objective.slice(0, 60) || 'Agent analysis',
          store: input.shop,
          decision: decision.proposed_action,
          reason: decision.hypothesis,
          evidence: report.insights.map((i) => `${i.metric}: ${i.interpretation}`),
          alternatives: [],
          expectedOutcome: decision.expected_outcome,
          confidence: decision.confidence,
          status: decision.execution_status,
          runId,
        });
        if (report.orders > 0 || report.risks.length > 0) {
          recordObservation(input.storeId, label, `Commerce review — ${report.orders} orders sampled`,
            `${report.narrative}\n\nRisks: ${report.risks.join('; ') || 'none'}\nOpportunities: ${report.opportunities.join('; ') || 'none'}`);
        }
      } catch { /* brain write failure never fails the run */ }
    } else if (reads.length > 0 && okReads.length === 0) {
      finalSummary += '\n\nShopify unreachable: no Shopify session for this store (all read tools failed). Connect via /auth?shop=<store> first — SEAI will not fabricate store data.';
      await Memory.recordRun(input.storeId, runId, 'connection_failure', { reads: reads.length });
    }
  } catch { /* ignore */ }

  const status = 'completed';
  try {
    const rows = await db.list('agent_runs', { id: runId } as any, 1);
    if (rows[0]) await db.update('agent_runs', runId, { status, ended_at: new Date().toISOString(), summary: finalSummary.slice(0, 4000) });
  } catch { /* ignore */ }

  return { runId, status, summary: finalSummary, iterations, model };
}

function planHeuristic(prompt: string): { tool: string; args: any; think: string }[] {
  const p = prompt.toLowerCase();
  const base = [
    { tool: 'store.get', args: {}, think: 'OBSERVE: inspect store identity first.' },
    { tool: 'products.list', args: { limit: 25 }, think: 'OBSERVE: inspect catalog.' },
    { tool: 'orders.list', args: { limit: 25 }, think: 'OBSERVE: inspect order history for revenue/AOV.' },
    { tool: 'customers.list', args: { limit: 25 }, think: 'OBSERVE: inspect customer base.' },
    { tool: 'inventory.get', args: { limit: 25 }, think: 'OBSERVE: inspect inventory risk.' },
    { tool: 'discounts.list', args: {}, think: 'OBSERVE: inspect discount exposure.' },
    { tool: 'analytics.get', args: {}, think: 'UNDERSTAND: compute revenue/orders/AOV.' },
  ];
  if (p.includes('inventor')) return [...base.slice(0, 1), { tool: 'inventory.get', args: { limit: 50 }, think: 'OBSERVE: deep inventory risk review.' }, ...base.slice(1, 4), base[6]];
  if (p.includes('discount') || p.includes('growth') || p.includes('opportunit')) return [...base, { tool: 'collections.list', args: {}, think: 'UNDERSTAND: collection mix for bundling.' }];
  if (p.includes('drop') || p.includes('why') || p.includes('sales')) return base; // diagnose from reads
  return base;
}

async function nextDirective(system: string, history: string[], model: string, storeId: string | null): Promise<{ tool: string | null; args: any; think: string; done: boolean; final?: string }> {
  const convo = fitBudget([system, ...history]);
  try {
    const raw = await aiGateway.chat(
      [{ role: 'system', content: system }, { role: 'user', content: `${convo}\n\nEmit the next JSON step.` }],
      { json: true, maxTokens: 800 }, storeId);
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const j = JSON.parse(cleaned);
    if (j.done || !j.tool || j.tool === 'null') return { tool: null, args: {}, think: j.think ?? '', done: true, final: j.final ?? j.think ?? '' };
    return { tool: String(j.tool), args: j.args ?? {}, think: j.think ?? '', done: false };
  } catch {
    return { tool: null, args: {}, think: 'LLM unreachable — concluding read-only pass.', done: true, final: 'Completed read-only investigation. LLM step skipped (provider unavailable); all observations above are from real Shopify tools.' };
  }
}
