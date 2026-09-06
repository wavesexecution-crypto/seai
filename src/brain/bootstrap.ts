import { brainDir, vaultName, writeNote, noteExists } from './vault.js';

// One-time vault bootstrap: system docs, portfolio layer, per-store skeletons,
// market/experiment/decision/learning/archive areas. Idempotent.
const SYSTEM_DOCS: Record<string, string> = {
  '00_SYSTEM/README.md': `This vault is SEAI's persistent brain: knowledge and memory, not live state.\n\nLive state (products, orders, customers, inventory, sessions, credentials, finances) lives in Shopify and the application database and is the source of truth for what is happening now. This vault records what SEAI has learned: why decisions were made, what was tried, what worked, and what failed.`,
  '00_SYSTEM/Operating Principles.md': `1. Never confuse observation (fact) with hypothesis (guess).\n2. Every decision records its reasoning, evidence, alternatives, and expected outcome.\n3. Every experiment records hypothesis, action, result, and learning.\n4. When results contradict strategy, update the strategy and record why.\n5. Never store credentials, tokens, keys, or customer payment data here.\n6. Store conclusions with evidence — never raw tool logs or idle speculation.\n7. Store memory is isolated per store; portfolio memory holds generalized patterns only.`,
  '00_SYSTEM/Decision Framework.md': `Decisions require: objective, observation, hypothesis, evidence, alternatives, expected outcome, risk, confidence, measurement plan. After execution: actual outcome, interpretation, and whether the hypothesis survived. Low-confidence or high-risk decisions need human approval per the autonomy policy.`,
  '00_SYSTEM/Memory Rules.md': `Write when: a decision is made, an experiment concludes, a strategy changes, a pattern repeats (raise or lower confidence), research yields durable insight.\nDo not write: routine reads, raw logs, guesses without evidence, duplicate notes (update instead).\nProvenance on every claim: user-provided, inferred, researched (with source), assumed, or unknown.`,
  '01_PORTFOLIO/Portfolio Overview.md': `Six independent store experiments. Compares strategies on identical measured metrics. Poor performance alone never triggers shutdown — evidence plus autonomy policy govern change.`,
  '01_PORTFOLIO/Winning Strategies.md': `Patterns that won, with the evidence behind them. Generalized — no store-private details.`,
  '01_PORTFOLIO/Cross Store Learnings.md': `Durable cross-store lessons: merchandising, pricing, conversion, customer behavior. Generalized patterns only.`,
  '04_EXPERIMENTS/README.md': `Index of experiments. Each experiment links store strategy, decision, result, and learning.`,
  '05_DECISIONS/README.md': `Index of significant autonomous decisions with reasoning and outcomes.`,
  '06_LEARNINGS/README.md': `Durable lessons with confidence that rises or falls on repetition.`,
  '07_ARCHIVE/README.md': `Retired strategies, superseded notes, and closed-out history. Nothing here drives decisions.`,
};

const STORE_SKELETON: [string, string][] = [
  ['Store Blueprint.md', 'Compiled from the onboarding brief. Provenance on every field.'],
  ['Business Strategy.md', 'The authoritative strategy this store operates under. Updated only with recorded reasons.'],
  ['Brand Strategy.md', 'Positioning, voice, visual direction.'],
  ['Product Strategy.md', 'Hero, supporting products, bundles, price architecture.'],
  ['Customer Understanding.md', 'Who buys, why, and what stops them.'],
  ['Market Understanding.md', 'Demand, competition, differentiation.'],
  ['Current Strategy.md', 'Pointer to the currently believed-winning approach.'],
];

const SUBDIRS = ['Decisions', 'Experiments', 'Learnings', 'Research', 'Activity'];

export function bootstrapVault(slotLabels: string[] = ['Store 01', 'Store 02', 'Store 03', 'Store 04', 'Store 05', 'Store 06']): { created: number } {
  let created = 0;
  const put = (rel: string, title: string, body: string) => {
    if (!noteExists(rel)) { writeNote(rel, title, body); created++; }
  };
  for (const [rel, body] of Object.entries(SYSTEM_DOCS)) {
    put(rel, rel.split('/').pop()!.replace(/\.md$/, ''), body);
  }
  for (const label of slotLabels) {
    for (const [file, desc] of STORE_SKELETON) {
      put(`02_STORES/${label}/${file}`, file.replace(/\.md$/, ''), `${desc}\n\n*No entries yet.*`);
    }
    for (const d of SUBDIRS) {
      put(`02_STORES/${label}/${d}/.keep.md`, '.keep', 'Placeholder — safe to delete once real notes exist.');
    }
  }
  for (const d of ['03_MARKET/Markets', '03_MARKET/Competitors', '03_MARKET/Products', '03_MARKET/Research']) {
    put(`${d}/.keep.md`, '.keep', 'Placeholder — safe to delete once real notes exist.');
  }
  return { created };
}

export function vaultInfo(): { name: string; dir: string } {
  return { name: vaultName(), dir: brainDir() };
}
