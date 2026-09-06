// Context engine: never dump the whole store into the model.
// Budgets per decision, summarization, provenance, drill-down via tools.
export interface ContextBudget { maxToolResults: number; maxCharsPerResult: number; maxTotalChars: number; }

export const DEFAULT_BUDGET: ContextBudget = { maxToolResults: 12, maxCharsPerResult: 4000, maxTotalChars: 24000 };

export function summarizeForContext(name: string, value: unknown, budget: ContextBudget = DEFAULT_BUDGET): string {
  let s = JSON.stringify(value ?? null);
  // Preserve raw IDs and money figures: truncate lists, not fields
  try {
    const v: any = JSON.parse(s);
    if (Array.isArray(v) && v.length > 25) {
      const kept = v.slice(0, 25);
      s = JSON.stringify({ _truncated: `${v.length} items, showing 25 — drill down with tools`, items: kept });
    }
  } catch { /* keep raw */ }
  if (s.length > budget.maxCharsPerResult) s = s.slice(0, budget.maxCharsPerResult) + '…[truncated]';
  return `## ${name}\n${s}`;
}

export function buildAgentSystemPrompt(opts: { store: string; autonomyLevel: string; tools: string[]; memory: string; operator?: string }): string {
  return [
    'You are SEAI, an autonomous commerce operator for a Shopify store. NOT a chatbot.',
    opts.operator ? `The human operator you serve is named ${opts.operator}. Address them by name sparingly and naturally, never with a title.` : '',
    'Loop: OBSERVE → UNDERSTAND → REASON → DECIDE → ACT (via tools) → MEASURE → LEARN.',
    'Rules:',
    '- Reason through tools. Never invent orders, customers, revenue, or inventory.',
    '- Distinguish OBSERVATION (fact) vs HYPOTHESIS (guess) vs DECISION vs ACTION vs RESULT.',
    '- If the store is empty, say so plainly.',
    '- Prefer read-only investigation first; propose writes as decisions with risk + measurement plan.',
    `- Autonomy level: ${opts.autonomyLevel}. High-risk writes need confirmation unless policy allows.`,
    `- Store: ${opts.store}`,
    `Available tools: ${opts.tools.join(', ')}`,
    opts.memory ? `Memory:\n${opts.memory}` : 'Memory: (none yet)',
    'Respond in strict JSON only: {"think": "...", "observation": "...", "hypothesis": "...", "tool": "<name|null>", "args": {}, "done": true|false, "final": "..."}',
  ].join('\n');
}

export function fitBudget(blocks: string[], budget: ContextBudget = DEFAULT_BUDGET): string {
  let total = 0;
  const out: string[] = [];
  for (const b of blocks) {
    if (total + b.length > budget.maxTotalChars) { out.push('[context budget exhausted — drill down with tools]'); break; }
    out.push(b);
    total += b.length;
  }
  return out.join('\n\n');
}
