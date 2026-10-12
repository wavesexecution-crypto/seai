import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { config } from '../config.js';
import { requireAuth, requireStaff } from '../auth/middleware.js';
import { notifyChangeReceived, notifyChangeStatus, notifyMaintenanceRequested, notifyWebsiteIntake, notifyPurchaseConfirmed, notifyDomainConnected, notifyWebsiteDeployed, notifyWebsiteReady } from '../mail/notify.js';
import { storage } from '../storage/client.js';

function formatInr(amountPaise: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${(amountPaise / 100).toFixed(2)}`;
}

// Intake-scoped storage files (customerId "intake:<uuid>") may be adopted
// onto a real customer website after signup. Only READY files in intake
// categories qualify; verification uses privileged service reads.
const ADOPTABLE_CATEGORIES = ['logo', 'image', 'brand_asset', 'document', 'intake_attachment'];

export async function adoptIntakeFiles(
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

// Authoritative, non-customer transitions: completing a change request, and
// recording website purchase/deployment/domain/ready state.
//
// Deliberately a SEPARATE router, mounted ahead of `customerRouter`, because
// that router is gated by `requireAuth`. These operations must be callable by a
// service key alone — a customer session is explicitly not sufficient — so
// registering them inside the session gate would make them unreachable (401) for
// exactly the automation that is meant to drive them.
export const customerStaffRouter = Router();

/** POST /api/customer/requests/:id/complete — staff-only completion.
 *
 * A separate route rather than a flag on the customer one, so the capability is
 * auditable in isolation and the customer path can never be widened by accident.
 */
customerStaffRouter.post('/requests/:id/complete', requireStaff, async (req: Request, res: Response) => {
  const parsed = z.object({
    summary: z.string().max(2000).optional(),
    note: z.string().max(4000).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  // Staff act across tenants, so the request is looked up by id alone; the
  // authoritative recipient is the owning customer.
  const rows = await db.list('change_requests', { id: req.params.id }, 1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ ok: false, error: 'Request not found' });
    return;
  }
  if (row.status === 'completed') {
    res.json({ ok: true, request: row, alreadyCompleted: true });
    return;
  }
  const now = new Date().toISOString();
  await db.update('change_requests', row.id, { status: 'completed', updated_at: now });
  if (parsed.data.note) {
    await db.insert('change_messages', {
      id: randomUUID(),
      request_id: row.id,
      user_id: row.user_id,
      author_role: 'seai',
      body: parsed.data.note,
      created_at: now,
    });
  }
  const owner = await db.list('users', { id: row.user_id }, 1);
  const ownerEmail = String(owner[0]?.email ?? '');
  if (ownerEmail) {
    notifyChangeStatus(
      ownerEmail,
      'completed',
      {
        id: row.id,
        title: row.title,
        summary: parsed.data.summary ?? row.description,
        page: row.page,
        priority: row.priority,
      },
      String(row.user_id),
    );
  }
  res.json({ ok: true, request: { ...row, status: 'completed' } });
});

/**
 * POST /api/customer/website/lifecycle — staff-authoritative website status.
 *
 * The write path for the website lifecycle events. Each notice is emitted from a
 * real, persisted state transition, never on a bare call:
 *
 *   - order recorded for the first time         -> website.purchase_confirmed
 *   - domain set or changed                     -> website.domain_connected
 *   - deployment_status enters a deployed state -> website.deployed
 *   - deployed AND TLS active                   -> website.ready
 *
 * Keyed on order_id and domain+deployment id, so a repeated call is a no-op
 * rather than a second email. Nothing is emitted unless the field changed.
 */
customerStaffRouter.post('/website/lifecycle', requireStaff, async (req: Request, res: Response) => {
  const parsed = z.object({
    userId: z.string().min(1, 'userId is required').max(80),
    siteName: z.string().max(120).optional(),
    domain: z.string().max(253).optional(),
    deploymentStatus: z.string().max(60).optional(),
    sslStatus: z.string().max(60).optional(),
    deploymentId: z.string().max(120).optional(),
    purchase: z.object({
      orderId: z.string().min(1).max(120),
      planName: z.string().min(1).max(120),
      amountPaise: z.number().int().nonnegative(),
      currency: z.string().max(8).default('INR'),
      paymentId: z.string().max(120).optional(),
      purchasedAt: z.string().max(60).optional(),
    }).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const input = parsed.data;
  const owner = (await db.list('users', { id: input.userId }, 1))[0];
  if (!owner) {
    res.status(404).json({ ok: false, error: 'Customer not found' });
    return;
  }
  const recipient = String(owner.email ?? '');
  const existing = (await db.list('customer_websites', { user_id: input.userId }, 1))[0];
  if (!existing) {
    res.status(404).json({ ok: false, error: 'No website is recorded for this customer yet' });
    return;
  }

  const now = new Date().toISOString();
  const before = {
    site_name: String(existing.site_name ?? ''),
    domain: String(existing.domain ?? ''),
    deployment_status: String(existing.deployment_status ?? 'unknown'),
    ssl_status: String(existing.ssl_status ?? 'unknown'),
    order_id: existing.order_id == null ? null : String(existing.order_id),
  };
  const patch: Record<string, unknown> = { updated_at: now };
  if (input.siteName) patch.site_name = input.siteName.trim();
  if (input.domain) patch.domain = input.domain.trim().toLowerCase();
  if (input.deploymentStatus) {
    patch.deployment_status = input.deploymentStatus.trim().toLowerCase();
    patch.last_deployment_at = now;
  }
  if (input.sslStatus) patch.ssl_status = input.sslStatus.trim().toLowerCase();
  if (input.purchase) {
    patch.order_id = input.purchase.orderId;
    patch.plan_name = input.purchase.planName;
    patch.order_amount_paise = input.purchase.amountPaise;
    patch.order_currency = input.purchase.currency;
    patch.order_confirmed_at = input.purchase.purchasedAt ?? now;
  }
  await db.update('customer_websites', existing.id, patch);
  const after = (await db.list('customer_websites', { user_id: input.userId }, 1))[0];

  const emitted: string[] = [];
  const siteName = String(after.site_name ?? '');
  const domain = String(after.domain ?? '');

  if (input.purchase && before.order_id !== input.purchase.orderId) {
    notifyPurchaseConfirmed(
      recipient,
      {
        customerName: String(owner.full_name ?? '') || undefined,
        planName: input.purchase.planName,
        amount: formatInr(input.purchase.amountPaise, input.purchase.currency),
        orderId: input.purchase.orderId,
        purchasedAt: input.purchase.purchasedAt ?? now,
        websiteName: siteName,
        currency: input.purchase.currency,
        paymentId: input.purchase.paymentId,
      },
      input.userId,
    );
    emitted.push('website.purchase_confirmed');
  }

  if (domain && before.domain !== domain) {
    notifyDomainConnected(recipient, { websiteName: siteName, domain }, input.userId);
    emitted.push('website.domain_connected');
  }

  const deploymentStatus = String(after.deployment_status ?? 'unknown');
  const sslStatus = String(after.ssl_status ?? 'unknown');

  if (DEPLOYED_STATES.has(deploymentStatus) && !DEPLOYED_STATES.has(before.deployment_status)) {
    notifyWebsiteDeployed(
      recipient,
      { websiteName: siteName, domain, deploymentId: input.deploymentId, changedAt: now },
      input.userId,
    );
    emitted.push('website.deployed');
  }

  if (DEPLOYED_STATES.has(deploymentStatus) && SECURE_STATES.has(sslStatus) && domain) {
    // Only on the transition INTO ready. Without this, every idempotent re-post
    // would report (and could re-send) a readiness notice for a site that has
    // been ready all along.
    const wasReady = DEPLOYED_STATES.has(before.deployment_status) && SECURE_STATES.has(before.ssl_status);
    if (!wasReady) {
      notifyWebsiteReady(
        recipient,
        { websiteName: siteName, domain, orderId: after.order_id == null ? undefined : String(after.order_id) },
        input.userId,
      );
      emitted.push('website.ready');
    }
  }

  res.json({ ok: true, website: after, emitted });
});


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

// PUT /api/customer/website — link or update the customer's own website.
//
// Customers record what THEY know: the site name and domain. They may not assert
// deployment or TLS state, because that is SEAI's authoritative status; those
// columns are staff-only via /website/lifecycle below. (The dashboard never sent
// them anyway, so this is not a behaviour change for the UI.)
customerRouter.put('/website', async (req: Request, res: Response) => {
  const parsed = z.object({
    siteName: z.string().min(1, 'Website name is required').max(120),
    domain: z.string().min(1, 'Domain is required').max(253),
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
    deployment_status: 'unknown',
    ssl_status: 'unknown',
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
  // live: readiness/deployment emails are emitted by the staff lifecycle route
  // from the authoritative status transition.
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

// Deployment states that mean "a deployment finished for this domain".
const DEPLOYED_STATES = new Set(['deployed', 'live', 'ready', 'published', 'active']);
// TLS states that mean the site is actually served over https.
const SECURE_STATES = new Set(['active', 'valid', 'issued', 'ok']);


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
//
// A customer may move their own request through the collaborative stages, but
// may NOT mark it `completed`. Completion is an assertion about SEAI's own work,
// and self-certifying it both corrupted the record and emailed the customer a
// false "we completed your work" notice. `completed` is therefore staff-only and
// is refused here with 403; staff use the dedicated route below.
//
// Tenant isolation is unchanged: the request must still belong to the caller.
customerRouter.post('/requests/:id/status', async (req: Request, res: Response) => {
  const row = await ownedRequest(req, res);
  if (!row) return;
  const parsed = z.object({ status: z.enum(STATUSES) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid status' });
    return;
  }
  const next = parsed.data.status;
  if (next === 'completed') {
    res.status(403).json({
      ok: false,
      error: 'Only SEAI can mark a change request completed',
    });
    return;
  }
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
