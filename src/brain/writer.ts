import { writeNote, appendEntry, readNote, noteExists, storeRoot } from './vault.js';

// Structured, deterministic memory writes. Every writer enforces the quality bar:
// conclusions + evidence + reasoning. Raw tool logs and speculation are refused
// by construction (no writer accepts them). Duplicates update instead of multiply.
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'note';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function significantDecision(d: { confidence?: number; risk_level?: string; proposed_action?: string }): boolean {
  if ((d.confidence ?? 0) >= 0.5) return true;
  if (['high', 'critical'].includes(String(d.risk_level))) return true;
  return Boolean(d.proposed_action && d.proposed_action.trim().length > 0);
}

export interface DecisionNote {
  title: string;
  store: string;
  decision: string;
  reason: string;
  evidence: string[];
  alternatives: string[];
  expectedOutcome: string;
  actualOutcome?: string;
  confidence: number;
  status: string;
  runId?: string;
}

export function recordDecision(storeId: string, slotLabel: string | null, d: DecisionNote): string | null {
  if (!significantDecision({ confidence: d.confidence, risk_level: '', proposed_action: d.decision })) return null;
  const root = storeRoot(storeId, slotLabel);
  const file = `${root}/Decisions/${today()}-${slug(d.title)}.md`;
  const body = [
    `Date: ${today()}`, `Store: ${d.store}`, '',
    `Decision:`, '', d.decision, '',
    `Reason:`, '', d.reason, '',
    `Evidence:`, '', ...(d.evidence.length ? d.evidence.map((e) => `- ${e}`) : ['- (none recorded)']), '',
    `Alternatives considered:`, '', ...(d.alternatives.length ? d.alternatives.map((a) => `- ${a}`) : ['- (none recorded)']), '',
    `Expected outcome:`, '', d.expectedOutcome, '',
    `Actual outcome:`, '', d.actualOutcome ?? 'Pending measurement.', '',
    `Confidence: ${d.confidence}`, `Status: ${d.status}`,
    d.runId ? `\nRun: ${d.runId}` : '',
  ].join('\n');
  writeNote(file, `Decision: ${d.title}`, body, { store: d.store, type: 'decision' });
  writeNote(`05_DECISIONS/${today()}-${slug(d.title)}.md`, `Decision: ${d.title}`,
    `Store-scoped record: [[${file.replace(/\.md$/, '')}]]\n\n${d.decision}\n\nStatus: ${d.status} · Confidence: ${d.confidence}`,
    { store: d.store, type: 'decision-pointer' });
  return file;
}

export interface ExperimentNote {
  title: string;
  store: string;
  hypothesis: string;
  objective: string;
  metric: string;
  variant: unknown;
  control: unknown;
  result: unknown;
  interpretation: string;
  decision: string;
  learning: string;
  experimentId: string;
}

export function recordExperiment(storeId: string, slotLabel: string | null, e: ExperimentNote): string {
  const root = storeRoot(storeId, slotLabel);
  const file = `${root}/Experiments/${today()}-${slug(e.title)}.md`;
  const j = (v: unknown) => '```json\n' + JSON.stringify(v ?? {}, null, 1).slice(0, 2000) + '\n```';
  writeNote(file, `Experiment: ${e.title}`, [
    `Store: ${e.store}`, `Experiment ID: ${e.experimentId}`, '',
    `Hypothesis:`, '', e.hypothesis, '',
    `Objective: ${e.objective}`, `Metric: ${e.metric}`, '',
    `Control:`, '', j(e.control), '',
    `Variant:`, '', j(e.variant), '',
    `Result:`, '', j(e.result), '',
    `Interpretation:`, '', e.interpretation, '',
    `Decision:`, '', e.decision, '',
    `Learning:`, '', e.learning, '',
    `Strategy: [[${root}/Current Strategy]]`,
  ].join('\n'), { store: e.store, type: 'experiment' });
  writeNote(`04_EXPERIMENTS/${today()}-${slug(e.title)}.md`, `Experiment: ${e.title}`,
    `Full record: [[${file.replace(/\.md$/, '')}]]\n\n${e.hypothesis}\n\nDecision: ${e.decision}`,
    { store: e.store, type: 'experiment-pointer' });
  return file;
}

export interface LearningNote {
  pattern: string;
  evidence: string[];
  confidence: number;
  scope: 'store' | 'portfolio';
}

