import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../src/policy/autonomy.js';
import { validateToolArgs } from '../src/security/validate.js';
import { analyzeCommerce } from '../src/intelligence/commerce.js';

describe('policy engine', () => {
  it('reads always allowed; writes gated by level', () => {
    expect(evaluatePolicy('orders.list', 'low', { autonomyLevel: 'OBSERVE' }).allowed).toBe(true);
    expect(evaluatePolicy('products.update', 'medium', { autonomyLevel: 'OBSERVE' }).allowed).toBe(false);
    expect(evaluatePolicy('products.update', 'medium', { autonomyLevel: 'ASSIST' }).decision).toBe('require_confirmation');
    expect(evaluatePolicy('products.update', 'medium', { autonomyLevel: 'EXECUTE_SAFE', reversible: true }).allowed).toBe(true);
    expect(evaluatePolicy('products.archive', 'high', { autonomyLevel: 'EXECUTE_SAFE' }).decision).toBe('require_confirmation');
    expect(evaluatePolicy('themes.update', 'critical', { autonomyLevel: 'AUTONOMOUS', reversible: false }).decision).toBe('require_confirmation');
  });
});

describe('tool schemas', () => {
  it('rejects unknown tools and bad args', () => {
    expect(validateToolArgs('nope.tool', {}).ok).toBe(false);
    expect(validateToolArgs('discounts.create', { title: 'x', code: 'AB', percent: 500 }).ok).toBe(false);
    expect(validateToolArgs('discounts.create', { title: 'Fall', code: 'FALL10', percent: 10 }).ok).toBe(true);
    expect(validateToolArgs('products.update', { id: '1', status: 'NOPE' }).ok).toBe(false);
  });
});

describe('commerce intelligence', () => {
  it('never fabricates data on empty store', () => {
    const r = analyzeCommerce([], []);
    expect(r.orders).toBe(0);
    expect(r.narrative).toMatch(/no products yet/i);
  });
  it('interprets AOV-led growth (not just numbers)', () => {
    const mk = (n: number, total: string, items = [{ title: 'Widget', quantity: 1 }]) =>
      Array.from({ length: n }, (_, i) => ({ id: `${i}`, name: `#${i}`, createdAt: '', total, currency: 'USD', items }));
    const prev = mk(10, '10.00');
    const recent = mk(11, '20.00');
    const r = analyzeCommerce([...recent, ...prev] as any);
    expect(r.narrative).toMatch(/AOV/i);
    expect(r.insights.length).toBeGreaterThanOrEqual(3);
  });
});
