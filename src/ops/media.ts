import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const mediaRouter = Router();
mediaRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'marketing', 'designer', 'developer'));

const mediaSchema = z.object({
  kind: z.enum(['image', 'video', 'document']),
  filename: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(100),
  size_bytes: z.coerce.number().min(0),
  storage_url: z.string().trim().min(1).max(2000),
  source_type: z.enum(['upload', 'external', 'platform']).default('external'),
  source_id: z.string().trim().optional().or(z.literal('')),
  alt_text: z.string().trim().max(500).optional(),
  width: z.coerce.number().min(0).optional(),
  height: z.coerce.number().min(0).optional(),
  duration_seconds: z.coerce.number().min(0).optional(),
});

// GET /api/ops/media/assets - List media assets
mediaRouter.get('/assets', async (req: Request, res: Response) => {
  const { kind, source_type } = req.query;
  let rows = await db.list('media_assets', {}, 10000);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (source_type) rows = rows.filter((r) => r.source_type === source_type);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, assets: rows.slice(0, 500), total: rows.length });
});

// GET /api/ops/media/assets/:id - Get a single media asset
mediaRouter.get('/assets/:id', async (req: Request, res: Response) => {
  const asset = (await db.list('media_assets', { id: req.params.id }, 1))[0];
  if (!asset) { res.status(404).json({ ok: false, error: 'Media asset not found' }); return; }
  res.json({ ok: true, asset });
});

// POST /api/ops/media/assets - Register a media asset
mediaRouter.post('/assets', async (req: Request, res: Response) => {
  const parsed = mediaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid media asset' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('media_assets', {
    id,
    kind: d.kind,
    filename: d.filename,
    mime_type: d.mime_type,
    size_bytes: d.size_bytes,
    storage_url: d.storage_url,
    source_type: d.source_type,
    source_id: d.source_id || null,
    alt_text: d.alt_text || null,
    width: d.width || null,
    height: d.height || null,
    duration_seconds: d.duration_seconds || null,
    created_by: req.user!.id,
    created_at: now(),
    updated_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/media/assets/:id - Update media asset metadata
mediaRouter.patch('/assets/:id', async (req: Request, res: Response) => {
  const asset = (await db.list('media_assets', { id: req.params.id }, 1))[0];
  if (!asset) { res.status(404).json({ ok: false, error: 'Media asset not found' }); return; }
  const allowed = ['filename', 'alt_text', 'width', 'height', 'duration_seconds', 'source_id'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) patch[k] = req.body[k] === '' ? null : req.body[k];
  }
  patch.updated_at = now();
  await db.update('media_assets', req.params.id, patch);
  res.json({ ok: true });
});

// DELETE /api/ops/media/assets/:id - Delete media asset record
mediaRouter.delete('/assets/:id', async (req: Request, res: Response) => {
  const asset = (await db.list('media_assets', { id: req.params.id }, 1))[0];
  if (!asset) { res.status(404).json({ ok: false, error: 'Media asset not found' }); return; }
  await db.deleteWhere('media_assets', { id: req.params.id });
  res.json({ ok: true });
});
