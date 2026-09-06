import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-brain-test-'));
process.env.SEAI_SCHEDULER = 'off';

beforeAll(async () => {
  const { bootstrapVault } = await import('../src/brain/bootstrap.js');
  bootstrapVault();
});

describe('vault bootstrap', () => {
  it('creates the full structure with no secrets', async () => {
    const { listNotes, readNote } = await import('../src/brain/vault.js');
    const notes = listNotes('');
    const paths = notes.map((n) => n.path);
    expect(paths).toContain('00_SYSTEM/Operating Principles.md');
    expect(paths).toContain('01_PORTFOLIO/Portfolio Overview.md');
    expect(paths).toContain('02_STORES/Store 01/Business Strategy.md');
    expect(paths).toContain('02_STORES/Store 06/Store Blueprint.md');
    expect(paths).toContain('04_EXPERIMENTS/README.md');
    const sys = readNote('00_SYSTEM/Operating Principles.md') ?? '';
    expect(sys).not.toMatch(/shpat_|OLLAMA_API_KEY|PRIVATE KEY/);
  });

  it('rejects unsafe paths', async () => {
    const { safePath } = await import('../src/brain/vault.js');
    expect(() => safePath('../escape.md')).toThrow();
    expect(() => safePath('/abs.md')).toThrow();
    expect(safePath('02_STORES/Store 01/x.md')).toContain('Store 01');
  });
});

describe('secret guards', () => {
  it('refuses credentials in any brain write', async () => {
    const { writeNote, appendEntry } = await import('../src/brain/vault.js');
    expect(() => writeNote('t/a.md', 't', 'token shpat_abc123 here')).toThrow(/secret/);
    expect(() => writeNote('t/b.md', 't', '-----BEGIN PRIVATE KEY-----\nx')).toThrow(/secret/);
    expect(() => appendEntry('t/c.md', 't', 'key sk-ant-abcdefghijklmnopqrst')).toThrow(/secret/);
    // configured Ollama key material is refused verbatim
    const { config } = await import('../src/config.js');
    if (config.ollamaKeys[0]) {
      expect(() => writeNote('t/d.md', 't', `leak ${config.ollamaKeys[0]}`)).toThrow(/credential/);
    }
  });
});

describe('memory quality gates', () => {
  it('writes significant decisions, skips trivia, dedupes learnings', async () => {
    const { recordDecision, recordLearning, recordObservation, significantDecision } = await import('../src/brain/writer.js');
    expect(significantDecision({ confidence: 0.1, proposed_action: '' })).toBe(false);
    expect(significantDecision({ confidence: 0.7, proposed_action: 'x' })).toBe(true);
    expect(recordObservation('s1', 'Store 01', 't', 'short')).toBeNull();
    const f = recordDecision('s1', 'Store 01', {
      title: 'Raise hero price', store: 's1', decision: 'Raise hero price by 10%.',
      reason: 'Margin expansion test.', evidence: ['AOV flat 4 weeks'], alternatives: ['Hold price'],
      expectedOutcome: '+8% margin', confidence: 0.6, status: 'proposed', runId: 'r1',
    });
    expect(f).toContain('02_STORES/Store 01/Decisions/');
    const l1 = recordLearning('s1', 'Store 01', { pattern: 'Bundles lift AOV', evidence: ['+12% in test 1'], confidence: 0.6, scope: 'store' });
    const l2 = recordLearning('s1', 'Store 01', { pattern: 'Bundles lift AOV', evidence: ['+9% in test 2'], confidence: 0.75, scope: 'store' });
    expect(l1).toBe(l2);
    const { readNote } = await import('../src/brain/vault.js');
    expect(readNote(l2)).toMatch(/test 2/);
  });

  it('never mixes store memory', async () => {
    const { recordObservation } = await import('../src/brain/writer.js');
    const { retrieve } = await import('../src/brain/retrieve.js');
    recordObservation('alpha.myshopify.com', 'Store 01', 'Alpha insight', 'Alpha storefront converts bargain hunters with bundle pricing ladders.');
    recordObservation('beta.myshopify.com', 'Store 02', 'Beta insight', 'Beta atelier sells single-origin ceramics to collectors of wabi-sabi aesthetics.');
    const hits = retrieve({ storeId: 'beta.myshopify.com', slotLabel: 'Store 02', query: 'collectors ceramics wabi-sabi aesthetics' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => !h.path.includes('Store 01'))).toBe(true);
    expect(JSON.stringify(hits)).not.toContain('Alpha');
  });
});

describe('retrieval budgets', () => {
  it('caps results and characters', async () => {
    const { retrieve, formatForContext } = await import('../src/brain/retrieve.js');
    const hits = retrieve({ storeId: 'beta.myshopify.com', slotLabel: 'Store 02', query: 'ceramics collectors store experiment decision strategy', k: 2, budgetChars: 500 });
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(formatForContext(hits).length).toBeLessThanOrEqual(700);
    expect(retrieve({ storeId: 'x', query: '' })).toEqual([]);
  });
});

describe('restart persistence', () => {
  it('knowledge survives as files on disk', async () => {
    const { recordExperiment } = await import('../src/brain/writer.js');
    const f = recordExperiment('s9', 'Store 03', {
      title: 'Free shipping threshold', store: 's9', hypothesis: 'A $75 threshold lifts AOV.',
      objective: 'Lift AOV', metric: 'aov', variant: { threshold: 75 }, control: { threshold: 0 },
      result: { deltaPct: 11 }, interpretation: 'Threshold worked.', decision: 'keep variant',
      learning: 'Thresholds beat sitewide discounts for AOV.', experimentId: 'e1',
    });
    // fresh read straight from disk — no process memory involved
    const { readFileSync, existsSync } = await import('node:fs');
    const { safePath } = await import('../src/brain/vault.js');
    expect(existsSync(safePath(f))).toBe(true);
    const raw = readFileSync(safePath(f), 'utf8');
    expect(raw).toMatch(/Free shipping threshold/);
    expect(raw).toMatch(/\[\[02_STORES\/Store 03\/Current Strategy\]\]/);
  });
});

describe('blueprint persistence', () => {
  it('writes a provenance-labeled Store Blueprint.md', async () => {
    const { persistBlueprint } = await import('../src/brain/writer.js');
    const { readNote } = await import('../src/brain/vault.js');
    const f = persistBlueprint('bp.myshopify.com', 'Store 04', 'example.com', 'I want premium skincare.', {
      business: { concept: { value: 'Premium skincare', provenance: 'inferred' } },
      unknowns: ['CAC'], mustResearch: ['pricing'],
      decisionsStated: ['premium'], decisionsInferred: [], seaiMustDecide: [],
    });
    expect(f).toContain('02_STORES/Store 04/Store Blueprint.md');
    const body = readNote(f) ?? '';
    expect(body).toMatch(/INFERRED/);
    expect(body).toMatch(/example\.com/);
    expect(body).toMatch(/I want premium skincare/);
  });
});
