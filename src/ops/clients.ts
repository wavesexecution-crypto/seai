import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const clientsRouter = Router();
clientsRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'account_manager', 'sales', 'finance'));

const clientSchema = z.object({
  lead_id: z.string().trim().optional().or(z.literal('')),
  legal_name: z.string().trim().min(1).max(200),
  brand_name: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  address: z.string().trim().max(500).optional(),
  service_locations: z.string().trim().max(500).optional(),
  website: z.string().trim().max(300).optional(),
  social_links: z.record(z.string()).optional(),
  primary_contact: z.string().trim().max(160).optional(),
  designation: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  preferred_channel: z.enum(['whatsapp', 'phone', 'email']).optional(),
  decision_maker: z.string().trim().max(160).optional(),
  gstin: z.string().trim().max(30).optional(),
  billing_email: z.string().trim().email().max(200).optional().or(z.literal('')),
  account_manager_id: z.string().trim().max(64).optional(),
  status: z.enum(['onboarding', 'active', 'paused', 'cancelled']).optional(),
});

// GET /api/ops/clients
clientsRouter.get('/', async (req: Request, res: Response) => {
  const { q, status } = req.query;
  let rows = await db.list('clients', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (q) {
    const query = String(q).trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.brand_name, r.legal_name, r.email, r.phone, r.industry, r.primary_contact]
        .some((v) => String(v ?? '').toLowerCase().includes(query)));
  }
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, clients: rows });
});

// GET /api/ops/clients/:id
clientsRouter.get('/:id', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const [agreements, projects, invoices] = await Promise.all([
    db.list('service_agreements', { client_id: client.id }, 50),
    db.list('projects', { client_id: client.id }, 100),
    db.list('invoices', { client_id: client.id }, 100),
  ]);
  res.json({ ok: true, client, agreements, projects, invoices });
});

// POST /api/ops/clients
clientsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid client' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('clients', {
    id, lead_id: d.lead_id || null, legal_name: d.legal_name, brand_name: d.brand_name,
    industry: d.industry || null, description: d.description || null,
    address: d.address || null, service_locations: d.service_locations || null,
    website: d.website || null, social_links: d.social_links ? JSON.stringify(d.social_links) : null,
    primary_contact: d.primary_contact || null, designation: d.designation || null,
    email: d.email || null, phone: d.phone || null, preferred_channel: d.preferred_channel || null,
    decision_maker: d.decision_maker || null, gstin: d.gstin || null, billing_email: d.billing_email || null,
    account_manager_id: d.account_manager_id || null,
    status: d.status || 'onboarding',
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id });
});

// POST /api/ops/clients/convert/:leadId - Convert a won lead to a client
clientsRouter.post('/convert/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const lead = (await db.list('leads', { id: leadId }, 1))[0];
  if (!lead) { res.status(404).json({ ok: false, error: 'Lead not found' }); return; }
  if (lead.stage !== 'won') {
    await db.update('leads', leadId, { stage: 'won', updated_at: now() });
    await db.insert('lead_activities', {
      id: randomUUID(), lead_id: leadId, actor: req.user!.id, type: 'stage_change',
      body: `Stage: ${lead.stage} → won`, created_at: now(),
    });
  }
  const existing = await db.list('clients', { lead_id: leadId }, 1);
  if (existing.length) { res.json({ ok: true, id: existing[0].id, existing: true }); return; }
  const id = randomUUID();
  await db.insert('clients', {
    id, lead_id: leadId, user_id: null,
    legal_name: lead.business_name, brand_name: lead.business_name,
    industry: lead.industry ?? null, description: null,
    address: null, service_locations: lead.location ?? null,
    website: lead.website ?? null, social_links: lead.social_links ?? null,
    primary_contact: lead.contact_person ?? null, designation: null,
    email: lead.email ?? null, phone: lead.phone ?? null,
    preferred_channel: null, decision_maker: null, gstin: null, billing_email: lead.email ?? null,
    account_manager_id: lead.assigned_to ?? null,
    status: 'onboarding', created_at: now(), updated_at: now(),
  });
  await db.insert('lead_activities', {
    id: randomUUID(), lead_id: leadId, actor: req.user!.id, type: 'converted',
    body: 'Lead converted to client (onboarding started)', created_at: now(),
  });
  res.json({ ok: true, id });
});

// ---------- Onboarding responses ----------

// GET /api/ops/clients/:id/onboarding
clientsRouter.get('/:id/onboarding', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const rows = await db.list('onboarding_responses', { client_id: req.params.id }, 100);
  res.json({ ok: true, responses: rows });
});

