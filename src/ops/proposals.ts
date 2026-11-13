import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const proposalsRouter = Router();
proposalsRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'sales', 'account_manager'));

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

const lineItemSchema = z.object({
  service_key: z.string().trim().min(1),
  service_label: z.string().trim().min(1),
  package_name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  qty: z.coerce.number().min(0.01).default(1),
  unit_price_inr: z.coerce.number().min(0).default(0),
});

const proposalSchema = z.object({
  lead_id: z.string().trim().min(1).optional().or(z.literal('')),
  client_id: z.string().trim().min(1).optional().or(z.literal('')),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  payment_terms: z.string().trim().max(200).default('Due within 7 days'),
  valid_until: z.string().trim().optional(),
  line_items: z.array(lineItemSchema).min(1),
});

// GET /api/ops/proposals
proposalsRouter.get('/', async (req: Request, res: Response) => {
  const { status, lead_id, client_id } = req.query;
  let rows = await db.list('proposals', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (lead_id) rows = rows.filter((r) => r.lead_id === lead_id);
  if (client_id) rows = rows.filter((r) => r.client_id === client_id);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, proposals: rows });
});

// GET /api/ops/proposals/:id
proposalsRouter.get('/:id', async (req: Request, res: Response) => {
  const row = (await db.list('proposals', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Proposal not found' }); return; }
  const items = await db.list('proposal_line_items', { proposal_id: req.params.id }, 200);
  res.json({ ok: true, proposal: row, line_items: items });
});

// POST /api/ops/proposals
proposalsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = proposalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid proposal' }); return; }
  const d = parsed.data;
  // Validate line item service keys against services catalogue
  for (const li of d.line_items) {
    const svc = (await db.list('services', { key: li.service_key, is_active: true }, 1))[0];
    if (!svc) {
      res.status(400).json({ ok: false, error: `Service '${li.service_key}' is not active or does not exist` });
      return;
    }
  }
  const id = randomUUID();
  const ref = `PROP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const subtotal = d.line_items.reduce((s, l) => s + l.qty * l.unit_price_inr, 0);
  const gstRate = Number(d.line_items?.[0]?.unit_price_inr || 0) > 0 ? 18 : 0;
  const gst = Math.round((subtotal * gstRate) / 100);
  const total = subtotal + gst;
  await db.insert('proposals', {
    id, proposal_ref: ref, lead_id: d.lead_id || null, client_id: d.client_id || null,
    title: d.title, description: d.description ?? '', status: 'draft',
    subtotal_inr: subtotal, gst_rate: gstRate, gst_inr: gst, total_inr: total,
    currency: 'INR', payment_terms: d.payment_terms,
    valid_until: d.valid_until || null,
    created_by: req.user?.id ?? null,
    created_at: now(), updated_at: now(),
  });
  for (const li of d.line_items) {
    await db.insert('proposal_line_items', {
      id: randomUUID(), proposal_id: id,
      service_key: li.service_key, service_label: li.service_label,
      package_name: li.package_name ?? null, description: li.description ?? '',
      qty: li.qty, unit_price_inr: li.unit_price_inr,
      line_total_inr: li.qty * li.unit_price_inr,
      created_at: now(),
    });
  }
  res.json({ ok: true, id, proposal_ref: ref });
});

// PATCH /api/ops/proposals/:id
proposalsRouter.patch('/:id', async (req: Request, res: Response) => {
  const existing = (await db.list('proposals', { id: req.params.id }, 1))[0];
  if (!existing) { res.status(404).json({ ok: false, error: 'Proposal not found' }); return; }
  const allowed = ['title', 'description', 'status', 'payment_terms', 'valid_until', 'rejection_reason'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) patch[k] = req.body[k] === '' ? null : req.body[k];
  }
  if ('status' in patch) {
    const s = String(patch.status);
    const nowTs = now();
    if (s === 'sent' && existing.status === 'draft') patch.sent_at = nowTs;
    if (s === 'viewed') patch.viewed_at = nowTs;
    if (s === 'accepted' || s === 'rejected') patch.decided_at = nowTs;
  }
  patch.updated_at = now();
  await db.update('proposals', req.params.id, patch);
  res.json({ ok: true });
});

// POST /api/ops/proposals/:id/send
proposalsRouter.post('/:id/send', async (req: Request, res: Response) => {
  const row = (await db.list('proposals', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Proposal not found' }); return; }
  await db.update('proposals', req.params.id, { status: 'sent', sent_at: now(), updated_at: now() });
  res.json({ ok: true });
});

// POST /api/ops/proposals/:id/viewed
proposalsRouter.post('/:id/viewed', async (req: Request, res: Response) => {
  await db.update('proposals', req.params.id, { status: 'viewed', viewed_at: now(), updated_at: now() });
  res.json({ ok: true });
});

// POST /api/ops/proposals/:id/decide
proposalsRouter.post('/:id/decide', async (req: Request, res: Response) => {
  const { decision } = req.body ?? {};
  if (!['accepted', 'rejected'].includes(decision)) { res.status(400).json({ ok: false, error: 'decision must be accepted|rejected' }); return; }
  const patch: Record<string, unknown> = { status: decision, decided_at: now(), updated_at: now() };
  if (decision === 'rejected' && req.body?.rejection_reason) patch.rejection_reason = String(req.body.rejection_reason).slice(0, 500);
  await db.update('proposals', req.params.id, patch);
  res.json({ ok: true, status: decision });
});

// GET /api/ops/proposals/:id/pdf - Generate proposal PDF
proposalsRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  const row = (await db.list('proposals', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Proposal not found' }); return; }
  const items = await db.list('proposal_line_items', { proposal_id: req.params.id }, 200);
  const client = row.client_id ? (await db.list('clients', { id: row.client_id }, 1))[0] : null;

  const linesHtml = items.map((li) => `
    <tr>
      <td>${escapeHtml(li.service_label || li.service_name || '')}</td>
      <td style="text-align:right">${li.qty}</td>
      <td style="text-align:right">₹${li.unit_price_inr}</td>
      <td style="text-align:right">₹${li.line_total_inr}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #333; }
      .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
      .company { font-size: 18px; font-weight: bold; }
      .meta { margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th { background: #f4f4f4; text-align: left; padding: 8px; border: 1px solid #ddd; }
      td { padding: 8px; border: 1px solid #ddd; }
      .total { font-weight: bold; font-size: 14px; }
      .footer { margin-top: 30px; font-size: 10px; color: #666; }
    </style></head>
    <body>
      <div class="header">
        <div class="company">SEAI Business Ops</div>
        <div>Proposal: ${escapeHtml(row.proposal_ref)}</div>
      </div>
      <div class="meta">
        <p><strong>Client:</strong> ${client ? escapeHtml(client.brand_name) : 'N/A'}</p>
        <p><strong>Date:</strong> ${row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A'}</p>
        <p><strong>Status:</strong> ${escapeHtml(row.status)}</p>
        <p><strong>Valid Until:</strong> ${row.valid_until ? new Date(row.valid_until).toLocaleDateString() : 'N/A'}</p>
      </div>
      <table>
        <thead>
          <tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr>
        </thead>
        <tbody>${linesHtml}</tbody>
        <tfoot>
          <tr><th colspan="3" style="text-align:right">Subtotal</th><td style="text-align:right">₹${row.subtotal_inr}</td></tr>
          <tr><th colspan="3" style="text-align:right">GST (${row.gst_rate}%)</th><td style="text-align:right">₹${row.gst_inr}</td></tr>
          <tr class="total"><th colspan="3" style="text-align:right">Total</th><td style="text-align:right">₹${row.total_inr}</td></tr>
        </tfoot>
      </table>
      <div class="footer">
        <p>${escapeHtml(row.description || '')}</p>
        <p>Terms: ${escapeHtml(row.payment_terms)}</p>
      </div>
    </body>
    </html>
  `;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.proposal_ref}.pdf"`);
  res.send(html);
});
