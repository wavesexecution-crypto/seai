import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { notifyChangeReceived, notifyChangeStatus, notifyMaintenanceRequested, notifyWebsiteIntake } from '../mail/notify.js';
import { storage } from '../storage/client.js';

// Intake-scoped storage files (customerId "intake:<uuid>") may be adopted
// onto a real customer website after signup. Only READY files in intake
// categories qualify; verification uses privileged service reads.
const ADOPTABLE_CATEGORIES = ['logo', 'image', 'brand_asset', 'document', 'intake_attachment'];

async function adoptIntakeFiles(
  userId: string,
  websiteId: string,
  fileIds: string[],
  orderRef?: string | null,
): Promise<{ adopted: number } | { error: string }> {
  const now = new Date().toISOString();
  for (const fileId of fileIds) {
    const existing = await db.list('customer_files', { user_id: userId, storage_file_id: fileId }, 1);
    if (existing[0]) continue;
    let result;
    try {
      result = await storage.getFile(null, fileId);
    } catch {
      return { error: `Intake file ${fileId} could not be verified` };
    }
    if (result.status !== 200) return { error: `Intake file ${fileId} could not be verified` };
    const file = result.body.file;
    if (!file || file.status !== 'READY') return { error: `Intake file ${fileId} is not ready` };
    if (typeof file.customerId !== 'string' || !file.customerId.startsWith('intake:')) {
      return { error: `Intake file ${fileId} is not an intake asset` };
    }
    if (!ADOPTABLE_CATEGORIES.includes(file.category)) {
      return { error: `Intake file ${fileId} has an unsupported category` };
    }
    await db.insert('customer_files', {
      id: randomUUID(),
      user_id: userId,
      website_id: websiteId,
      storage_file_id: String(file.id),
      request_id: null,
      category: file.category,
      filename: file.originalFilename ?? '',
      status: 'READY',
      intake_order_ref: orderRef ?? null,
      created_at: now,
      updated_at: now,
    });
  }
  return { adopted: fileIds.length };
}

// Customer control center API. Every object is scoped to the authenticated
// customer (req.user.id). No cross-customer reads or writes.
export const customerRouter = Router();

customerRouter.use(requireAuth);

const PROVIDERS = ['ga4', 'search_console', 'pagespeed', 'gbp'] as const;
const PRIORITIES = ['normal', 'important', 'urgent'] as const;
const STATUSES = ['submitted', 'reviewing', 'in_progress', 'waiting_for_client', 'completed'] as const;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function uid(req: Request): string {
  return req.user!.id;
}

function maintenancePlan() {
  return {
    planName: config.maintenancePlanName,
    priceInr: config.maintenancePriceInr,
    currency: config.maintenanceCurrency,
  };
}

// GET /api/customer/overview — website, connections, recent requests, maintenance
customerRouter.get('/overview', async (req: Request, res: Response) => {
  const userId = uid(req);
  const websites = await db.list('customer_websites', { user_id: userId }, 1);
  const connections = await db.list('analytics_connections', { user_id: userId }, 20);
  const requests = await db.list('change_requests', { user_id: userId }, 5);
  const subs = await db.list('maintenance_subscriptions', { user_id: userId }, 1);
  res.json({
    ok: true,
    website: websites[0] ?? null,
    connections,
    recentRequests: requests,
    maintenance: subs[0] ?? { status: 'not_subscribed', ...maintenancePlan() },
    plan: maintenancePlan(),
  });
});

