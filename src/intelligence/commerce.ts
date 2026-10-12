import type { Order } from '../shopify/services.js';

export interface CommerceInsight {
  metric: string;
  value: number | string;
  deltaPct: number | null;
  interpretation: string;
}

export interface CommerceReport {
  revenue: number; orders: number; aov: number; currency: string | null;
  insights: CommerceInsight[];
  opportunities: string[];
  risks: string[];
  narrative: string;
}

const pct = (cur: number, prev: number): number | null =>
  prev === 0 ? (cur > 0 ? 100 : null) : Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));

/** Commerce intelligence: computes metrics AND interprets them (never just numbers). */
export function analyzeCommerce(orders: Order[], products: { id: string; title: string }[] = []): CommerceReport {
  if (!orders.length) {
    return {
      revenue: 0, orders: 0, aov: 0, currency: null,
      insights: [{ metric: 'store_activity', value: 'no orders', deltaPct: null, interpretation: 'The store has no order history in the sampled window. SEAI cannot infer demand yet — focus on catalog readiness and traffic.' }],
      opportunities: products.length ? ['Catalog exists but no sales sampled — investigate traffic/conversion before pricing changes.'] : ['The store has no products yet — create the first product before any optimization.'],
      risks: ['No baseline: avoid experiments until at least a few days of traffic exist.'],
      narrative: products.length
        ? 'The store has a catalog but no sampled orders. SEAI will not fabricate demand — next step is verifying traffic and conversion.'
        : 'The store has no products yet.',
    };
  }
  const half = Math.floor(orders.length / 2);
  const recent = orders.slice(0, half || orders.length);
  const prev = orders.slice(half || orders.length);
  const sum = (xs: Order[]) => xs.reduce((a, o) => a + Number(o.total ?? 0), 0);
  const revR = sum(recent), revP = sum(prev);
  const nR = recent.length, nP = prev.length || 1;
  const aovR = nR ? revR / nR : 0, aovP = prev.length ? revP / prev.length : aovR;
  const currency = orders[0]?.currency ?? null;
  const dRev = pct(revR, revP), dOrd = pct(nR, nP), dAov = pct(aovR, aovP);

  // Concentration: which products drive recent revenue?
  const byProduct = new Map<string, { rev: number; qty: number }>();
  for (const o of recent) {
    const share = nR ? Number(o.total ?? 0) : 0;
    for (const it of o.items ?? []) {
      const e = byProduct.get(it.title) ?? { rev: 0, qty: 0 };
      e.qty += it.quantity;
      e.rev += share / Math.max(1, (o.items ?? []).length);
      byProduct.set(it.title, e);
    }
  }
  const top = [...byProduct.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 3);
  const topShare = revR > 0 && top.length ? Number(((top[0][1].rev / revR) * 100).toFixed(1)) : null;

  const insights: CommerceInsight[] = [
    { metric: 'revenue', value: Number(revR.toFixed(2)), deltaPct: dRev, interpretation: dRev === null ? `Sampled revenue ${revR.toFixed(2)} with no prior baseline.` : `Revenue ${dRev >= 0 ? 'up' : 'down'} ${Math.abs(dRev)}% vs prior window.` },
    { metric: 'orders', value: nR, deltaPct: dOrd, interpretation: `Order count ${dOrd !== null && dOrd >= 0 ? 'up' : 'down'} ${dOrd !== null ? Math.abs(dOrd) + '%' : ''}. ${dRev !== null && dOrd !== null && dRev > dOrd + 5 ? 'Growth is AOV-led, not volume-led.' : dOrd !== null && dRev !== null && dOrd > dRev + 5 ? 'Volume grew faster than revenue — discounting or mix shift suspected.' : 'Revenue and orders move together.'}` },
    { metric: 'aov', value: Number(aovR.toFixed(2)), deltaPct: dAov, interpretation: `AOV ${Number(aovR.toFixed(2))}${currency ? ' ' + currency : ''}. ${dAov !== null && dAov > 10 ? 'AOV expanded materially — check bundles/upsells.' : dAov !== null && dAov < -10 ? 'AOV contracted — check discount depth.' : 'AOV stable.'}` },
  ];
  if (top.length && topShare !== null) {
    insights.push({ metric: 'concentration', value: `${top[0][0]} ${topShare}%`, deltaPct: null, interpretation: `${top[0][0]} accounts for ~${topShare}% of recent sampled revenue. Concentration is ${topShare > 60 ? 'HIGH — single-product risk' : topShare > 35 ? 'moderate' : 'healthy'}.` });
  }

  const opportunities: string[] = [];
  const risks: string[] = [];
  if (dRev !== null && dRev < -15) risks.push(`Revenue down ${Math.abs(dRev)}% — diagnose before acting.`);
  if (topShare !== null && topShare > 60) risks.push(`Single-product dependence on ${top[0][0]} — diversify with a bundle experiment.`);
  if (dAov !== null && dAov > 10) opportunities.push('AOV expansion detected — test a bundle or threshold discount as a controlled experiment.');
  if (nR >= 10 && (!dOrd || dOrd <= 2) && (dRev ?? 0) > 10) opportunities.push('Price/mix is lifting revenue without volume — verify margin before scaling.');
  if (!opportunities.length) opportunities.push('No strong signal in sampled window — run daily monitoring rather than forcing a change.');

  const narrative =
    `Revenue is ${dRev !== null ? (dRev >= 0 ? `up ${dRev}%` : `down ${Math.abs(dRev)}%`) : 'unsampled against baseline'}, ` +
    `orders ${dOrd !== null ? (dOrd >= 0 ? `up ${dOrd}%` : `down ${Math.abs(dOrd)}%`) : 'flat'}, ` +
    `AOV ${Number(aovR.toFixed(2))}${currency ? ' ' + currency : ''}. ` +
    (top.length ? `Concentration: ${top[0][0]} ~${topShare}% of recent revenue. ` : '') +
    (risks.length ? `Risk: ${risks[0]} ` : '') +
    `Recommendation: ${opportunities[0]}`;

  return { revenue: Number(revR.toFixed(2)), orders: nR, aov: Number(aovR.toFixed(2)), currency, insights, opportunities, risks, narrative };
}

/** Inventory risk: stockout flags by velocity heuristic. */
export function inventoryRisks(levels: any[]): { risks: string[]; count: number } {
  const low = levels.filter((l) => Number(l.available ?? 0) <= 3);
  return {
    count: low.length,
    risks: low.slice(0, 10).map((l) => `Low stock: ${l.item?.variant?.product?.title ?? l.item?.sku ?? l.id} (${l.available} @ ${l.location?.name ?? 'unknown'})`),
  };
}
