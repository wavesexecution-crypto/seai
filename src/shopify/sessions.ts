import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/db.js';

function encKey(): Buffer {
  const raw = config.encryptionKey;
  if (!raw) {
    // Dev-only deterministic key; production must set SEAI_ENCRYPTION_KEY
    return createHash('sha256').update('seai-dev-only-key').digest();
  }
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length >= 32) return b.subarray(0, 32);
  } catch { /* fallthrough */ }
  return createHash('sha256').update(raw).digest();
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${ct.toString('base64')}.${c.getAuthTag().toString('base64')}`;
}

export function decryptToken(enc: string): string {
  const [ivs, cts, tags] = enc.split('.');
  const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivs, 'base64'));
  d.setAuthTag(Buffer.from(tags, 'base64'));
  return Buffer.concat([d.update(Buffer.from(cts, 'base64')), d.final()]).toString('utf8');
}

export async function saveSession(shop: string, accessToken: string, scope: string, isOnline = false): Promise<void> {
  const row = {
    id: `${shop}:${isOnline ? 'online' : 'offline'}`,
    shop, access_token_enc: encryptToken(accessToken), scope, is_online: isOnline,
    updated_at: new Date().toISOString(),
  };
  try {
    const ex = await db.list('shopify_sessions', { id: row.id } as any, 1);
    if (ex[0]) await db.update('shopify_sessions', row.id, row);
    else await db.insert('shopify_sessions', { ...row, created_at: new Date().toISOString() });
  } catch { /* memory driver path handled by insert/update above */ }
}

export async function getAccessToken(shop: string): Promise<string | null> {
  try {
    const rows = await db.list('shopify_sessions', { shop } as any, 5);
    const off = rows.find((r) => r.is_online === false) ?? rows[0];
    if (!off?.access_token_enc) return null;
    return decryptToken(off.access_token_enc);
  } catch {
    return null;
  }
}

export async function listConnectedShops(): Promise<string[]> {
  try {
    const rows = await db.list('shopify_sessions', {}, 50);
    return [...new Set(rows.map((r) => r.shop))];
  } catch {
    return [];
  }
}
