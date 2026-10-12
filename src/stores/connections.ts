import { db } from '../db/db.js';
import { getAccessToken } from '../shopify/sessions.js';
import { ShopService } from '../shopify/services.js';

// Separate concepts, separate types:
//   storeSlot    — a portfolio slot (Store 01..06). NOT a store until bound+connected.
//   shopifyStore — a real shop identity (name + myshopify domain) from Shopify.
//   connection   — an OAuth session proving access. ONLY sessions make a store connected.
//   activeStore  — the connection the operator is currently working in.
export interface ShopIdentity {
  shop: string;
  name: string;
}

export interface Connection {
  shop: string;
  name: string;
  connectedAt: string | null;
}

/** Strict shop normalization. Admin/settings/callback URLs are NEVER identity — returns null for them. */
export function normalizeShop(input: unknown): string | null {
  const s = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (!s || s.includes('admin.shopify.com')) return null;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

/** Connected stores = shops with an OAuth session. Nothing else qualifies. */
export async function listConnections(): Promise<Connection[]> {
  let sessions: any[] = [];
  try { sessions = await db.list('shopify_sessions', {}, 100); } catch { return []; }
  const offline = sessions.filter((s) => s.shop && !s.is_online);
  const byShop = new Map<string, any>();
  for (const s of offline) if (!byShop.has(s.shop)) byShop.set(s.shop, s);
  let names = new Map<string, string>();
  try {
    const rows = await db.list('stores', {}, 100);
    for (const r of rows) if (r.shop_domain && r.shop_name) names.set(r.shop_domain, r.shop_name);
  } catch { /* ignore */ }
  return [...byShop.entries()].map(([shop, s]) => ({
    shop,
    name: names.get(shop) ?? shop,
    connectedAt: s.updated_at ?? s.created_at ?? null,
  }));
}

/** Harmless authenticated read. Proves the session works before any agent run. */
export async function verifyConnection(shop: string): Promise<{ ok: boolean; identity?: ShopIdentity; error?: string }> {
  const clean = normalizeShop(shop);
  if (!clean) return { ok: false, error: 'not a valid myshopify.com store domain' };
  const token = await getAccessToken(clean);
  if (!token) return { ok: false, error: 'Connect a Shopify store before running this command.' };
  try {
    const info: any = await ShopService.getStore(clean, token);
    if (!info || !info.myshopifyDomain) return { ok: false, error: 'Shopify did not return a verifiable shop identity' };
    return { ok: true, identity: { shop: info.myshopifyDomain, name: info.name ?? info.myshopifyDomain } };
  } catch (e: any) {
    return { ok: false, error: `Shopify session check failed: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

/** Persist a VERIFIED identity only. Never call with unverified data. */
export async function recordConnection(identity: ShopIdentity): Promise<void> {
  try {
    const ex = await db.list('stores', { shop_domain: identity.shop } as any, 1);
    const row = { shop_name: identity.name, updated_at: new Date().toISOString() };
    if (ex[0]) await db.update('stores', ex[0].id, row);
    else {
      await db.insert('stores', {
        id: identity.shop, shop_domain: identity.shop, shop_name: identity.name,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
  } catch { /* ignore */ }
}