// PUT /api/customer/website — link or update the customer's own website
customerRouter.put('/website', async (req: Request, res: Response) => {
  const parsed = z.object({
    siteName: z.string().min(1, 'Website name is required').max(120),
    domain: z.string().min(1, 'Domain is required').max(253),
    deploymentStatus: z.string().max(60).optional(),
    sslStatus: z.string().max(60).optional(),
    intakeFileIds: z.array(z.string().min(1).max(128)).max(20).optional(),
    orderRef: z.string().max(80).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const userId = uid(req);
  const existing = await db.list('customer_websites', { user_id: userId }, 1);
  const now = new Date().toISOString();
  if (existing[0]) {
    await db.update('customer_websites', existing[0].id, {
      site_name: parsed.data.siteName.trim(),
      domain: parsed.data.domain.trim().toLowerCase(),
      deployment_status: parsed.data.deploymentStatus ?? existing[0].deployment_status,
      ssl_status: parsed.data.sslStatus ?? existing[0].ssl_status,
      updated_at: now,
    });
    const rows = await db.list('customer_websites', { user_id: userId }, 1);
    if (parsed.data.intakeFileIds?.length) {
      const adopted = await adoptIntakeFiles(userId, rows[0].id, parsed.data.intakeFileIds, parsed.data.orderRef ?? null);
      if ('error' in adopted) {
        res.status(422).json({ ok: false, error: adopted.error });
        return;
      }
    }
    res.json({ ok: true, website: rows[0] });
    return;
  }
  const row = await db.insert('customer_websites', {
    id: randomUUID(),
    user_id: userId,
    site_name: parsed.data.siteName.trim(),
    domain: parsed.data.domain.trim().toLowerCase(),
    deployment_status: parsed.data.deploymentStatus ?? 'unknown',
    ssl_status: parsed.data.sslStatus ?? 'unknown',
    created_at: now,
    updated_at: now,
  });
  if (parsed.data.intakeFileIds?.length) {
    const adopted = await adoptIntakeFiles(userId, row.id, parsed.data.intakeFileIds, parsed.data.orderRef ?? null);
    if ('error' in adopted) {
      res.status(422).json({ ok: false, error: adopted.error });
      return;
    }
  }
  // Confirms receipt of their details only. This never implies the site is
  // live: readiness/deployment emails require an authoritative status event.
  notifyWebsiteIntake(
    req.user!.email,
    {
      planName: config.maintenancePlanName,
      websiteName: row.site_name,
      domain: row.domain,
    },
    userId,
  );
  res.status(201).json({ ok: true, website: row });
});

// GET /api/customer/performance — connections + real snapshots (empty when none)
customerRouter.get('/performance', async (req: Request, res: Response) => {
  const userId = uid(req);
  const period = typeof req.query.period === 'string' ? req.query.period : '30d';
  const connections = await db.list('analytics_connections', { user_id: userId }, 20);
  const snapshots = await db.list('analytics_snapshots', { user_id: userId }, 100);
  const inPeriod = snapshots.filter((s) => !s.period || s.period === period);
  const parsed = inPeriod.map((s) => {
    let data: unknown = null;
    try { data = JSON.parse(s.payload ?? '{}'); } catch { data = null; }
    return { ...s, data };
  });
  res.json({ ok: true, period, connections, snapshots: parsed });
});

// POST /api/customer/connections — connect or update a data source
customerRouter.post('/connections', async (req: Request, res: Response) => {
  const parsed = z.object({
    provider: z.enum(PROVIDERS),
    status: z.enum(['connected', 'not_connected', 'error']).default('connected'),
    externalId: z.string().max(253).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const userId = uid(req);
  const now = new Date().toISOString();
  const existing = await db.list('analytics_connections', { user_id: userId, provider: parsed.data.provider }, 1);
  if (existing[0]) {
    await db.update('analytics_connections', existing[0].id, {
      status: parsed.data.status,
      external_id: parsed.data.externalId ?? existing[0].external_id,
      last_synced_at: parsed.data.status === 'connected' ? now : existing[0].last_synced_at,
      updated_at: now,
    });
    const rows = await db.list('analytics_connections', { user_id: userId, provider: parsed.data.provider }, 1);
    res.json({ ok: true, connection: rows[0] });
    return;
  }
  const row = await db.insert('analytics_connections', {
    id: randomUUID(),
    user_id: userId,
    provider: parsed.data.provider,
    status: parsed.data.status,
    external_id: parsed.data.externalId ?? null,
    last_synced_at: parsed.data.status === 'connected' ? now : null,
    created_at: now,
    updated_at: now,
  });
  res.status(201).json({ ok: true, connection: row });
});

// GET /api/customer/requests — customer's own change-request feed
customerRouter.get('/requests', async (req: Request, res: Response) => {
  const rows = await db.list('change_requests', { user_id: uid(req) }, 100);
  res.json({ ok: true, requests: rows });
});

// POST /api/customer/requests — create a change request
customerRouter.post('/requests', async (req: Request, res: Response) => {
  const parsed = z.object({
    title: z.string().min(1, 'Title is required').max(160),
    description: z.string().min(1, 'Description is required').max(5000),
    page: z.string().max(253).default(''),
    priority: z.enum(PRIORITIES).default('normal'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const now = new Date().toISOString();
  const row = await db.insert('change_requests', {
    id: randomUUID(),
    user_id: uid(req),
    title: parsed.data.title.trim(),
    description: parsed.data.description.trim(),
    page: (parsed.data.page ?? '').trim(),
    priority: parsed.data.priority,
    status: 'submitted',
    created_at: now,
    updated_at: now,
  });
  notifyChangeReceived(req.user!.email, row.title, row.page, row.priority, row.id, uid(req));
  res.status(201).json({ ok: true, request: row });
});

async function ownedRequest(req: Request, res: Response) {
  const rows = await db.list('change_requests', { id: req.params.id, user_id: uid(req) }, 1);
  if (!rows[0]) {
    res.status(404).json({ ok: false, error: 'Request not found' });
    return null;
  }
  return rows[0];
}

// GET /api/customer/requests/:id — full detail with messages + attachments
customerRouter.get('/requests/:id', async (req: Request, res: Response) => {
  const row = await ownedRequest(req, res);
  if (!row) return;
  const messages = await db.list('change_messages', { request_id: row.id }, 200);
  const attachments = await db.list('attachments', { request_id: row.id }, 50);
  const pubAttachments = attachments.map(({ data_url, ...rest }) => rest);
  res.json({ ok: true, request: row, messages, attachments: pubAttachments });
});

// POST /api/customer/requests/:id/messages — customer reply
customerRouter.post('/requests/:id/messages', async (req: Request, res: Response) => {
  const row = await ownedRequest(req, res);
  if (!row) return;
  const parsed = z.object({ body: z.string().min(1, 'Message is required').max(5000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const msg = await db.insert('change_messages', {
    id: randomUUID(),
    request_id: row.id,
    user_id: uid(req),
    author_role: 'client',
    body: parsed.data.body.trim(),
    created_at: new Date().toISOString(),
  });
  await db.update('change_requests', row.id, { updated_at: new Date().toISOString() });
  res.status(201).json({ ok: true, message: msg });
});

// POST /api/customer/requests/:id/status — limited client transitions.
// Every accepted transition emails the customer from the status itself, so all
// five lifecycle stages are covered by one code path. Re-sending the same status
// is deduplicated, never re-emailed.
customerRouter.post('/requests/:id/status', async (req: Request, res: Response) => {
  const row = await ownedRequest(req, res);
  if (!row) return;
  const parsed = z.object({ status: z.enum(STATUSES) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid status' });
    return;
  }
  const next = parsed.data.status;
  await db.update('change_requests', row.id, { status: next, updated_at: new Date().toISOString() });
  const rows = await db.list('change_requests', { id: row.id, user_id: uid(req) }, 1);
  const current = rows[0];
  if (current && current.status !== row.status) {
    let needed: string | undefined;
    if (next === 'waiting_for_client') {
      const messages = await db.list('change_messages', { request_id: row.id }, 200);
      const lastSeai = [...messages].reverse().find((m) => m.author_role === 'seai');
      needed = lastSeai
        ? String(lastSeai.body).slice(0, 500)
        : 'Please open the request in your dashboard — the latest update describes what is needed.';
    }
    notifyChangeStatus(
      req.user!.email,
      next,
      {
        id: current.id,
        title: current.title,
        summary: current.description,
        page: current.page,
        priority: current.priority,
        needed,
      },
      uid(req),
    );
  }
  res.json({ ok: true, request: current ?? row });
});

// POST /api/customer/requests/:id/attachments — metadata + data URL (5MB cap)
customerRouter.post('/requests/:id/attachments', async (req: Request, res: Response) => {
  const row = await ownedRequest(req, res);
  if (!row) return;
  const parsed = z.object({
    filename: z.string().min(1, 'Filename is required').max(253),
    mimeType: z.string().max(127).default('application/octet-stream'),
    sizeBytes: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
    dataUrl: z.string().max(MAX_ATTACHMENT_BYTES * 2).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const att = await db.insert('attachments', {
    id: randomUUID(),
    request_id: row.id,
    user_id: uid(req),
    filename: parsed.data.filename,
    mime_type: parsed.data.mimeType,
    size_bytes: parsed.data.sizeBytes,
    data_url: parsed.data.dataUrl ?? null,
    created_at: new Date().toISOString(),
  });
  await db.update('change_requests', row.id, { updated_at: new Date().toISOString() });
  const { data_url: _omit, ...pub } = att;
  res.status(201).json({ ok: true, attachment: pub });
});

// POST /api/customer/requests/:id/attachments/storage — link a storage file
// (uploaded via /api/storage/uploads) instead of inline bytes. Raw file bytes
// are never stored in the change-request database; only the storage file ID.
customerRouter.post('/requests/:id/attachments/storage', async (req: Request, res: Response) => {
  const row = await ownedRequest(req, res);
  if (!row) return;
  const userId = uid(req);
  const parsed = z.object({
    fileId: z.string().min(1, 'fileId is required').max(128),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const mapping = (
    await db.list('customer_files', { user_id: userId, storage_file_id: parsed.data.fileId }, 1)
  )[0];
  if (!mapping || mapping.status === 'DELETED') {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  let live;
  try {
    live = await storage.getFile({ customerId: userId, websiteId: mapping.website_id }, mapping.storage_file_id);
  } catch {
    res.status(503).json({ ok: false, error: 'Storage unavailable' });
    return;
  }
  if (live.status !== 200 || live.body.file?.status !== 'READY') {
    res.status(live.status === 200 ? 409 : live.status).json({ ok: false, error: 'File is not ready' });
    return;
  }
  const att = await db.insert('attachments', {
    id: randomUUID(),
    request_id: row.id,
    user_id: userId,
    filename: mapping.filename || live.body.file.originalFilename || 'file',
    mime_type: live.body.file.mimeType || 'application/octet-stream',
    size_bytes: live.body.file.sizeBytes ?? 0,
    data_url: null,
    file_id: mapping.storage_file_id,
    created_at: new Date().toISOString(),
  });
  await db.update('customer_files', mapping.id, {
    request_id: row.id,
    updated_at: new Date().toISOString(),
  });
  await db.update('change_requests', row.id, { updated_at: new Date().toISOString() });
  res.status(201).json({ ok: true, attachment: att });
});

// GET /api/customer/maintenance — plan (from config) + subscription state
customerRouter.get('/maintenance', async (req: Request, res: Response) => {
  const rows = await db.list('maintenance_subscriptions', { user_id: uid(req) }, 1);
  res.json({ ok: true, plan: maintenancePlan(), subscription: rows[0] ?? null });
});

// POST /api/customer/maintenance/activate — request activation (no fake payment)
customerRouter.post('/maintenance/activate', async (req: Request, res: Response) => {
  const userId = uid(req);
  const now = new Date().toISOString();
  const existing = await db.list('maintenance_subscriptions', { user_id: userId }, 1);
  // Never mark Active here: there is no payment provider wired. Activation is
  // recorded as pending_payment so the UI cannot show a fake Active state.
  if (existing[0]) {
    if (existing[0].status === 'active') {
      res.json({ ok: true, subscription: existing[0] });
      return;
    }
    await db.update('maintenance_subscriptions', existing[0].id, {
      plan_name: config.maintenancePlanName,
      price_inr: config.maintenancePriceInr,
      currency: config.maintenanceCurrency,
      status: 'pending_payment',
      payment_status: 'unpaid',
      updated_at: now,
    });
    const rows = await db.list('maintenance_subscriptions', { user_id: userId }, 1);
    notifyMaintenanceRequested(req.user!.email, rows[0].plan_name, rows[0].price_inr, rows[0].id, userId);
    res.json({ ok: true, subscription: rows[0] });
    return;
  }
  const row = await db.insert('maintenance_subscriptions', {
    id: randomUUID(),
    user_id: userId,
    plan_name: config.maintenancePlanName,
    price_inr: config.maintenancePriceInr,
    currency: config.maintenanceCurrency,
    status: 'pending_payment',
    next_billing_date: null,
    payment_status: 'unpaid',
    renewal_status: 'off',
    created_at: now,
    updated_at: now,
  });
  notifyMaintenanceRequested(req.user!.email, row.plan_name, row.price_inr, row.id, userId);
  res.status(201).json({ ok: true, subscription: row });
});
