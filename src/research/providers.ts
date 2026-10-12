import { z } from 'zod';
import { aiGateway } from '../ai/gateway.js';

// Business discovery. The model estimates opportunity criteria from its training
// knowledge; every criterion carries a justification and the whole record is
// labeled model-estimated with an explicit confidence — never presented as
// measured market data. A future live SearchProvider can plug in here to
// upgrade estimates with observed evidence.
export const OpportunitySchema = z.object({
  market: z.string().min(3),
  thesis: z.string().min(40),
  demand: z.number().int().min(1).max(10),
  competition: z.number().int().min(1).max(10),
  marginPotential: z.number().int().min(1).max(10),
  acquisitionPotential: z.number().int().min(1).max(10),
  repeatPurchasePotential: z.number().int().min(1).max(10),
  operationalComplexity: z.number().int().min(1).max(10),
  risk: z.number().int().min(1).max(10),
  confidence: z.number().min(0).max(1),
  justification: z.record(z.string()).default({}),
});

export type Opportunity = z.infer<typeof OpportunitySchema> & { score: number; estimatedAt: string };

const WEIGHTS: Record<string, number> = {
  demand: 0.2, competition: 0.12, marginPotential: 0.2, acquisitionPotential: 0.12,
  repeatPurchasePotential: 0.14, operationalComplexity: 0.1, risk: 0.12,
};

export function scoreOpportunity(o: z.infer<typeof OpportunitySchema>): number {
  // competition/complexity/risk are costs (invert); rest are benefits
  const benefit = (v: number) => v;
  const cost = (v: number) => 11 - v;
  const s =
    benefit(o.demand) * WEIGHTS.demand +
    cost(o.competition) * WEIGHTS.competition +
    benefit(o.marginPotential) * WEIGHTS.marginPotential +
    benefit(o.acquisitionPotential) * WEIGHTS.acquisitionPotential +
    benefit(o.repeatPurchasePotential) * WEIGHTS.repeatPurchasePotential +
    cost(o.operationalComplexity) * WEIGHTS.operationalComplexity +
    cost(o.risk) * WEIGHTS.risk;
  return Number(((s / 10) * 100).toFixed(1));
}

export async function elicitOpportunities(storeId: string | null, count = 3, brief?: string): Promise<Opportunity[]> {
  const raw = await aiGateway.toolCall(
    'opportunity_research',
    'Propose distinct viable online-retail opportunities for a blank Shopify store. Score each criterion 1-10 honestly; set confidence by evidence strength. No brands, no niches precluded, no random picks — justify every score.' +
    (brief ? ' A user brief and compiled blueprint follow: stay aligned with what the user stated, use inferred blueprint direction as guidance, and never contradict stated constraints.' : ''),
    {
      type: 'object',
      properties: {
        opportunities: {
          type: 'array', minItems: 1, maxItems: count,
          items: {
            type: 'object',
            properties: {
              market: { type: 'string' }, thesis: { type: 'string' },
              demand: { type: 'integer' }, competition: { type: 'integer' },
              marginPotential: { type: 'integer' }, acquisitionPotential: { type: 'integer' },
              repeatPurchasePotential: { type: 'integer' }, operationalComplexity: { type: 'integer' },
              risk: { type: 'integer' }, confidence: { type: 'number' },
              justification: { type: 'object' },
            },
            required: ['market', 'thesis', 'demand', 'competition', 'marginPotential', 'acquisitionPotential', 'repeatPurchasePotential', 'operationalComplexity', 'risk', 'confidence'],
          },
        },
      },
      required: ['opportunities'],
    },
    `Blank store. Return ${count} distinct opportunities as JSON.` + (brief ? `\n\n${brief}` : ''),
    { maxTokens: 2500 },
    storeId
  );
  const list = (raw as any)?.opportunities;
  if (!Array.isArray(list) || !list.length) throw new Error('research returned no usable opportunities');
  return list.slice(0, count).map((o) => {
    const parsed = OpportunitySchema.parse(o);
    return { ...parsed, score: scoreOpportunity(parsed), estimatedAt: new Date().toISOString() };
  }).sort((a, b) => b.score - a.score);
}

/** Trademark screen. No registry access exists at runtime: checks the store's own
 * catalog for collisions and otherwise records an explicit human-review requirement. */
export async function trademarkScreen(shop: string, brandName: string, existingTitles: string[]): Promise<{ clear: boolean; collision: boolean; note: string }> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = existingTitles.find((t) => norm(t).includes(norm(brandName)) || norm(brandName).includes(norm(t)));
  if (hit) return { clear: false, collision: true, note: `Collision inside store catalog: "${hit}". Choose another name.` };
  return {
    clear: false,
    collision: false,
    note: `No in-catalog collision for "${brandName}". Automated trademark-registry verification is unavailable — human legal review is REQUIRED before launch (flagged in readiness).`,
  };
}
