import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/db.js';
import {
  addActivity, convertLeadToClient, createLead, findLeadDuplicate, getLeadDetail,
  listClients, listLeads, updateLead, now,
} from './service.js';
import { createAgreement, createInvoice, financeSnapshot, generateAgreementInvoice, staffOverview, createAgreementSubscription, cancelAgreementSubscription } from './billing.js';
import { createProjectFromWorkflow, getProjectDetail, updateTask, approveTask, createApproval, addProjectActivity } from './delivery.js';
import { getOnboardingState, upsertInvite } from './onboarding.js';
import { parseCsv, toCsv } from './csv.js';
import { extractPdfText, parseLeadLines, ScannedPdfError } from './pdf.js';
import { SERVICE_KEYS, PLAN_CATALOGUE } from './constants.js';
import { renderInvoiceHtml } from './routes.js';
import { requireStaffRole, staffOnly } from '../auth/middleware.js';
import { ALL_ROLES, normalizeRole } from '../auth/roles.js';

/**
 * Staff API — mounted at /api/staff. The router enforces `staffOnly` itself
 * (defense in depth): any staff role may browse, capability-sensitive routes
 * narrow further below. Unreachable by customer sessions.
 */
export const staffRouter = Router();
staffRouter.use(staffOnly);

const financeOnly = requireStaffRole('admin', 'finance');
const leadsTeam = requireStaffRole('admin', 'sales', 'account_manager');
const clientsTeam = requireStaffRole('admin', 'account_manager', 'sales', 'finance', 'marketing');
const deliveryTeam = requireStaffRole('admin', 'account_manager', 'marketing', 'designer', 'developer');
const adminOnly = requireStaffRole('admin');

const asyncWrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => { fn(req, res).catch((err) => {
    console.error('[staff] route error:', err);
    res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) });
  }); };

// ---------- overview ----------
staffRouter.get('/overview', asyncWrap(async (_req, res) => {
  res.json({ ok: true, ...(await staffOverview()) });
}));

// ---------- leads: query/filter/sort/paginate ----------
staffRouter.get('/leads', leadsTeam, asyncWrap(async (req, res) => {
  const { q, stage, assigned_to, priority, source, follow_up_due, sort, order } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number((req.query.page as string) ?? 1) || 1);
  const limit = Math.min(200, Math.max(1, Number((req.query.limit as string) ?? 50) || 50));
  const { total, rows } = await listLeads({
    q, stage, assigned_to, priority, source,
    follow_up_due: follow_up_due === '1' || follow_up_due === 'true',
    limit, offset: (page - 1) * limit, sort, order: order === 'asc' ? 'asc' : 'desc',
  });
  res.json({ ok: true, total, page, limit, leads: rows });
}));

