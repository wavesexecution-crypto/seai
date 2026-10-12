import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { storage, storageErrorMessage, type TenantScope } from './client.js';
import { mintStorageToken } from './tokens.js';

// CDF storage proxy. Every route is session-authenticated; tenant scope is
// re-derived server-side from req.user on each call. Browser input is never
// trusted for customerId/websiteId. Service credentials live in client.ts.
export const storageRouter = Router();
storageRouter.use(requireAuth);

const SEAI_CATEGORIES = [
  'logo',
  'image',
  'brand_asset',
  'intake_attachment',
  'document',
  'website_asset',
  'generated_asset',
] as const;

function uid(req: Request): string {
  return req.user!.id;
}

// --- per-user rate limiting (storage also limits per service key) ---
const buckets = new Map<string, number[]>();
function checkLimit(userId: string, group: 'uploads' | 'downloads', res: Response): boolean {
  const max = group === 'uploads' ? 30 : 120;
  const now = Date.now();
  const key = `${group}:${userId}`;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= max) {
    res.status(429).json({ ok: false, error: 'Too many requests — please try again shortly' });
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
export function __resetStorageRateLimits(): void {
  buckets.clear();
}

// Storage outages/transport failures must surface as safe 503s, never as
// unhandled rejections or provider internals.
function storageFailure(res: Response): void {
  res.status(503).json({ ok: false, error: 'Storage unavailable' });
}

async function ownedWebsiteId(userId: string, websiteId?: string | null): Promise<string | null> {
  if (websiteId) {
    const rows = await db.list('customer_websites', { id: websiteId, user_id: userId }, 1);
    if (!rows[0]) {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    }
    return websiteId;
  }
  const rows = await db.list('customer_websites', { user_id: userId }, 1);
  return rows[0] ? String(rows[0].id) : null;
}

function scopeFor(userId: string, websiteId: string | null): TenantScope {
  return websiteId ? { customerId: userId, websiteId } : { customerId: userId };
}

async function ownedFile(userId: string, fileId: string): Promise<Record<string, any> | null> {
  const rows = await db.list('customer_files', { user_id: userId, storage_file_id: fileId }, 1);
  const row = rows[0];
  if (!row || row.status === 'DELETED') return null;
  return row;
}

async function recordFile(
  userId: string,
  websiteId: string | null,
  object: Record<string, any>,
  requestId?: string | null,
): Promise<Record<string, any>> {
  const now = new Date().toISOString();
  return db.insert('customer_files', {
    id: randomUUID(),
    user_id: userId,
    website_id: websiteId,
    storage_file_id: String(object.id),
    request_id: requestId ?? null,
    category: object.category ?? 'other',
    filename: object.originalFilename ?? '',
    status: object.status ?? 'UPLOADING',
    intake_order_ref: null,
    created_at: now,
    updated_at: now,
  });
}

// POST /api/storage/token — short-lived user JWT for direct storage calls
storageRouter.post('/token', async (req: Request, res: Response) => {
  try {
    const t = await mintStorageToken(uid(req));
    res.json({ ok: true, ...t });
  } catch (err: any) {
    res.status(err?.statusCode ?? 500).json({ ok: false, error: err?.statusCode ? err.message : 'Storage unavailable' });
  }
});

// POST /api/storage/uploads — initiate (service auth + on-behalf-of)
const initiateSchema = z.object({
  websiteId: z.string().min(1).max(128).nullable().optional(),
  originalFilename: z.string().min(1).max(253),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
  category: z.enum(SEAI_CATEGORIES),
});

storageRouter.post('/uploads', async (req: Request, res: Response) => {
  const userId = uid(req);
  if (!checkLimit(userId, 'uploads', res)) return;
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  if (parsed.data.sizeBytes > config.storageProxyMaxBytes) {
    res.status(413).json({ ok: false, error: `File exceeds proxy limit of ${config.storageProxyMaxBytes} bytes` });
    return;
  }
  let websiteId: string | null;
  try {
    websiteId = await ownedWebsiteId(userId, parsed.data.websiteId ?? null);
  } catch (err: any) {
    res.status(err?.statusCode ?? 404).json({ ok: false, error: 'Not found' });
    return;
  }
  // NOTE: customerId is always the session user — any browser-supplied value
  // is dropped here and never forwarded.
  const scope = scopeFor(userId, websiteId);
  let result;
  try {
    result = await storage.initiateUpload(scope, {
      websiteId,
      originalFilename: parsed.data.originalFilename,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      checksumSha256: parsed.data.checksumSha256 ?? null,
      category: parsed.data.category,
      customerId: userId,
    });
  } catch {
    storageFailure(res);
    return;
  }
  if (result.status !== 201) {
    res.status(result.status).json({ ok: false, error: storageErrorMessage(result, 'Storage unavailable') });
    return;
  }
  const file = await recordFile(userId, websiteId, result.body.object);
  const direct = await mintStorageToken(userId).catch(() => null);
  res.status(201).json({
    ok: true,
    file,
    upload: {
      uploadUrl: result.body.uploadUrl,
      expiresAt: result.body.expiresAt,
      uploadSessionId: result.body.uploadSessionId,
    },
    directToken: direct?.token ?? null,
    directTokenExpiresAt: direct?.expiresAt ?? null,
  });
});

// PUT /api/storage/uploads/:id/bytes — same-origin byte relay for small files
// (Modify attachments, ≤5MB). Large/production flows use the signed uploadUrl
// or directToken instead so bytes never transit this server.
storageRouter.put(
  '/uploads/:id/bytes',
  express.raw({ type: '*/*', limit: '6mb' }),
  async (req: Request, res: Response) => {
    const userId = uid(req);
    const mapping = await ownedFile(userId, req.params.id);
    if (!mapping) {
      res.status(404).json({ ok: false, error: 'Not found' });
      return;
    }
    const bytes = req.body as Buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      res.status(400).json({ ok: false, error: 'Empty upload' });
      return;
    }
    try {
      const result = await storage.putBytes(
        scopeFor(userId, mapping.website_id),
        mapping.storage_file_id,
        bytes,
        'application/octet-stream',
      );
      if (result.status !== 200) {
        res.status(502).json({ ok: false, error: 'Could not transfer file' });
        return;
      }
      res.json({ ok: true, receivedBytes: bytes.length });
    } catch {
      storageFailure(res);
    }
  },
);

