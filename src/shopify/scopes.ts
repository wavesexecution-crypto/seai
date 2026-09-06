// Permission registry: every requested scope must have a documented reason.
// The OAuth flow requests exactly these scopes (see config.shopify.scopes).
export interface ScopeDoc { scope: string; reason: string; usedBy: string[]; }

export const SCOPE_REGISTRY: ScopeDoc[] = [
  { scope: 'read_products', reason: 'Read catalog for analysis, opportunity detection, reporting', usedBy: ['products.list', 'products.get', 'store.get'] },
  { scope: 'write_products', reason: 'Create/update/archive products only via approved policy-gated actions', usedBy: ['products.create', 'products.update', 'products.archive'] },
  { scope: 'read_orders', reason: 'Revenue/AOV/trend analysis and anomaly detection', usedBy: ['orders.list', 'orders.get', 'analytics.get'] },
  { scope: 'write_orders', reason: 'Controlled order edits (address/tags) via experiments with rollback', usedBy: ['orders.update'] },
  { scope: 'read_customers', reason: 'Segmentation, repeat-purchase and LTV analysis', usedBy: ['customers.list', 'customers.get'] },
  { scope: 'write_customers', reason: 'Tags/notes updates through policy engine only', usedBy: ['customers.update'] },
  { scope: 'read_inventory', reason: 'Stockout risk and velocity monitoring', usedBy: ['inventory.get'] },
  { scope: 'read_locations', reason: 'Resolve a fulfillment location when stocking newly created products', usedBy: ['inventory.ensure'] },
  { scope: 'read_files', reason: 'Read store files and product imagery for catalog/asset review', usedBy: ['catalog imagery'] },
  { scope: 'write_files', reason: 'Upload product imagery and brand assets', usedBy: ['catalog imagery'] },
  { scope: 'read_markets', reason: 'Market and currency context for pricing and domain verification', usedBy: ['pricing architecture'] },
  { scope: 'write_inventory', reason: 'Adjust quantities only for safe, reversible corrections', usedBy: ['inventory.update'] },
  { scope: 'read_discounts', reason: 'Discount performance measurement', usedBy: ['discounts.list'] },
  { scope: 'write_discounts', reason: 'Create/disable code discounts as controlled experiments', usedBy: ['discounts.create', 'discounts.update', 'discounts.disable'] },
  { scope: 'read_content', reason: 'Read pages/blogs for content audits', usedBy: ['content.list'] },
  { scope: 'write_content', reason: 'Edit page content via approved actions with rollback', usedBy: ['content.update'] },
  { scope: 'read_themes', reason: 'Inspect active theme for storefront health checks (no edits by default)', usedBy: ['themes.get'] },
  { scope: 'write_themes', reason: 'Reserved: theme edits blocked unless AUTONOMOUS + explicit approval', usedBy: ['themes.update'] },
  { scope: 'read_analytics', reason: 'Shopify analytics where available (falls back to computed metrics)', usedBy: ['analytics.get'] },  { scope: 'read_fulfillments', reason: 'Fulfillment status for order health', usedBy: ['fulfillment.get'] },
  { scope: 'write_fulfillments', reason: 'Fulfillment updates only via approved fulfillment tools', usedBy: ['fulfillment.update'] },
];

export function scopeReasons(): Record<string, string> {
  return Object.fromEntries(SCOPE_REGISTRY.map((s) => [s.scope, s.reason]));
}

export function validateScopes(requested: string[]): { unknown: string[]; documented: string[] } {
  const known = new Set(SCOPE_REGISTRY.map((s) => s.scope));
  return {
    unknown: requested.filter((s) => !known.has(s)),
    documented: requested.filter((s) => known.has(s)),
  };
}