staffRouter.get('/leads/export', leadsTeam, asyncWrap(async (req, res) => {
  const { q, stage, assigned_to, priority, source } = req.query as Record<string, string | undefined>;
  const { rows } = await listLeads({ q, stage, assigned_to, priority, source, limit: 10000 });
  const header = ['Ref', 'Business', 'Contact', 'Phone', 'Email', 'Industry', 'Location', 'Website', 'Source', 'Priority', 'Stage', 'Est. budget (INR)', 'Est. MRR (INR)', 'Assigned to', 'Next follow-up', 'Created'];
  const lines = [header];
  for (const r of rows) {
    lines.push([
      r.lead_ref ?? r.id, r.business_name, r.contact_person ?? '', r.phone ?? '', r.email ?? '',
      r.industry ?? '', r.location ?? '', r.website ?? '', r.source ?? '', r.priority ?? '',
      r.stage ?? '', r.estimated_budget_inr ?? '', r.estimated_mrr_inr ?? '', r.assigned_to ?? '',
      r.next_follow_up_at ?? '', r.created_at ?? '',
    ].map((v) => String(v ?? '')));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="seai-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(lines));
}));

staffRouter.get('/leads/:id', leadsTeam, asyncWrap(async (req, res) => {
  const detail = await getLeadDetail(req.params.id);
  if (!detail) { res.status(404).json({ ok: false, error: 'Lead not found' }); return; }
  res.json({ ok: true, ...detail });
}));

const leadCreateSchema = z.object({
  business_name: z.string().trim().min(2).max(200),
  contact_person: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  industry: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  website: z.string().trim().max(300).optional(),
  social_links: z.record(z.string()).optional(),
  source: z.string().trim().max(30).optional(),
  business_size: z.string().trim().max(20).optional(),
  potential_services: z.array(z.string()).max(12).optional(),
  estimated_budget_inr: z.coerce.number().min(0).optional(),
  estimated_mrr_inr: z.coerce.number().min(0).optional(),
  priority: z.string().trim().max(20).optional(),
  stage: z.string().trim().max(30).optional(),
  assigned_to: z.string().trim().max(64).optional(),
  next_follow_up_at: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(4000).optional(),
  force: z.boolean().optional(),
});

staffRouter.post('/leads', leadsTeam, asyncWrap(async (req, res) => {
  const parsed = leadCreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid lead' }); return; }
  const { force, ...input } = parsed.data;
  const result = await createLead({ ...input, email: input.email || null }, req.user!.id, { force: Boolean(force) });
  if (!result.ok) { res.status(result.duplicate ? 409 : 400).json(result); return; }
  res.json(result);
}));

staffRouter.patch('/leads/:id', leadsTeam, asyncWrap(async (req, res) => {
  const result = await updateLead(req.params.id, req.body ?? {}, req.user!.id);
  res.status(result.ok ? 200 : 404).json(result);
}));

staffRouter.post('/leads/:id/activity', leadsTeam, asyncWrap(async (req, res) => {
  const lead = (await db.list('leads', { id: req.params.id }, 1))[0];
  if (!lead) { res.status(404).json({ ok: false, error: 'Lead not found' }); return; }
  const type = String(req.body?.type ?? 'note');
  const body = String(req.body?.body ?? '').trim();
  if (!body) { res.status(400).json({ ok: false, error: 'Activity body is required' }); return; }
  if (body.length > 4000) { res.status(400).json({ ok: false, error: 'Activity too long' }); return; }
  if (req.body?.follow_up_at) await db.update('leads', lead.id, { next_follow_up_at: String(req.body.follow_up_at), updated_at: now() });
  await addActivity(lead.id, req.user!.id, type, body, req.body?.meta);
  if (['call', 'email', 'whatsapp'].includes(type)) await db.update('leads', lead.id, { last_contacted_at: now(), updated_at: now() });
  res.json({ ok: true });
}));

staffRouter.post('/leads/:id/convert', clientsTeam, asyncWrap(async (req, res) => {
  const result = await convertLeadToClient(req.params.id, req.user!.id);
  res.status(result.ok ? 200 : 404).json(result);
}));

staffRouter.post('/leads/check-duplicate', leadsTeam, asyncWrap(async (req, res) => {
  const dup = await findLeadDuplicate({ email: req.body?.email, phone: req.body?.phone, business_name: req.body?.business_name });
  res.json({ ok: true, duplicate: dup });
}));

// ---------- lead import (CSV + PDF text; scanned PDFs rejected) ----------
const importSchema = z.object({
  filename: z.string().trim().min(1).max(300),
  content_base64: z.string().min(1),
  import_duplicates: z.boolean().optional(),
});
const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;

const HEADER_MAP: Record<string, string> = {
  business: 'business_name', business_name: 'business_name', company: 'business_name',
  'business name': 'business_name', name: 'business_name', organisation: 'business_name', organization: 'business_name', shop: 'business_name', store: 'business_name',
  contact: 'contact_person', contact_person: 'contact_person', person: 'contact_person', 'contact name': 'contact_person', owner: 'contact_person',
  phone: 'phone', mobile: 'phone', telephone: 'phone', 'phone number': 'phone', contact_number: 'phone', whatsapp: 'phone',
  email: 'email', email_id: 'email', mail: 'email', 'e-mail': 'email',
  industry: 'industry', sector: 'industry', category: 'industry', vertical: 'industry',
  location: 'location', city: 'location', area: 'location', town: 'location',
  website: 'website', web: 'website', url: 'website', site: 'website',
  source: 'source', budget: 'estimated_budget_inr', estimated_budget: 'estimated_budget_inr', budget_inr: 'estimated_budget_inr',
  priority: 'priority', services: 'potential_services', potential_services: 'potential_services',
  notes: 'notes', note: 'notes',
};

staffRouter.post('/leads/import', leadsTeam, asyncWrap(async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: 'filename and content_base64 are required' }); return; }
  const { filename, content_base64, import_duplicates } = parsed.data;
  let buffer: Buffer;
  try { buffer = Buffer.from(content_base64, 'base64'); } catch { res.status(400).json({ ok: false, error: 'Invalid base64 content' }); return; }
  if (buffer.length > MAX_IMPORT_BYTES) { res.status(413).json({ ok: false, error: 'File exceeds 3 MB' }); return; }
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const importId = randomUUID();
  let rows: Record<string, string>[] = [];
  let skipped = 0;

  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const table = parseCsv(buffer.toString('utf8'));
    if (table.length < 2) { await recordImport(importId, filename, 'csv', 0, 0, 0, 0, 'failed', 'CSV has no data rows', req.user!.id); res.status(400).json({ ok: false, error: 'CSV has no data rows' }); return; }
    const header = table[0].map((h) => String(h).trim().toLowerCase());
    const colIndex: Record<string, number> = {};
    header.forEach((h, i) => { const mapped = HEADER_MAP[h]; if (mapped && !(mapped in colIndex)) colIndex[mapped] = i; });
    if (!('business_name' in colIndex) && !('phone' in colIndex) && !('email' in colIndex)) {
      await recordImport(importId, filename, 'csv', 0, 0, 0, 0, 'failed', 'No recognisable columns (need business/company, phone or email)', req.user!.id);
      res.status(400).json({ ok: false, error: 'No recognisable columns. Expected headers like: business, contact, phone, email, industry, location, website, budget' });
      return;
    }
    for (const raw of table.slice(1, MAX_IMPORT_ROWS + 1)) {
      const row: Record<string, string> = {};
      for (const [key, i] of Object.entries(colIndex)) row[key] = String(raw[i] ?? '').trim();
      rows.push(row);
    }
    skipped += Math.max(0, table.length - 1 - MAX_IMPORT_ROWS);
    await runImport(importId, filename, 'csv', rows, skipped, Boolean(import_duplicates), req.user!.id, res);
    return;
  }
  if (ext === 'pdf') {
    try {
      const { text } = await extractPdfText(buffer);
      const parsedLines = parseLeadLines(text);
      rows = parsedLines.rows.map((r) => ({
        business_name: r.business_name, phone: r.phone ?? '', email: r.email ?? '', location: r.location ?? '',
      }));
      skipped = parsedLines.skipped;
      await runImport(importId, filename, 'pdf', rows, skipped, Boolean(import_duplicates), req.user!.id, res);
      return;
    } catch (err) {
      const scanned = err instanceof ScannedPdfError;
      const message = String((err as Error)?.message ?? err);
      await recordImport(importId, filename, 'pdf', 0, 0, 0, 0, 'failed', message.slice(0, 500), req.user!.id);
      res.status(scanned ? 422 : 400).json({ ok: false, error: message, scanned });
      return;
    }
  }
  res.status(400).json({ ok: false, error: 'Unsupported file type — upload .csv or .pdf' });
}));

