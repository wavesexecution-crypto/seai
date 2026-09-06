import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/db.js';

export function verifyWebhook(rawBody: Buffer, hmacHeader: string): boolean {
  const secret = config.shopify.apiSecret;
  if (!secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader ?? ''));
  } catch { return false; }
}

/** Enqueue webhook work — never block the webhook response. */
export async function enqueueEvent(shop: string, topic: string, payload: unknown): Promise<string> {
  const id = randomUUID();
  try {
    await db.insert('events', {
      id, store_id: null, shop, topic, payload: JSON.stringify(payload ?? {}).slice(0, 20000),
      status: 'queued', created_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }
  // async drain (best-effort)
  setImmediate(() => drainEvent(id).catch(() => undefined));
  return id;
}

async function drainEvent(id: string): Promise<void> {
  try {
    const rows = await db.list('events', { id } as any, 1);
    if (!rows[0]) return;
    await db.update('events', id, { status: 'processed', processed_at: new Date().toISOString() });
  } catch { /* ignore */ }
}
