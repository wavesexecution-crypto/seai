import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const campaignsRouter = Router();
campaignsRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'marketing'));

const campaignSchema = z.object({
  integration_id: z.string().trim().optional().or(z.literal('')),
  platform: z.enum(['meta', 'google']),
  name: z.string().trim().min(2).max(200),
  objective: z.string().trim().min(2).max(200),
  budget_total_inr: z.coerce.number().min(0).default(0),
  budget_daily_inr: z.coerce.number().min(0).optional(),
  currency: z.string().trim().min(1).max(10).default('INR'),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  targeting: z.record(z.any()).optional(),
  approval_required: z.boolean().default(true),
});

const creativeSchema = z.object({
  campaign_id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  type: z.enum(['image', 'video', 'carousel', 'text']).default('image'),
  media_urls: z.array(z.any()).optional(),
  headline: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional(),
  call_to_action: z.string().trim().max(100).optional(),
});

// GET /api/ops/marketing/campaigns
campaignsRouter.get('/campaigns', async (req: Request, res: Response) => {
  const { status, platform } = req.query;
  let rows = await db.list('marketing_campaigns', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (platform) rows = rows.filter((r) => r.platform === platform);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, campaigns: rows });
});

// GET /api/ops/marketing/campaigns/:id
campaignsRouter.get('/campaigns/:id', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  const creatives = await db.list('campaign_creatives', { campaign_id: campaign.id }, 200);
  res.json({ ok: true, campaign, creatives });
});

// POST /api/ops/marketing/campaigns
campaignsRouter.post('/campaigns', async (req: Request, res: Response) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid campaign' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  const status = d.approval_required ? 'pending_approval' : 'draft';
  await db.insert('marketing_campaigns', {
    id, integration_id: d.integration_id || null, platform: d.platform,
    name: d.name, objective: d.objective, status,
    budget_total_inr: d.budget_total_inr, budget_daily_inr: d.budget_daily_inr || null,
    budget_spent_inr: 0, currency: d.currency,
    start_date: d.start_date || null, end_date: d.end_date || null,
    targeting: d.targeting ? JSON.stringify(d.targeting) : '{}',
    approval_required: Boolean(d.approval_required),
    created_by: req.user!.id,
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id, status });
});

// PATCH /api/ops/marketing/campaigns/:id
campaignsRouter.patch('/campaigns/:id', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  const allowed = ['name', 'objective', 'status', 'budget_total_inr', 'budget_daily_inr', 'start_date', 'end_date', 'targeting', 'approval_required'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (k === 'targeting') patch[k] = JSON.stringify(req.body[k]);
      else patch[k] = req.body[k];
    }
  }
  if ('status' in patch) {
    const s = String(patch.status);
    if (!['draft', 'pending_approval', 'approved', 'active', 'paused', 'completed', 'cancelled'].includes(s)) {
      res.status(400).json({ ok: false, error: 'Invalid status' }); return;
    }
    if (s === 'approved') patch.approved_by = req.user!.id;
    if (s === 'approved') patch.approved_at = now();
  }
  patch.updated_at = now();
  await db.update('marketing_campaigns', req.params.id, patch);
  res.json({ ok: true });
});

// POST /api/ops/marketing/campaigns/:id/approve
campaignsRouter.post('/campaigns/:id/approve', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  await db.update('marketing_campaigns', req.params.id, {
    status: 'approved', approved_by: req.user!.id, approved_at: now(), updated_at: now(),
  });
  res.json({ ok: true, status: 'approved' });
});

// POST /api/ops/marketing/campaigns/:id/launch
campaignsRouter.post('/campaigns/:id/launch', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  if (campaign.status !== 'approved') { res.status(400).json({ ok: false, error: 'Campaign must be approved before launch' }); return; }
  await db.update('marketing_campaigns', req.params.id, { status: 'active', updated_at: now() });
  res.json({ ok: true, status: 'active' });
});

// GET /api/ops/marketing/creatives
campaignsRouter.get('/creatives', async (req: Request, res: Response) => {
  const { campaign_id } = req.query;
  let rows = await db.list('campaign_creatives', {}, 10000);
  if (campaign_id) rows = rows.filter((r) => r.campaign_id === campaign_id);
  res.json({ ok: true, creatives: rows });
});

// POST /api/ops/marketing/creatives
campaignsRouter.post('/creatives', async (req: Request, res: Response) => {
  const parsed = creativeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid creative' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('campaign_creatives', {
    id, campaign_id: d.campaign_id, name: d.name, type: d.type,
    media_urls: d.media_urls ? JSON.stringify(d.media_urls) : '[]',
    headline: d.headline || null, description: d.description || null,
    call_to_action: d.call_to_action || null, status: 'draft',
    spend_inr: 0, impressions: null, clicks: null,
    created_by: req.user!.id,
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/marketing/creatives/:id
campaignsRouter.patch('/creatives/:id', async (req: Request, res: Response) => {
  const creative = (await db.list('campaign_creatives', { id: req.params.id }, 1))[0];
  if (!creative) { res.status(404).json({ ok: false, error: 'Creative not found' }); return; }
  const allowed = ['name', 'type', 'media_urls', 'headline', 'description', 'call_to_action', 'status'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (k === 'media_urls') patch[k] = JSON.stringify(req.body[k]);
      else patch[k] = req.body[k];
    }
  }
  patch.updated_at = now();
  await db.update('campaign_creatives', req.params.id, patch);
  res.json({ ok: true });
});