async function runImport(importId: string, filename: string, fileType: string, rows: Record<string, string>[], skipped: number, importDuplicates: boolean, actor: string, res: Response) {
  let imported = 0, duplicates = 0, invalid = 0;
  const errors: string[] = [];
  for (const [i, row] of rows.entries()) {
    const business = (row.business_name ?? '').trim();
    if (!business && !row.phone && !row.email) { invalid += 1; continue; }
    if (!importDuplicates) {
      const dup = await findLeadDuplicate({ email: row.email, phone: row.phone, business_name: business });
      if (dup) { duplicates += 1; continue; }
    }
    const services = row.potential_services ? row.potential_services.split(/[;|]/).map((s) => s.trim()).filter((s) => SERVICE_KEYS.includes(s)) : undefined;
    const budget = Number(String(row.estimated_budget_inr ?? '').replace(/[^\d.]/g, ''));
    const result = await createLead({
      business_name: business || `Lead (${row.phone ?? row.email})`,
      contact_person: row.contact_person || null,
      phone: row.phone || null,
      email: row.email || null,
      industry: row.industry || null,
      location: row.location || null,
      website: row.website || null,
      source: 'import',
      potential_services: services,
      estimated_budget_inr: Number.isFinite(budget) && budget > 0 ? budget : null,
      priority: ['low', 'normal', 'high', 'urgent'].includes(String(row.priority).toLowerCase()) ? String(row.priority).toLowerCase() : 'normal',
      notes: row.notes || undefined,
    }, actor, { force: true, importBatchId: importId });
    if (result.ok) imported += 1; else { invalid += 1; if (errors.length < 20) errors.push(`Row ${i + 2}: ${result.error}`); }
  }
  await recordImport(importId, filename, fileType, rows.length, imported, skipped + invalid, duplicates, 'completed', null, actor);
  res.json({ ok: true, importId, rows_total: rows.length, rows_imported: imported, rows_skipped: skipped + invalid, duplicates, errors });
}

