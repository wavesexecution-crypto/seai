import { z } from 'zod';
import { db } from '../db/db.js';
import { aiGateway } from '../ai/gateway.js';
import { persistBlueprint } from '../brain/writer.js';
import { slotForShop } from '../stores/registry.js';

// CONTEXT COMPILER — the only bridge between the user's two onboarding inputs
// (domain + free-form paragraph) and the build system. Output is a STORE BLUEPRINT:
// a structured specification where EVERY field carries provenance:
//   user-provided | inferred | researched | assumed | unknown
// Assumptions are never facts. Missing information lands in unknowns/mustResearch,
// never invented. The blueprint drives strategy; it never constrains learning.
export const Provenance = z.enum(['user-provided', 'inferred', 'researched', 'assumed', 'unknown']);

const S = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties: { value: { type: 'string' }, provenance: { type: 'string' }, note: { type: 'string' }, ...extra },
  required: ['value', 'provenance'],
});

const SECTION_FIELDS: Record<string, string[]> = {
  business: ['concept', 'category', 'model', 'commercialObjective', 'strategicObjective', 'geography', 'assumptions'],
  customer: ['target', 'segments', 'demographics', 'needs', 'problems', 'motivations', 'objections', 'triggers', 'intent'],
  market: ['definition', 'opportunity', 'demand', 'competition', 'positioning', 'differentiation', 'risks'],
  product: ['strategy', 'categories', 'hero', 'supporting', 'bundles', 'crossSells', 'upsells', 'hierarchy', 'attributes', 'pricing'],
  brand: ['positioning', 'personality', 'voice', 'naming', 'visual', 'colors', 'typography', 'imagery', 'packaging', 'rules'],
  storefront: ['homepage', 'architecture', 'navigation', 'collections', 'productPage', 'merchandising', 'search', 'cart', 'conversion', 'trust', 'mobile'],
  commerce: ['pricing', 'offers', 'discounts', 'margins', 'aov', 'repeat', 'retention'],
  growth: ['acquisition', 'organic', 'paid', 'content', 'seo', 'cro', 'experimentation'],
  operations: ['inventory', 'fulfillment', 'support', 'dependencies', 'integrations'],
  analytics: ['kpis', 'primaryObjective', 'secondaryMetrics', 'thresholds', 'experimentMetrics'],
  risks: ['business', 'operational', 'compliance', 'platform', 'unknowns'],
};

function blueprintJsonSchema(): Record<string, unknown> {
  const sections: Record<string, unknown> = {};
  for (const [sec, fields] of Object.entries(SECTION_FIELDS)) {
    const props: Record<string, unknown> = {};
    for (const f of fields) props[f] = S();
    sections[sec] = { type: 'object', properties: props, required: fields };
  }
  return {
    type: 'object',
    properties: {
      ...sections,
      decisionsStated: { type: 'array', items: { type: 'string' } },
      decisionsInferred: { type: 'array', items: { type: 'string' } },
      seaiMustDecide: { type: 'array', items: { type: 'string' } },
      unknowns: { type: 'array', items: { type: 'string' } },
      mustResearch: { type: 'array', items: { type: 'string' } },
    },
    required: [...Object.keys(sections), 'decisionsStated', 'decisionsInferred', 'seaiMustDecide', 'unknowns', 'mustResearch'],
  };
}

export interface Blueprint { [k: string]: unknown }

export function validateOnboardInput(domain: unknown, context: unknown): { domain: string; context: string } {
  const d = String(domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/\.$/, '');
  if (!/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,}$/i.test(d)) {
    throw new Error('domain must be a valid hostname like example.com');
  }
  if (/(^|\.)shopify\.com$/.test(d) || /(^|\.)myshopify\.com$/.test(d)) {
    throw new Error('use your public store domain (like example.com) — Shopify system addresses are resolved through the store connection, not typed here');
  }
  const c = String(context ?? '').trim();
  if (c.length < 20) throw new Error('tell SEAI a little more — at least a sentence or two about what to build');
  if (c.length > 8000) throw new Error('context is too long — keep it under 8000 characters');
  return { domain: d, context: c };
}

