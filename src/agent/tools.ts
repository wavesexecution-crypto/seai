import { z } from 'zod';
import type { RiskLevel } from '../policy/autonomy.js';

// Typed tool registry. Every tool declares schemas, permission, risk,
// confirmation, reversibility, idempotency. Model args are validated
// against inputSchema before execution (see security/validate.ts).
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  requiredPermission: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  reversible: boolean;
  idempotent: boolean;
}

const id = z.string().min(1).describe('Shopify GID or numeric id');

export const TOOL_REGISTRY: ToolDef[] = [
  { name: 'store.get', description: 'Get shop metadata', inputSchema: z.object({}), requiredPermission: 'read_products', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'products.list', description: 'List products (paginated)', inputSchema: z.object({ limit: z.number().min(1).max(100).default(25) }), requiredPermission: 'read_products', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'products.get', description: 'Get one product', inputSchema: z.object({ id }), requiredPermission: 'read_products', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'products.create', description: 'Create a product', inputSchema: z.object({ title: z.string().min(1), descriptionHtml: z.string().optional(), vendor: z.string().optional(), productType: z.string().optional(), tags: z.string().optional() }), requiredPermission: 'write_products', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: false },
  { name: 'products.update', description: 'Update title/description/tags/status of a product', inputSchema: z.object({ id, title: z.string().optional(), descriptionHtml: z.string().optional(), tags: z.string().optional(), status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).optional(), seo: z.object({ title: z.string().optional(), description: z.string().optional() }).optional() }), requiredPermission: 'write_products', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'products.archive', description: 'Archive a product (reversible)', inputSchema: z.object({ id }), requiredPermission: 'write_products', riskLevel: 'high', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'inventory.get', description: 'List inventory levels', inputSchema: z.object({ limit: z.number().min(1).max(50).default(25) }), requiredPermission: 'read_inventory', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'inventory.update', description: 'Adjust inventory by delta', inputSchema: z.object({ inventoryItemId: id, locationId: id, availableDelta: z.number().int().min(-1000).max(1000) }), requiredPermission: 'write_inventory', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: false },
  { name: 'orders.list', description: 'List recent orders', inputSchema: z.object({ limit: z.number().min(1).max(100).default(25) }), requiredPermission: 'read_orders', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'orders.get', description: 'Get one order', inputSchema: z.object({ id }), requiredPermission: 'read_orders', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'customers.list', description: 'List customers', inputSchema: z.object({ limit: z.number().min(1).max(100).default(25) }), requiredPermission: 'read_customers', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'customers.get', description: 'Get one customer', inputSchema: z.object({ id }), requiredPermission: 'read_customers', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'discounts.list', description: 'List code discounts', inputSchema: z.object({}), requiredPermission: 'read_discounts', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'discounts.create', description: 'Create a % code discount (experiment-gated)', inputSchema: z.object({ title: z.string().min(1), code: z.string().min(3), percent: z.number().min(1).max(90) }), requiredPermission: 'write_discounts', riskLevel: 'high', requiresConfirmation: true, reversible: true, idempotent: false },
  { name: 'discounts.disable', description: 'Deactivate a code discount', inputSchema: z.object({ id }), requiredPermission: 'write_discounts', riskLevel: 'medium', requiresConfirmation: true, reversible: false, idempotent: true },
  { name: 'collections.list', description: 'List collections', inputSchema: z.object({}), requiredPermission: 'read_products', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'collections.create', description: 'Create a collection', inputSchema: z.object({ title: z.string().min(1), descriptionHtml: z.string().optional() }), requiredPermission: 'write_products', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: false },
  { name: 'collections.addProducts', description: 'Add products to a collection', inputSchema: z.object({ collectionId: id, productIds: z.array(id).min(1).max(50) }), requiredPermission: 'write_products', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'collections.update', description: 'Update collection title/description', inputSchema: z.object({ id, title: z.string().optional(), descriptionHtml: z.string().optional() }), requiredPermission: 'write_products', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'content.list', description: 'List pages', inputSchema: z.object({}), requiredPermission: 'read_content', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'content.create', description: 'Create a store page', inputSchema: z.object({ title: z.string().min(1), body: z.string().optional(), handle: z.string().optional() }), requiredPermission: 'write_content', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: false },
  { name: 'content.update', description: 'Update a page', inputSchema: z.object({ id, title: z.string().optional(), body: z.string().optional() }), requiredPermission: 'write_content', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'analytics.get', description: 'Computed store analytics (revenue/orders/AOV)', inputSchema: z.object({}), requiredPermission: 'read_analytics', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'experiments.create', description: 'Record a controlled experiment', inputSchema: z.object({ hypothesis: z.string().min(10), metric: z.string().min(1), variant: z.record(z.any()).default({}), control: z.record(z.any()).default({}), rollbackPlan: z.record(z.any()).default({}) }), requiredPermission: 'read_analytics', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: false },
  { name: 'experiments.evaluate', description: 'Evaluate an experiment by id', inputSchema: z.object({ id: z.string().min(1) }), requiredPermission: 'read_analytics', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'experiments.rollback', description: 'Rollback an experiment variant', inputSchema: z.object({ id: z.string().min(1) }), requiredPermission: 'write_products', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'themes.get', description: 'List themes (read-only inspection)', inputSchema: z.object({}), requiredPermission: 'read_themes', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'themes.upload', description: 'Write one theme file (css/liquid/json only; shows exact diff for approval)', inputSchema: z.object({ themeId: id, filename: z.string().min(1), value: z.string().min(1) }), requiredPermission: 'write_themes', riskLevel: 'critical', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'policies.update', description: 'Publish a shop policy (refund/shipping/terms/privacy/subscription)', inputSchema: z.object({ type: z.enum(['REFUND', 'SHIPPING', 'TERMS_OF_SERVICE', 'PRIVACY', 'SUBSCRIPTION']), body: z.string().min(50) }), requiredPermission: 'write_content', riskLevel: 'high', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'inventory.ensure', description: 'Set absolute on-hand stock for a product', inputSchema: z.object({ productId: id, quantity: z.number().int().min(0).max(100000) }), requiredPermission: 'write_inventory', riskLevel: 'medium', requiresConfirmation: true, reversible: true, idempotent: true },
  { name: 'strategy.propose', description: 'Propose this store\'s business strategy (SEAI database only; grounded in investigation, never a template)', inputSchema: z.object({ thesis: z.string().min(20), market: z.string().optional(), businessModel: z.string().optional(), rationale: z.string().optional() }), requiredPermission: 'read_analytics', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: false },
  { name: 'strategy.get', description: 'Read this store\'s current strategy (unformed until SEAI proposes one)', inputSchema: z.object({}), requiredPermission: 'read_analytics', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
  { name: 'portfolio.get', description: 'Read-only cross-store comparison (labeled per-store metrics; never merges business state)', inputSchema: z.object({}), requiredPermission: 'read_analytics', riskLevel: 'low', requiresConfirmation: false, reversible: true, idempotent: true },
];

export const TOOL_MAP: Map<string, ToolDef> = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return TOOL_MAP.get(name);
}

export function listTools(): ToolDef[] {
  return TOOL_REGISTRY;
}
