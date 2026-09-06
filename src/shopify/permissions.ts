// Centralized PERMISSION_REGISTRY — the single source of truth for every
// Shopify scope SEAI requests. For each scope: purpose, features requiring it,
// risk, and whether it is required or optional. Only real Shopify Admin API
// scopes appear here. If Shopify denies a protected scope, SEAI detects that
// state at runtime (see isScopeError), reports it, and continues with the
// capabilities it does have — never pretending the permission exists.
export interface PermissionDoc {
  scope: string;
  purpose: string;
  features: string[];
  risk: 'low' | 'medium' | 'high';
  required: boolean;
}

export const PERMISSION_REGISTRY: PermissionDoc[] = [
  { scope: 'read_products', purpose: 'Read catalog for analysis and reporting', features: ['products.list', 'products.get', 'store.get'], risk: 'low', required: true },
  { scope: 'write_products', purpose: 'Build and maintain the catalog autonomously', features: ['products.create', 'products.update', 'products.archive', 'collections.create', 'collections.addProducts'], risk: 'medium', required: true },
  { scope: 'read_orders', purpose: 'Revenue, AOV, and trend analysis', features: ['orders.list', 'orders.get', 'analytics.get'], risk: 'low', required: true },
  { scope: 'write_orders', purpose: 'Controlled order corrections via experiments', features: ['orders.update'], risk: 'medium', required: false },
  { scope: 'read_customers', purpose: 'Segmentation and repeat-purchase analysis', features: ['customers.list', 'customers.get'], risk: 'low', required: true },
  { scope: 'write_customers', purpose: 'Tag/note updates through policy only', features: ['customers.update'], risk: 'medium', required: false },
  { scope: 'read_inventory', purpose: 'Stockout risk and velocity monitoring', features: ['inventory.get'], risk: 'low', required: true },
  { scope: 'write_inventory', purpose: 'Declare opening stock and safe corrections', features: ['inventory.update', 'inventory.ensure'], risk: 'medium', required: true },
  { scope: 'read_locations', purpose: 'Resolve fulfillment locations when stocking products', features: ['inventory.ensure'], risk: 'low', required: true },
  { scope: 'read_discounts', purpose: 'Discount performance measurement', features: ['discounts.list'], risk: 'low', required: true },
  { scope: 'write_discounts', purpose: 'Offer creation as controlled experiments', features: ['discounts.create', 'discounts.disable'], risk: 'high', required: true },
  { scope: 'read_content', purpose: 'Content audits', features: ['content.list'], risk: 'low', required: true },
  { scope: 'write_content', purpose: 'Publish pages and shop policies', features: ['content.create', 'content.update', 'policies.update'], risk: 'medium', required: true },
  { scope: 'read_themes', purpose: 'Inspect the active storefront theme', features: ['themes.get'], risk: 'low', required: true },
  { scope: 'write_themes', purpose: 'Approval-gated additive theme files only', features: ['themes.upload'], risk: 'high', required: false },
  { scope: 'read_files', purpose: 'Read store files and product imagery', features: ['catalog imagery', 'asset review'], risk: 'low', required: true },
  { scope: 'write_files', purpose: 'Upload product imagery and brand assets', features: ['catalog imagery', 'asset publishing'], risk: 'medium', required: true },
  { scope: 'read_analytics', purpose: 'Shopify analytics where available', features: ['analytics.get'], risk: 'low', required: false },
  { scope: 'read_markets', purpose: 'Market and currency context for pricing', features: ['pricing architecture', 'domain verification context'], risk: 'low', required: false },
  { scope: 'read_fulfillments', purpose: 'Fulfillment status for order health', features: ['fulfillment.get'], risk: 'low', required: false },
  { scope: 'write_fulfillments', purpose: 'Fulfillment updates via approved tools', features: ['fulfillment.update'], risk: 'medium', required: false },
];

export function requiredScopes(): string[] {
  return PERMISSION_REGISTRY.filter((p) => p.required).map((p) => p.scope);
}

export function validateRegistry(requested: string[]): { unknown: string[]; undocumented: string[]; missingRequired: string[] } {
  const known = new Set(PERMISSION_REGISTRY.map((p) => p.scope));
  return {
    unknown: requested.filter((s) => !known.has(s)),
    undocumented: requested.filter((s) => !known.has(s)),
    missingRequired: requiredScopes().filter((s) => !requested.includes(s)),
  };
}

/** Detect Shopify scope/permission denials so the system reports instead of pretends. */
export function isScopeError(message: string): boolean {
  return /access denied|not authorized|unauthorized.*scope|missing.*scope|scope.*required|forbidden.*scope|protected.*scope/i.test(message || '');
}