// POST /api/ops/clients/:id/onboarding
clientsRouter.post('/:id/onboarding', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const parsed = z.object({
    section_key: z.string().trim().min(1).max(100),
    data: z.record(z.any()).default({}),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid onboarding data' }); return; }
  const d = parsed.data;
  const existing = await db.list('onboarding_responses', { client_id: req.params.id, section_key: d.section_key }, 1);
  if (existing.length) {
    await db.update('onboarding_responses', existing[0].id, {
      data: JSON.stringify(d.data), updated_at: now(),
    });
    res.json({ ok: true, id: existing[0].id, updated: true });
    return;
  }
  const id = randomUUID();
  await db.insert('onboarding_responses', {
    id, client_id: req.params.id, section_key: d.section_key,
    data: JSON.stringify(d.data), updated_at: now(),
  });
  res.json({ ok: true, id });
});

// ---------- Onboarding assets ----------

const assetSchema = z.object({
  section_key: z.string().trim().optional().or(z.literal('')),
  field_key: z.string().trim().optional().or(z.literal('')),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(1).max(100),
  size_bytes: z.coerce.number().min(0),
  data_url: z.string().trim().min(1),
});

// POST /api/ops/clients/:id/onboarding/assets
clientsRouter.post('/:id/onboarding/assets', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const parsed = assetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid asset' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('onboarding_assets', {
    id, client_id: req.params.id, section_key: d.section_key || null,
    field_key: d.field_key || null, filename: d.filename, mime: d.mime,
    size_bytes: d.size_bytes, data_url: d.data_url, created_at: now(),
  });
  res.json({ ok: true, id });
});

// GET /api/ops/clients/:id/onboarding/assets
clientsRouter.get('/:id/onboarding/assets', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const rows = await db.list('onboarding_assets', { client_id: req.params.id }, 100);
  res.json({ ok: true, assets: rows });
});

// ---------- Onboarding invites ----------

const inviteSchema = z.object({
  platform: z.enum(['meta_bm', 'meta_page', 'instagram', 'google_ads', 'analytics', 'gtm', 'crm', 'other']),
  invited_email: z.string().trim().email().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
});

// POST /api/ops/clients/:id/onboarding/invites
clientsRouter.post('/:id/onboarding/invites', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid invite' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('onboarding_invites', {
    id, client_id: req.params.id, platform: d.platform,
    invited_email: d.invited_email || null, notes: d.notes || null,
    status: 'pending', updated_at: now(),
  });
  res.json({ ok: true, id });
});

// GET /api/ops/clients/:id/onboarding/invites
clientsRouter.get('/:id/onboarding/invites', async (req: Request, res: Response) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const rows = await db.list('onboarding_invites', { client_id: req.params.id }, 100);
  res.json({ ok: true, invites: rows });
});

// PATCH /api/ops/clients/:id/onboarding/invites/:inviteId
clientsRouter.patch('/:id/onboarding/invites/:inviteId', async (req: Request, res: Response) => {
  const invite = (await db.list('onboarding_invites', { id: req.params.inviteId, client_id: req.params.id }, 1))[0];
  if (!invite) { res.status(404).json({ ok: false, error: 'Invite not found' }); return; }
  const parsed = z.object({
    status: z.enum(['pending', 'sent', 'accepted', 'declined']),
    notes: z.string().trim().optional().or(z.literal('')),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid update' }); return; }
  const d = parsed.data;
  await db.update('onboarding_invites', req.params.inviteId, {
    status: d.status, notes: d.notes ?? null, updated_at: now(),
  });
  res.json({ ok: true });
});

// POST /api/ops/clients/convert/:leadId - Convert a won lead to a client
clientsRouter.post('/convert/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const lead = (await db.list('leads', { id: leadId }, 1))[0];
  if (!lead) { res.status(404).json({ ok: false, error: 'Lead not found' }); return; }
  if (lead.stage !== 'won') {
    await db.update('leads', leadId, { stage: 'won', updated_at: now() });
    await db.insert('lead_activities', {
      id: randomUUID(), lead_id: leadId, actor: req.user!.id, type: 'stage_change',
      body: `Stage: ${lead.stage} → won`, created_at: now(),
    });
  }
  const existing = await db.list('clients', { lead_id: leadId }, 1);
  if (existing.length) { res.json({ ok: true, id: existing[0].id, existing: true }); return; }
  const id = randomUUID();
  await db.insert('clients', {
    id, lead_id: leadId, user_id: null,
    legal_name: lead.business_name, brand_name: lead.business_name,
    industry: lead.industry ?? null, description: null,
    address: null, service_locations: lead.location ?? null,
    website: lead.website ?? null, social_links: lead.social_links ?? null,
    primary_contact: lead.contact_person ?? null, designation: null,
    email: lead.email ?? null, phone: lead.phone ?? null,
    preferred_channel: null, decision_maker: null, gstin: null, billing_email: lead.email ?? null,
    account_manager_id: lead.assigned_to ?? null,
    status: 'onboarding', created_at: now(), updated_at: now(),
  });
  await db.insert('lead_activities', {
    id: randomUUID(), lead_id: leadId, actor: req.user!.id, type: 'converted',
    body: 'Lead converted to client (onboarding started)', created_at: now(),
  });
  res.json({ ok: true, id });
});