async function recordImport(id: string, filename: string, fileType: string, rowsTotal: number, imported: number, skippedCount: number, duplicates: number, status: string, error: string | null, actor: string) {
  await db.insert('lead_imports', {
    id, filename: filename.slice(0, 300), file_type: fileType,
    rows_total: rowsTotal, rows_imported: imported, rows_skipped: skippedCount,
    duplicates, status, error, actor, created_at: now(),
  });
}

staffRouter.get('/imports', leadsTeam, asyncWrap(async (_req, res) => {
  res.json({ ok: true, imports: await db.list('lead_imports', {}, 50) });
}));

// ---------- inquiries ----------
staffRouter.get('/inquiries', leadsTeam, asyncWrap(async (req, res) => {
  const status = String(req.query.status ?? '');
  const rows = await db.list('growth_inquiries', status ? { status } : {}, 500);
  res.json({ ok: true, inquiries: rows });
}));

staffRouter.post('/inquiries/:id/close', leadsTeam, asyncWrap(async (req, res) => {
  await db.update('growth_inquiries', req.params.id, { status: String(req.body?.status ?? 'closed') === 'converted' ? 'converted' : 'closed' });
  res.json({ ok: true });
}));

// ---------- clients ----------
staffRouter.get('/clients', clientsTeam, asyncWrap(async (req, res) => {
  const { q, status } = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number((req.query.page as string) ?? 1) || 1);
  const limit = Math.min(200, Math.max(1, Number((req.query.limit as string) ?? 50) || 50));
  const { total, rows } = await listClients({ q, status, limit, offset: (page - 1) * limit });
  res.json({ ok: true, total, page, limit, clients: rows });
}));

staffRouter.get('/clients/:id', clientsTeam, asyncWrap(async (req, res) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const [agreements, projects, invoices, onboarding] = await Promise.all([
    db.list('service_agreements', { client_id: client.id }, 20),
    db.list('projects', { client_id: client.id }, 100),
    db.list('invoices', { client_id: client.id }, 100),
    getOnboardingState(client.id),
  ]);
  invoices.sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
  res.json({ ok: true, client, agreements, projects, invoices, onboarding });
}));