/** Deduping writer: repeated patterns update confidence + evidence instead of multiplying notes. */
export function recordLearning(storeId: string, slotLabel: string | null, l: LearningNote): string {
  const base = l.scope === 'portfolio' ? '06_LEARNINGS' : `${storeRoot(storeId, slotLabel)}/Learnings`;
  const file = `${base}/${slug(l.pattern)}.md`;
  const existing = readNote(file);
  if (existing) {
    const bumped = Math.min(0.95, l.confidence);
    appendEntry(file, l.pattern, `Repeated observation (${today()}): confidence → ${bumped}.\n\n${l.evidence.map((e) => `- ${e}`).join('\n')}`);
    return file;
  }
  writeNote(file, l.pattern, [
    `Confidence: ${l.confidence}`, `Scope: ${l.scope}`, '',
    `Pattern:`, '', l.pattern, '',
    `Evidence:`, '', ...l.evidence.map((e) => `- ${e}`),
  ].join('\n'), { type: 'learning', scope: l.scope });
  return file;
}

export function recordObservation(storeId: string, slotLabel: string | null, title: string, body: string): string | null {
  if (body.trim().length < 40) return null; // trivia stays out of the brain
  const file = `${storeRoot(storeId, slotLabel)}/Activity/${today()}.md`;
  appendEntry(file, `Activity ${today()}`, `### ${title}\n\n${body}`);
  return file;
}

export function recordStrategy(storeId: string, slotLabel: string | null, strategy: { status: string; thesis: string; market: string; businessModel: string; rationale: string }, reason: string): void {
  const root = storeRoot(storeId, slotLabel);
  const prev = readNote(`${root}/Business Strategy.md`);
  writeNote(`${root}/Business Strategy.md`, 'Business Strategy', [
    `Status: ${strategy.status}`, `Market: ${strategy.market}`, '',
    `Thesis:`, '', strategy.thesis, '',
    `Business model:`, '', strategy.businessModel, '',
    `Rationale:`, '', strategy.rationale, '',
    `Last change (${today()}): ${reason}`,
  ].join('\n'), { type: 'strategy' });
  writeNote(`${root}/Current Strategy.md`, 'Current Strategy',
    `The believed-winning approach. See: [[${root}/Business Strategy]]\n\n${strategy.thesis}\n\nUpdated ${today()}: ${reason}`,
    { type: 'strategy-pointer' });
  if (prev && !prev.includes(strategy.thesis.slice(0, 60))) {
    appendEntry(`${root}/Decisions/strategy-changelog.md`, 'Strategy changelog',
      `### ${today()} — strategy updated\n\n${reason}\n\nPrevious thesis (superseded):\n\n${prev.slice(0, 800)}`);
  }
}

const PROV_LABEL: Record<string, string> = {
  'user-provided': 'USER PROVIDED', inferred: 'INFERRED', researched: 'RESEARCHED', assumed: 'ASSUMED', unknown: 'UNKNOWN',
};

export function persistBlueprint(storeId: string, slotLabel: string | null, domain: string, context: string, blueprint: any): string {
  const root = storeRoot(storeId, slotLabel);
  const sections = ['business', 'customer', 'market', 'product', 'brand', 'storefront', 'commerce', 'growth', 'operations', 'analytics', 'risks'];
  const render = (sec: string) => {
    const node = blueprint?.[sec] ?? {};
    const lines = Object.entries(node).map(([f, v]: any) =>
      `### ${f}\n\n${v?.value ?? ''}\n\n*${PROV_LABEL[v?.provenance] ?? 'UNKNOWN'}${v?.note ? ` — ${v.note}` : ''}*`);
    return `## ${sec[0].toUpperCase() + sec.slice(1)}\n\n${lines.join('\n\n')}`;
  };
  const list = (arr: any) => (Array.isArray(arr) && arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- (none)');
  const file = `${root}/Store Blueprint.md`;
  writeNote(file, 'Store Blueprint', [
    `Domain: ${domain}`, '',
    `## User Context`, '', context, '',
    `## Compiled Context`, '',
    sections.map(render).join('\n\n'),
    `## Strategic Objectives`, '', list(blueprint?.decisionsStated), '',
    `## Assumptions`, '', list((blueprint?.decisionsInferred ?? []).concat(
      Object.values(blueprint ?? {}).flatMap((sec: any) => typeof sec === 'object' && sec !== null
        ? Object.entries(sec).filter(([, v]: any) => v?.provenance === 'assumed').map(([f, v]: any) => `${f}: ${v.value}`)
        : []))),
    `## Unknowns`, '', list((blueprint?.unknowns ?? []).concat(blueprint?.mustResearch ?? [])),
  ].join('\n'), { type: 'blueprint', domain });
  return file;
}
