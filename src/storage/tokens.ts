import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/db.js';

// Mints short-lived HS256 storage tokens per docs/INTEGRATION_CONTRACT_FINAL.md
// (§1) inside seai.storage. Server-side only: fed by the validated CDF session,
// never by browser input. Used for direct browser→storage calls that need user
// scope (e.g. byte PUT on memory/local providers); primary flows use the
// service-auth proxy in router.ts instead.
export interface StorageToken {
  token: string;
  expiresAt: string;
  websiteIds: string[];
}

export async function mintStorageToken(userId: string): Promise<StorageToken> {
  const secret = config.storageJwtSecret;
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error('Storage tokens are not configured'), { statusCode: 503 });
  }
  const sites = await db.list('customer_websites', { user_id: userId }, 1);
  const websiteIds = sites[0] ? [String(sites[0].id)] : [];
  const ttl = Math.min(Math.max(config.storageTokenTtlSec, 60), 900);
  const token = jwt.sign({ websiteIds }, secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: ttl,
  });
  return { token, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), websiteIds };
}