staffRouter.patch('/clients/:id', clientsTeam, asyncWrap(async (req, res) => {
  const client = (await db.list('clients', { id: req.params.id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const allowed = ['legal_name', 'brand_name', 'industry', 'description', 'address', 'service_locations', 'website', 'social_links', 'primary_contact', 'designation', 'email', 'phone', 'preferred_channel', 'decision_maker', 'gstin', 'billing_email', 'account_manager_id', 'status'] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in (req.body ?? {})) patch[key] = req.body[key] === '' ? null : req.body[key];
  if (patch.status && !['onboarding', 'active', 'paused', 'cancelled'].includes(String(patch.status))) { res.status(400).json({ ok: false, error: 'Invalid status' }); return; }
  patch.updated_at = now();
  await db.update('clients', client.id, patch);
  res.json({ ok: true });
}));

// Staff sees full onboarding payload incl. asset data for download/review.
staffRouter.get('/clients/:id/onboarding', clientsTeam, asyncWrap(async (req, res) => {
  const state = await getOnboardingState(req.params.id);
  if (!state) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const assets = await db.list('onboarding_assets', { client_id: req.params.id }, 200);
  res.json({ ok: true, ...state, assets });
}));

staffRouter.put('/clients/:id/invites', clientsTeam, asyncWrap(async (req, res) => {
  const result = await upsertInvite(req.params.id, req.body ?? {});
  res.status(result.ok ? 200 : 400).json(result);
}));

// ---------- agreements & invoices ----------
staffRouter.post('/clients/:id/agreements', financeOnly, asyncWrap(async (req, res) => {
  const result = await createAgreement({ client_id: req.params.id, ...(req.body ?? {}) });
  res.status(result.ok ? 200 : 400).json(result);
}));

staffRouter.get('/plans', asyncWrap(async (_req, res) => {
  res.json({ ok: true, plans: PLAN_CATALOGUE, note: 'Proposed pricing — configurable. Ad budgets are never part of SEAI fees.' });
}));

// ---------- Razorpay subscriptions (genuine mandate flow) ----------
// Amounts are server-side authoritative; clients authorise the mandate with
// subscription_id in Razorpay checkout. Nothing is marked paid/active here —
// payments (webhooks + verify endpoint) own that transition.
staffRouter.post('/agreements/:id/subscription', financeOnly, asyncWrap(async (req, res) => {
  const result = await createAgreementSubscription(req.params.id);
  res.status(result.ok ? 200 : (result as { error?: string }).error?.startsWith('Payments') ? 503 : 400).json(result);
}));

staffRouter.post('/agreements/:id/subscription/cancel', financeOnly, asyncWrap(async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined;
  const result = await cancelAgreementSubscription(req.params.id, reason);
  res.status(result.ok ? 200 : 400).json(result);
}));

staffRouter.get('/agreements/:id/subscription/status', financeOnly, asyncWrap(async (req, res) => {
  const agreement = (await db.list('service_agreements', { id: req.params.id }, 1))[0];
  if (!agreement) { res.status(404).json({ ok: false, error: 'Agreement not found' }); return; }
  if (!agreement.razorpay_subscription_id) { res.json({ ok: true, subscription: null }); return; }
  try {
    const { getPaymentsSubscription } = await import('../payments/client.js');
    res.json({ ok: true, subscription: await getPaymentsSubscription(agreement.razorpay_subscription_id) });
  } catch (err) {
    res.status(503).json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) });
  }
}));

const generateSchema = z.object({ kind: z.enum(['service_fee', 'ad_budget']), periodLabel: z.string().trim().max(60).optional() });
staffRouter.post('/agreements/:id/invoices/generate', financeOnly, asyncWrap(async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: 'kind must be service_fee|ad_budget' }); return; }
  const result = await generateAgreementInvoice(req.params.id, parsed.data.kind, parsed.data.periodLabel);
  res.status(result.ok ? 200 : 400).json(result);
}));

