import { db } from '../db/db.js';

// Six neutral store slots. No niche, industry, or identity is predetermined —
// each slot is a blank canvas until a shop is bound and SEAI forms a strategy.
// Slots bind to shops via STORE_<n>_SHOP env or the assign API (DB override wins).
export const MAX_SLOTS = 6;

export type SlotStatus = 'available' | 'assigned' | 'connected';

export interface StoreSlot {
  slot: number;
  label: string;
  shop: string | null;
  status: SlotStatus;
}

export function slotLabel(slot: number): string {
  return `Store ${String(slot).padStart(2, '0')}`;
}

export async function listSlots(): Promise<StoreSlot[]> {
  let overrides: Record<number, string> = {};
  try {
    const rows = await db.list('store_slots', {}, 10);
    for (const r of rows) if (r.shop) overrides[r.slot] = r.shop;
  } catch { /* ignore */ }
  const connected = new Set<string>();
  try {
    const sessions = await db.list('shopify_sessions', {}, 100);
    for (const s of sessions) if (s.shop && !s.is_online) connected.add(s.shop);
  } catch { /* ignore */ }
  const out: StoreSlot[] = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const envShop = (process.env[`STORE_${slot}_SHOP`] || '').trim();
    const shop = overrides[slot] ?? (envShop || null);
    // A slot is "connected" ONLY when a live OAuth session exists for its shop.
    // Bound without session = assigned. No shop = available. Never anything else.
    const status: SlotStatus = shop && connected.has(shop) ? 'connected' : shop ? 'assigned' : 'available';
    out.push({ slot, label: slotLabel(slot), shop, status });
  }
  return out;
}

/** Bind a shop domain to a slot. Rejects unknown slots and double-binding. */
export async function assignSlot(slot: number, shop: string): Promise<StoreSlot> {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) throw new Error(`slot must be 1–${MAX_SLOTS}`);
  const clean = shop.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(clean)) throw new Error('shop must be a *.myshopify.com domain');
  const slots = await listSlots();
  const clash = slots.find((s) => s.shop === clean && s.slot !== slot);
  if (clash) throw new Error(`${clean} is already bound to ${clash.label}`);
  try {
    const ex = await db.list('store_slots', { slot } as any, 1);
    const row = { slot, shop: clean, updated_at: new Date().toISOString() };
    if (ex[0]) await db.update('store_slots', String(slot), row as any);
    else await db.insert('store_slots', { id: String(slot), ...row });
    try {
      const st = await db.list('stores', { shop_domain: clean } as any, 1);
      if (st[0]) await db.update('stores', st[0].id, { slot, label: slotLabel(slot) });
      else await db.insert('stores', { id: clean, shop_domain: clean, shop_name: clean, slot, label: slotLabel(slot), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    } catch { /* ignore */ }
  } catch (e: any) {
    throw new Error(`assign failed: ${e.message}`);
  }
  return (await listSlots()).find((s) => s.slot === slot)!;
}

/** Resolve a shop to its canonical store id. Strict: unknown shops map to themselves (isolated by construction). */
export function storeIdForShop(shop: string): string {
  return shop.trim().toLowerCase();
}

/** The slot (if any) a shop is bound to. */
export async function slotForShop(shop: string): Promise<StoreSlot | null> {
  const slots = await listSlots();
  return slots.find((s) => s.shop === shop.trim().toLowerCase()) ?? null;
}