function assertProvenance(bp: any): void {
  const ok = new Set(['user-provided', 'inferred', 'researched', 'assumed', 'unknown']);
  for (const sec of Object.keys(SECTION_FIELDS)) {
    const node = bp?.[sec];
    if (!node || typeof node !== 'object') throw new Error(`blueprint missing section: ${sec}`);
    for (const f of SECTION_FIELDS[sec]) {
      const leaf = node[f];
      if (!leaf || typeof leaf.value !== 'string') throw new Error(`blueprint missing ${sec}.${f}`);
      if (!ok.has(leaf.provenance)) throw new Error(`blueprint ${sec}.${f} has invalid provenance`);
      if (leaf.provenance === 'researched') {
        throw new Error(`blueprint ${sec}.${f} claims researched evidence the compiler cannot have — mark inferred or unknown`);
      }
    }
  }
  for (const k of ['decisionsStated', 'decisionsInferred', 'seaiMustDecide', 'unknowns', 'mustResearch']) {
    if (!Array.isArray(bp?.[k])) throw new Error(`blueprint missing ${k}`);
  }
}

export async function compileBlueprint(storeId: string, domain: string, context: string): Promise<Blueprint> {
  const raw = await aiGateway.toolCall(
    'context_compiler',
    'You are the SEAI Context Compiler. Expand the user brief into a complete store blueprint. Rules: only mark user-provided what the brief literally states; mark reasonable derivations inferred; mark working premises assumed; mark the rest unknown and list them in unknowns/mustResearch. NEVER use provenance researched (you have no live sources). NEVER invent user facts, suppliers, certifications, reviews, or metrics. Keep each value to 1-3 sentences.',
    blueprintJsonSchema(),
    `DOMAIN: ${domain}\nUSER BRIEF:\n${context}`,
    { maxTokens: 7000 },
    storeId
  );
  const bp = (raw as any)?._raw ? JSON.parse(String((raw as any)._raw).replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) : raw;
  assertProvenance(bp);
  try {
    const ex = await db.list('blueprints', { store_id: storeId } as any, 1);
    const row = {
      store_id: storeId, domain, context_raw: context.slice(0, 8000),
      blueprint: JSON.stringify(bp), status: 'compiled', updated_at: new Date().toISOString(),
    };
    if (ex[0]) await db.update('blueprints', storeId, row);
    else await db.insert('blueprints', { id: storeId, ...row, created_at: new Date().toISOString() });
  } catch (e: any) {
    throw new Error(`blueprint persist failed: ${e.message}`);
  }
  // Human-readable mirror in the vault (provenance-labeled). Vault failure never fails compilation.
  try {
    const slot = await slotForShop(storeId).catch(() => null);
    persistBlueprint(storeId, slot?.label ?? null, domain, context, bp);
  } catch { /* ignore */ }
  return bp as Blueprint;
}

export async function getBlueprint(storeId: string): Promise<{ domain: string; context: string; blueprint: Blueprint; status: string } | null> {
  try {
    const rows = await db.list('blueprints', { store_id: storeId } as any, 1);
    if (!rows[0]) return null;
    const r = rows[0];
    const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return {}; } };
    return { domain: r.domain ?? '', context: r.context_raw ?? '', blueprint: parse(r.blueprint), status: r.status ?? 'compiled' };
  } catch {
    return null;
  }
}

/** Render the blueprint as the user-facing "SEAI's understanding" (values only, no identifiers). */
export function summarizeBlueprint(bp: Blueprint): { section: string; items: { field: string; value: string; provenance: string }[] }[] {
  const labels: Record<string, string> = {
    business: 'Business', customer: 'Customer', market: 'Market', product: 'Product', brand: 'Brand',
    storefront: 'Store', commerce: 'Commerce', growth: 'Growth', operations: 'Operations',
    analytics: 'Objectives', risks: 'Risks',
  };
  const out: { section: string; items: { field: string; value: string; provenance: string }[] }[] = [];
  for (const [sec, label] of Object.entries(labels)) {
    const node: any = (bp as any)?.[sec] ?? {};
    const items = Object.entries(node)
      .filter(([, v]: any) => v && typeof v.value === 'string' && v.value.trim())
      .map(([f, v]: any) => ({ field: f, value: v.value, provenance: v.provenance }));
    if (items.length) out.push({ section: label, items });
  }
  return out;
}