const oneTimeSchema = z.object({
  kind: z.enum(['one_time', 'third_party', 'other', 'service_fee', 'ad_budget']).default('one_time'),
  description: z.string().trim().min(3).max(300),
  lines: z.array(z.object({ label: z.string().trim().min(1).max(300), qty: z.coerce.number().min(0.01), unit_inr: z.coerce.number().min(0) })).min(1).max(50),
  gst_rate: z.coerce.number().min(0).max(30).optional(),
  agreement_id: z.string().trim().max(64).optional(),
});
staffRouter.post('/clients/:id/invoices', financeOnly, asyncWrap(async (req, res) => {
  const parsed = oneTimeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid invoice' }); return; }
  const result = await createInvoice({ client_id: req.params.id, ...parsed.data });
  res.status(result.ok ? 200 : 400).json(result);
}));

staffRouter.get('/invoices', financeOnly, asyncWrap(async (req, res) => {
  const status = String(req.query.status ?? '');
  const kind = String(req.query.kind ?? '');
  const clientId = String(req.query.client_id ?? '');
  let rows = await db.list('invoices', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (clientId) rows = rows.filter((r) => r.client_id === clientId);
  rows.sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
  res.json({ ok: true, invoices: rows.slice(0, 500), total: rows.length });
}));

staffRouter.post('/invoices/:id/send', financeOnly, asyncWrap(async (req, res) => {
  await db.update('invoices', req.params.id, { status: 'sent' });
  res.json({ ok: true });
}));

staffRouter.post('/invoices/:id/paid', financeOnly, asyncWrap(async (req, res) => {
  const invoice = (await db.list('invoices', { id: req.params.id }, 1))[0];
  if (!invoice) { res.status(404).json({ ok: false, error: 'Invoice not found' }); return; }
  await db.update('invoices', invoice.id, {
    status: 'paid', paid_at: now(),
    razorpay_payment_id: req.body?.razorpay_payment_id ? String(req.body.razorpay_payment_id).slice(0, 80) : null,
  });
  res.json({ ok: true });
}));

staffRouter.post('/invoices/:id/cancel', financeOnly, asyncWrap(async (req, res) => {
  await db.update('invoices', req.params.id, { status: 'cancelled' });
  res.json({ ok: true });
}));

staffRouter.get('/invoices/:id/download', financeOnly, asyncWrap(async (req, res) => {
  const invoice = (await db.list('invoices', { id: req.params.id }, 1))[0];
  if (!invoice) { res.status(404).send('Invoice not found'); return; }
  const client = (await db.list('clients', { id: invoice.client_id }, 1))[0] ?? {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderInvoiceHtml(invoice, client));
}));

// ---------- projects & delivery ----------
staffRouter.post('/projects', deliveryTeam, asyncWrap(async (req, res) => {
  const result = await createProjectFromWorkflow({
    client_id: String(req.body?.client_id ?? ''),
    service_category: String(req.body?.service_category ?? ''),
    name: req.body?.name, assigned_to: req.body?.assigned_to,
    agreement_id: req.body?.agreement_id, start_date: req.body?.start_date,
    due_date: req.body?.due_date, brief: req.body?.brief,
  }, req.user!.id);
  res.status(result.ok ? 200 : 400).json(result);
}));

staffRouter.get('/projects', clientsTeam, asyncWrap(async (req, res) => {
  const status = String(req.query.status ?? '');
  const clientId = String(req.query.client_id ?? '');
  let rows = await db.list('projects', {}, 5000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (clientId) rows = rows.filter((r) => r.client_id === clientId);
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, projects: rows.slice(0, 500) });
}));

staffRouter.get('/projects/:id', clientsTeam, asyncWrap(async (req, res) => {
  const detail = await getProjectDetail(req.params.id);
  if (!detail) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  res.json({ ok: true, ...detail });
}));

