import { listNotes, readNote, storeRoot } from './vault.js';

// Scoped retrieval: the model never gets the whole vault. For a decision it gets:
// own store scope (strategy, blueprint, recent experiments/decisions/learnings)
// + generalized portfolio knowledge — ranked by keyword overlap, capped by budget.
export interface MemoryHit {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

const SKIP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'store', 'seai', 'what', 'how', 'why', 'our', 'your', 'about']);

function tokens(s: string): Set<string> {
  return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !SKIP.has(t)));
}

function excerptOf(body: string, max = 900): string {
  const noFm = body.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^# .*\n/, '').trim();
  return noFm.slice(0, max);
}

export function retrieve(opts: {
  storeId: string;
  slotLabel?: string | null;
  query: string;
  k?: number;
  budgetChars?: number;
  includePortfolio?: boolean;
}): MemoryHit[] {
  const k = opts.k ?? 5;
  const budget = opts.budgetChars ?? 6000;
  const q = tokens(opts.query);
  if (!q.size) return [];
  const roots = [storeRoot(opts.storeId, opts.slotLabel)];
  if (opts.includePortfolio !== false) roots.push('01_PORTFOLIO', '06_LEARNINGS');
  const hits: MemoryHit[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const n of listNotes(root)) {
      if (seen.has(n.path) || n.path.endsWith('.keep.md')) continue;
      seen.add(n.path);
      const body = readNote(n.path) ?? '';
      const bt = tokens(`${n.title} ${body.slice(0, 4000)}`);
      let score = 0;
      for (const t of q) if (bt.has(t)) score++;
      // Strategy and blueprint are foundational — slight boost when relevant
      if (/strategy|blueprint/i.test(n.path)) score += 0.5;
      if (score > 0) hits.push({ path: n.path, title: n.title, excerpt: excerptOf(body), score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const out: MemoryHit[] = [];
  let used = 0;
  for (const h of hits.slice(0, k * 2)) {
    if (out.length >= k || used + h.excerpt.length > budget) break;
    out.push(h);
    used += h.excerpt.length;
  }
  return out;
}

export function formatForContext(hits: MemoryHit[]): string {
  if (!hits.length) return '';
  return 'RELEVANT MEMORY (persistent brain — conclusions with evidence, not raw logs):\n' +
    hits.map((h) => `- [${h.title}] (${h.path}): ${h.excerpt.slice(0, 500)}`).join('\n');
}
