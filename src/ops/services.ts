import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole, staffOnly } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const servicesRouter = Router();
servicesRouter.use(staffOnly);

const serviceSchema = z.object({
  key: z.string().trim().min(2).max(40),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  pricing_model: z.enum(['one_time', 'recurring', 'retainer']),
  base_price_inr: z.coerce.number().min(0),
  currency: z.string().trim().min(1).max(10).default('INR'),
  packages: z.array(z.any()).optional(),
  deliverables: z.array(z.string()).optional(),
  estimated_delivery_days: z.coerce.number().min(0).optional(),
  is_recurring: z.boolean().optional(),
  is_active: z.boolean().optional(),
  requires_approval: z.boolean().optional(),
});

// GET /api/ops/services
servicesRouter.get('/', staffOnly, async (_req: Request, res: Response) => {
  const rows = await db.list('services', {}, 1000);
  rows.sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
  res.json({ ok: true, services: rows });
});

// GET /api/ops/services/:id
servicesRouter.get('/:id', staffOnly, async (req: Request, res: Response) => {
  const row = (await db.list('services', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Service not found' }); return; }
  res.json({ ok: true, service: row });
});

// POST /api/ops/services
servicesRouter.post('/', requireStaffRole('owner', 'administrator', 'admin', 'marketing'), async (req: Request, res: Response) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid service' }); return; }
  const d = parsed.data;
  const id = `svc_${randomUUID().slice(0, 8)}`;
  await db.insert('services', {
    id, key: d.key, label: d.label, description: d.description ?? '',
    pricing_model: d.pricing_model, base_price_inr: d.base_price_inr, currency: d.currency,
    packages: d.packages ? JSON.stringify(d.packages) : '[]',
    deliverables: d.deliverables ? JSON.stringify(d.deliverables) : '[]',
    estimated_delivery_days: d.estimated_delivery_days ?? null,
    is_recurring: d.is_recurring ?? d.pricing_model === 'recurring',
    is_active: d.is_active ?? true,
    requires_approval: d.requires_approval ?? false,
    created_by: req.user!.id,
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/services/:id
servicesRouter.patch('/:id', requireStaffRole('owner', 'administrator', 'admin', 'marketing'), async (req: Request, res: Response) => {
  const existing = (await db.list('services', { id: req.params.id }, 1))[0];
  if (!existing) { res.status(404).json({ ok: false, error: 'Service not found' }); return; }
  const allowed = ['key', 'label', 'description', 'pricing_model', 'base_price_inr', 'currency', 'packages', 'deliverables', 'estimated_delivery_days', 'is_recurring', 'is_active', 'requires_approval'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (['packages', 'deliverables'].includes(k)) patch[k] = JSON.stringify(req.body[k]);
      else patch[k] = req.body[k];
    }
  }
  patch.updated_at = now();
  await db.update('services', req.params.id, patch);
  res.json({ ok: true });
});

// DELETE /api/ops/services/:id
servicesRouter.delete('/:id', requireStaffRole('owner', 'administrator', 'admin'), async (req: Request, res: Response) => {
  await db.deleteWhere('services', { id: req.params.id });
  res.json({ ok: true });
});