staffRouter.patch('/projects/:id', deliveryTeam, asyncWrap(async (req, res) => {
  const patch: Record<string, unknown> = {};
  if (req.body?.status && ['planned', 'active', 'on_hold', 'completed', 'cancelled'].includes(String(req.body.status))) patch.status = String(req.body.status);
  if ('assigned_to' in (req.body ?? {})) patch.assigned_to = req.body.assigned_to || null;
  if ('due_date' in (req.body ?? {})) patch.due_date = req.body.due_date || null;
  patch.updated_at = now();
  await db.update('projects', req.params.id, patch);
  await addProjectActivity(req.params.id, req.user!.id, 'status_change', `Project updated: ${Object.keys(patch).filter((k) => k !== 'updated_at').join(', ') || 'no-op'}`);
  res.json({ ok: true });
}));

staffRouter.patch('/tasks/:id', deliveryTeam, asyncWrap(async (req, res) => {
  const result = await updateTask(req.params.id, req.body ?? {}, req.user!.id);
  res.status(result.ok ? 200 : 400).json(result);
}));

staffRouter.post('/tasks/:id/approve', deliveryTeam, asyncWrap(async (req, res) => {
  const result = await approveTask(req.params.id, req.user!.id, Boolean(req.body?.approve), typeof req.body?.feedback === 'string' ? req.body.feedback : undefined);
  res.status(result.ok ? 200 : 400).json(result);
}));

// ---------- content approvals ----------
staffRouter.post('/approvals', deliveryTeam, asyncWrap(async (req, res) => {
  const result = await createApproval({
    client_id: String(req.body?.client_id ?? ''),
    project_id: req.body?.project_id ?? null,
    kind: req.body?.kind, title: String(req.body?.title ?? ''),
    preview_url: req.body?.preview_url, caption: req.body?.caption, series: req.body?.series,
  }, req.user!.id);
  res.status(result.ok ? 200 : 400).json(result);
}));

staffRouter.get('/approvals', clientsTeam, asyncWrap(async (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const clientId = String(req.query.client_id ?? '');
  let rows = await db.list('content_approvals', {}, 5000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (clientId) rows = rows.filter((r) => r.client_id === clientId);
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, approvals: rows.slice(0, 500) });
}));

// ---------- campaign reports (operator-entered; source labelled) ----------
const reportSchema = z.object({
  client_id: z.string().trim().min(1),
  campaign_name: z.string().trim().min(2).max(200),
  platform: z.enum(['meta', 'google', 'youtube', 'other']),
  status: z.enum(['active', 'paused', 'ended']).default('active'),
  period_start: z.string().trim().max(30).optional(),
  period_end: z.string().trim().max(30).optional(),
  spend_inr: z.coerce.number().min(0).optional(),
  reach: z.coerce.number().min(0).optional(),
  impressions: z.coerce.number().min(0).optional(),
  clicks: z.coerce.number().min(0).optional(),
  leads: z.coerce.number().min(0).optional(),
  conversions: z.coerce.number().min(0).optional(),
  data_source: z.enum(['manual', 'meta_api', 'google_ads_api']).default('manual'),
  notes: z.string().trim().max(2000).optional(),
});

staffRouter.post('/campaign-reports', requireStaffRole('admin', 'account_manager', 'marketing'), asyncWrap(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid report' }); return; }
  const d = parsed.data;
  const cpl = d.leads && d.leads > 0 && d.spend_inr !== undefined ? Math.round(d.spend_inr / d.leads) : null;
  const id = randomUUID();
  await db.insert('campaign_reports', { ...d, cost_per_lead_inr: cpl, id, created_at: now() });
  res.json({ ok: true, id });
}));

