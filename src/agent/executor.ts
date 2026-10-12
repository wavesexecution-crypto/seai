import { randomUUID } from 'node:crypto';
import { getTool } from './tools.js';
import { evaluatePolicy, isHighRiskArgs } from '../policy/autonomy.js';
import { validateToolArgs, sanitizeForModel, assertNoSecretsInResponse } from '../security/validate.js';
import { isScopeError } from '../shopify/permissions.js';
import { db } from '../db/db.js';
import { config } from '../config.js';
import * as S from '../shopify/services.js';
import { Experiments } from '../experiments/engine.js';
import { Strategies } from '../stores/strategies.js';
import { portfolioRollup } from '../portfolio/intelligence.js';

export interface ExecCtx {
  shop: string;
  storeId: string;
  runId: string;
  confirmed?: boolean;
  accessToken?: string;
}

/** Execute one validated, policy-gated tool call. Model → policy → Shopify. */
export async function executeTool(toolName: string, rawArgs: unknown, ctx: ExecCtx): Promise<{ ok: boolean; result?: unknown; error?: string; policyDecision: string }> {
  const def = getTool(toolName);
  const started = Date.now();
  const fail = async (error: string, policyDecision = 'allow') => {
    try {
      await db.insert('tool_calls', { id: randomUUID(), run_id: ctx.runId, store_id: ctx.storeId, tool: toolName, args: JSON.stringify(rawArgs ?? {}), result: JSON.stringify({ error }), ok: false, policy_decision: policyDecision, duration_ms: Date.now() - started, created_at: new Date().toISOString() });
    } catch { /* ignore */ }
    return { ok: false as const, error, policyDecision };
  };
  if (!def) return fail(`unknown tool ${toolName}`, 'deny');

  const v = validateToolArgs(toolName, rawArgs);
  if (!v.ok) return fail(v.error!, 'deny');
  const args = v.value!;

  // Dynamic risk escalation (e.g. 50% discount) then policy gate
  let risk = def.riskLevel;
  if (!def.requiresConfirmation && (args as any).percent >= 30) risk = 'high';
  else if (def.riskLevel !== 'low') {
    const esc = isHighRiskArgs(toolName, args);
    if (esc.risk === 'high' || esc.risk === 'critical') risk = esc.risk;
  }
  const verdict = evaluatePolicy(toolName, risk, { reversible: def.reversible, confirmed: ctx.confirmed, autonomyLevel: config.autonomyLevel });
  if (!verdict.allowed) {
    try {
      await db.insert('tool_calls', { id: randomUUID(), run_id: ctx.runId, store_id: ctx.storeId, tool: toolName, args: JSON.stringify(args), result: JSON.stringify({ blocked: verdict.reason }), ok: false, policy_decision: verdict.decision, duration_ms: Date.now() - started, created_at: new Date().toISOString() });
    } catch { /* ignore */ }
    return { ok: false, error: `blocked by policy: ${verdict.reason}`, policyDecision: verdict.decision };
  }

  try {
    const at = ctx.accessToken;
    let result: unknown;
    switch (toolName) {
      case 'store.get': result = await S.ShopService.getStore(ctx.shop, at); break;
      case 'products.list': result = await S.ProductService.getProducts(ctx.shop, args.limit, at); break;
      case 'products.get': result = await S.ProductService.getProduct(ctx.shop, args.id, at); break;
      case 'products.create': result = await S.ProductService.createProduct(ctx.shop, args as any, at); break;
      case 'products.update': result = await S.ProductService.updateProduct(ctx.shop, args.id, args, at); break;
      case 'products.archive': result = await S.ProductService.archiveProduct(ctx.shop, args.id, at); break;
      case 'inventory.get': result = await S.InventoryService.getInventory(ctx.shop, args.limit, at); break;
      case 'inventory.update': result = await S.InventoryService.updateInventory(ctx.shop, args.inventoryItemId, args.locationId, args.availableDelta, at); break;
      case 'orders.list': result = await S.OrderService.getOrders(ctx.shop, args.limit, at); break;
      case 'orders.get': result = await S.OrderService.getOrder(ctx.shop, args.id, at); break;
      case 'customers.list': result = await S.CustomerService.getCustomers(ctx.shop, args.limit, at); break;
      case 'customers.get': result = await S.CustomerService.getCustomer(ctx.shop, args.id, at); break;
      case 'discounts.list': result = await S.DiscountService.getDiscounts(ctx.shop, at); break;
      case 'discounts.create': result = await S.DiscountService.createDiscount(ctx.shop, args as any, at); break;
      case 'discounts.disable': result = await S.DiscountService.disableDiscount(ctx.shop, args.id, at); break;
      case 'collections.list': result = await S.CollectionService.getCollections(ctx.shop, at); break;
      case 'collections.create': result = await S.CollectionService.createCollection(ctx.shop, args as any, at); break;
      case 'collections.addProducts': result = await S.CollectionService.addProducts(ctx.shop, args.collectionId, args.productIds, at); break;
      case 'collections.update': result = await S.CollectionService.updateCollection(ctx.shop, args.id, args, at); break;
      case 'content.list': result = await S.ContentService.getPages(ctx.shop, at); break;
      case 'content.create': result = await S.ContentService.createPage(ctx.shop, args as any, at); break;
      case 'content.update': result = await S.ContentService.updatePage(ctx.shop, args.id, args, at); break;
      case 'analytics.get': result = await S.AnalyticsService.getAnalytics(ctx.shop, at); break;
      case 'experiments.create': result = await Experiments.create(ctx.storeId, { hypothesis: args.hypothesis, metric: args.metric, variant: args.variant, control: args.control, rollbackPlan: args.rollbackPlan }); break;
      case 'experiments.evaluate': result = await Experiments.evaluate(ctx.storeId, args.id, { metric: 'manual', value: 0 }); break;
      case 'experiments.rollback': result = await Experiments.rollback(ctx.storeId, args.id); break;
      case 'themes.get': result = await S.ThemeService.getThemes(ctx.shop, at); break;
      case 'themes.upload': result = await S.ThemeService.upsertFile(ctx.shop, args.themeId, args.filename, args.value, at); break;
      case 'policies.update': result = await S.PoliciesService.updatePolicy(ctx.shop, args.type, args.body, at); break;
      case 'inventory.ensure': result = await S.InventoryService.ensureStocked(ctx.shop, args.productId, args.quantity, at); break;
      case 'strategy.propose': result = await Strategies.propose(ctx.storeId, args as any, ctx.runId); break;
      case 'strategy.get': result = await Strategies.get(ctx.storeId); break;
      case 'portfolio.get': result = await portfolioRollup(); break;
      default: return fail(`no handler for ${toolName}`, 'deny');
    }
    assertNoSecretsInResponse(result);
    const safe = sanitizeForModel(result);
    try {
      await db.insert('tool_calls', { id: randomUUID(), run_id: ctx.runId, store_id: ctx.storeId, tool: toolName, args: JSON.stringify(args), result: JSON.stringify(safe ?? null).slice(0, 20000), ok: true, policy_decision: verdict.decision, duration_ms: Date.now() - started, created_at: new Date().toISOString() });
    } catch { /* ignore */ }
    return { ok: true, result: safe, policyDecision: verdict.decision };
  } catch (e: any) {
    const msg = e?.message?.slice(0, 1000) ?? 'tool failed';
    // Protected-scope denials are reported as missing capability — never misread as success or retried blindly
    const annotated = isScopeError(msg) ? `${msg} [capability unavailable: Shopify denied the required scope — continuing with available capabilities]` : msg;
    return fail(annotated, verdict.decision);
  }
}