// POST /api/storage/uploads/:id/complete
storageRouter.post('/uploads/:id/complete', async (req: Request, res: Response) => {
  const userId = uid(req);
  const mapping = await ownedFile(userId, req.params.id);
  if (!mapping) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  let result;
  try {
    result = await storage.completeUpload(scopeFor(userId, mapping.website_id), mapping.storage_file_id);
  } catch {
    storageFailure(res);
    return;
  }
  if (result.status !== 200) {
    res.status(result.status).json({ ok: false, error: storageErrorMessage(result, 'Storage unavailable') });
    return;
  }
  await db.update('customer_files', mapping.id, { status: result.body.object.status, updated_at: new Date().toISOString() });
  res.json({ ok: true, file: { ...mapping, status: result.body.object.status }, object: result.body.object });
});

// GET /api/storage/files[?websiteId=] — list from CDF mapping (no bucket scan)
storageRouter.get('/files', async (req: Request, res: Response) => {
  const userId = uid(req);
  const websiteId = typeof req.query.websiteId === 'string' ? req.query.websiteId : undefined;
  try {
    if (websiteId) await ownedWebsiteId(userId, websiteId);
  } catch {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  const where: Record<string, unknown> = { user_id: userId };
  if (websiteId) where.website_id = websiteId;
  const rows = await db.list('customer_files', where, 200);
  const files = rows.filter((r) => r.status !== 'DELETED');
  res.json({ ok: true, files });
});

// GET /api/storage/files/:id — live metadata (ownership via mapping table)
storageRouter.get('/files/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const mapping = await ownedFile(userId, req.params.id);
  if (!mapping) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  let result;
  try {
    result = await storage.getFile(scopeFor(userId, mapping.website_id), mapping.storage_file_id);
  } catch {
    storageFailure(res);
    return;
  }
  if (result.status !== 200) {
    res.status(result.status).json({ ok: false, error: storageErrorMessage(result, 'Storage unavailable') });
    return;
  }
  res.json({ ok: true, file: mapping, object: result.body.file });
});

// GET /api/storage/files/:id/download — short-lived signed URL, never permanent
storageRouter.get('/files/:id/download', async (req: Request, res: Response) => {
  const userId = uid(req);
  if (!checkLimit(userId, 'downloads', res)) return;
  const mapping = await ownedFile(userId, req.params.id);
  if (!mapping) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  let result;
  try {
    result = await storage.downloadUrl(scopeFor(userId, mapping.website_id), mapping.storage_file_id);
  } catch {
    storageFailure(res);
    return;
  }
  if (result.status !== 200) {
    res.status(result.status).json({ ok: false, error: storageErrorMessage(result, 'Storage unavailable') });
    return;
  }
  res.json({
    ok: true,
    downloadUrl: result.body.downloadUrl,
    expiresAt: result.body.expiresAt,
    mimeType: result.body.mimeType,
  });
});

// DELETE /api/storage/files/:id — soft delete
storageRouter.delete('/files/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const mapping = await ownedFile(userId, req.params.id);
  if (!mapping) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  let result;
  try {
    result = await storage.removeFile(scopeFor(userId, mapping.website_id), mapping.storage_file_id);
  } catch {
    storageFailure(res);
    return;
  }
  if (result.status !== 200) {
    res.status(result.status).json({ ok: false, error: storageErrorMessage(result, 'Storage unavailable') });
    return;
  }
  await db.update('customer_files', mapping.id, { status: 'DELETED', updated_at: new Date().toISOString() });
  res.json({ ok: true, deleted: true });
});

// POST /api/storage/files/:id/publish | /unpublish — explicit visibility only
for (const action of ['publish', 'unpublish'] as const) {
  storageRouter.post(`/files/:id/${action}`, async (req: Request, res: Response) => {
    const userId = uid(req);
    const mapping = await ownedFile(userId, req.params.id);
    if (!mapping) {
      res.status(404).json({ ok: false, error: 'Not found' });
      return;
    }
    let result;
    try {
      result =
        action === 'publish'
          ? await storage.publishFile(scopeFor(userId, mapping.website_id), mapping.storage_file_id)
          : await storage.unpublishFile(scopeFor(userId, mapping.website_id), mapping.storage_file_id);
    } catch {
      storageFailure(res);
      return;
    }
    if (result.status !== 200) {
      res.status(result.status).json({ ok: false, error: storageErrorMessage(result, 'Storage unavailable') });
      return;
    }
    res.json({ ok: true, file: result.body.file });
  });
}