staffRouter.get('/campaign-reports', clientsTeam, asyncWrap(async (req, res) => {
  const clientId = String(req.query.client_id ?? '');
  if (!clientId) { res.status(400).json({ ok: false, error: 'client_id is required' }); return; }
  res.json({ ok: true, reports: await db.list('campaign_reports', { client_id: clientId }, 500) });
}));

// ---------- finance snapshot & expenses ----------
staffRouter.get('/finance', financeOnly, asyncWrap(async (_req, res) => {
  const snapshot = await financeSnapshot();
  const expenses = await db.list('expenses', {}, 1000);
  expenses.sort((a, b) => String(b.incurred_at).localeCompare(String(a.incurred_at)));
  res.json({ ok: true, ...snapshot, expenses: expenses.slice(0, 100) });
}));

const expenseSchema = z.object({
  category: z.enum(['payroll', 'contractor', 'software', 'tools', 'office', 'other']),
  description: z.string().trim().min(2).max(300),
  amount_inr: z.coerce.number().min(0.01),
  incurred_at: z.string().trim().max(30),
  recurring: z.boolean().optional(),
});

staffRouter.post('/expenses', financeOnly, asyncWrap(async (req, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid expense' }); return; }
  const id = randomUUID();
  await db.insert('expenses', { ...parsed.data, recurring: Boolean(parsed.data.recurring), id, created_at: now() });
  res.json({ ok: true, id });
}));

// ---------- support (staff side) ----------
staffRouter.get('/support', clientsTeam, asyncWrap(async (req, res) => {
  const status = String(req.query.status ?? '');
  let rows = await db.list('support_requests', {}, 2000);
  if (status) rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  res.json({ ok: true, requests: rows.slice(0, 200) });
}));

staffRouter.post('/support/:id/messages', clientsTeam, asyncWrap(async (req, res) => {
  const r = (await db.list('support_requests', { id: req.params.id }, 1))[0];
  if (!r) { res.status(404).json({ ok: false, error: 'Request not found' }); return; }
  const body = String(req.body?.body ?? '').trim().slice(0, 4000);
  if (!body) { res.status(400).json({ ok: false, error: 'Message is required' }); return; }
  await db.insert('support_messages', { id: randomUUID(), request_id: r.id, sender_id: req.user!.id, sender_role: 'seai', body, created_at: now() });
  await db.update('support_requests', r.id, { status: req.body?.status && ['open', 'in_progress', 'resolved', 'closed'].includes(String(req.body.status)) ? String(req.body.status) : 'in_progress', updated_at: now() });
  res.json({ ok: true });
}));

staffRouter.patch('/support/:id', clientsTeam, asyncWrap(async (req, res) => {
  const status = String(req.body?.status ?? '');
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) { res.status(400).json({ ok: false, error: 'Invalid status' }); return; }
  await db.update('support_requests', req.params.id, { status, updated_at: now() });
  res.json({ ok: true });
}));

// ---------- staff directory & role management (admin only) ----------
staffRouter.get('/users', adminOnly, asyncWrap(async (_req, res) => {
  const users = await db.list('users', {}, 10000);
  res.json({ ok: true, users: users.map((u) => ({ id: u.id, full_name: u.full_name, email: u.email, role: normalizeRole(u.role), email_verified: u.email_verified, created_at: u.created_at })) });
}));

staffRouter.patch('/users/:id/role', adminOnly, asyncWrap(async (req, res) => {
  const role = String(req.body?.role ?? '').toLowerCase();
  if (!(ALL_ROLES as readonly string[]).includes(role)) { res.status(400).json({ ok: false, error: `Role must be one of: ${ALL_ROLES.join(', ')}` }); return; }
  const target = (await db.list('users', { id: req.params.id }, 1))[0];
  if (!target) { res.status(404).json({ ok: false, error: 'User not found' }); return; }
  if (target.id === req.user!.id && role !== 'admin') { res.status(400).json({ ok: false, error: 'You cannot demote your own admin account' }); return; }
  await db.update('users', target.id, { role });
  res.json({ ok: true, id: target.id, role });
}));
