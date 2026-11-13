import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';
import { createOrder, isConfigured as razorpayConfigured } from '../payments/razorpay.js';

export const financeRouter = Router();
financeRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'finance'));

const invoiceSchema = z.object({
  client_id: z.string().trim().min(1),
  agreement_id: z.string().trim().optional().or(z.literal('')),
  kind: z.enum(['service_fee', 'ad_budget', 'one_time', 'third_party', 'other']).default('service_fee'),
  description: z.string().trim().min(3).max(300),
  lines: z.array(z.object({
    label: z.string().trim().min(1).max(300),
    qty: z.coerce.number().min(0.01),
    unit_inr: z.coerce.number().min(0),
  })).min(1).max(50),
  gst_rate: z.coerce.number().min(0).max(30).optional(),
  due_in_days: z.coerce.number().min(0).default(7),
});

// GET /api/ops/finance/invoices
financeRouter.get('/invoices', async (req: Request, res: Response) => {
  const { status, kind, client_id } = req.query;
  let rows = await db.list('invoices', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (client_id) rows = rows.filter((r) => r.client_id === client_id);
  rows.sort((a: any, b: any) => String(b.issued_at).localeCompare(String(a.issued_at)));
  res.json({ ok: true, invoices: rows.slice(0, 500), total: rows.length });
});

// GET /api/ops/finance/invoices/:id
financeRouter.get('/invoices/:id', async (req: Request, res: Response) => {
  const invoice = (await db.list('invoices', { id: req.params.id }, 1))[0];
  if (!invoice) { res.status(404).json({ ok: false, error: 'Invoice not found' }); return; }
  const client = (await db.list('clients', { id: invoice.client_id }, 1))[0] ?? {};
  res.json({ ok: true, invoice, client });
});

// POST /api/ops/finance/invoices
financeRouter.post('/invoices', async (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid invoice' }); return; }
  const d = parsed.data;
  const client = (await db.list('clients', { id: d.client_id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const lines = d.lines.map((l) => ({ label: String(l.label).trim(), qty: Math.max(0, Number(l.qty) || 0), unit_inr: Math.max(0, Number(l.unit_inr) || 0) })).filter((l) => l.label && l.qty > 0);
  if (!lines.length) { res.status(400).json({ ok: false, error: 'At least one valid line item is required' }); return; }
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_inr, 0);
  const gstRate = Number.isFinite(d.gst_rate ?? 0) ? Number(d.gst_rate) : (client.gstin ? 18 : 0);
  const gst = Math.round((subtotal * gstRate) / 100);
  const total = subtotal + gst;
  const id = randomUUID();
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const all = await db.list('invoices', {}, 10000);
  const max = all.map((i) => String(i.number ?? '')).filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
  const number = `${prefix}${String(max + 1).padStart(4, '0')}`;
  const issued = now().slice(0, 10);
  const due = new Date(Date.now() + d.due_in_days * 86400000).toISOString().slice(0, 10);
  await db.insert('invoices', {
    id, number, client_id: d.client_id, agreement_id: d.agreement_id || null,
    kind: d.kind, description: d.description.trim(), line_items: JSON.stringify(lines),
    subtotal_inr: subtotal, gst_rate: gstRate, gst_inr: gst, total_inr: total,
    currency: 'INR', status: 'draft', issued_at: issued, due_at: due, created_at: now(),
  });
  res.json({ ok: true, id, number, total_inr: total });
});

// PATCH /api/ops/finance/invoices/:id
financeRouter.patch('/invoices/:id', async (req: Request, res: Response) => {
  const invoice = (await db.list('invoices', { id: req.params.id }, 1))[0];
  if (!invoice) { res.status(404).json({ ok: false, error: 'Invoice not found' }); return; }
  const allowed = ['status', 'paid_at', 'razorpay_payment_id', 'razorpay_order_id', 'description', 'due_at'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) patch[k] = req.body[k] === '' ? null : req.body[k];
  }
  if (patch.status === 'paid' && !patch.paid_at) patch.paid_at = now();
  await db.update('invoices', req.params.id, patch);
  res.json({ ok: true });
});

// POST /api/ops/finance/invoices/:id/razorpay-order — Create a Razorpay order for the invoice
// Returns the Razorpay order id and amount (paise) for the client to pay via Razorpay Checkout.
// Invoice status is NOT changed here — it moves to 'paid' only on verified webhook.
financeRouter.post('/invoices/:id/razorpay-order', async (req: Request, res: Response) => {
  if (!razorpayConfigured()) {
    res.status(503).json({ ok: false, error: 'Razorpay is not configured' });
    return;
  }
  const invoice = (await db.list('invoices', { id: req.params.id }, 1))[0];
  if (!invoice) { res.status(404).json({ ok: false, error: 'Invoice not found' }); return; }
  if (invoice.status === 'paid') {
    res.status(400).json({ ok: false, error: 'Invoice is already paid' });
    return;
  }
  try {
    const order = await createOrder({
      amountInr: Number(invoice.total_inr ?? 0),
      currency: invoice.currency ?? 'INR',
      receipt: invoice.number,
      notes: {
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        client_id: invoice.client_id,
      },
    });
    await db.update('invoices', req.params.id, {
      razorpay_order_id: order.id,
    });
    res.json({
      ok: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      receipt: order.receipt,
    });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: String(err?.message ?? err).slice(0, 400) });
  }
});

// GET /api/ops/finance/snapshot
financeRouter.get('/snapshot', async (_req: Request, res: Response) => {
  const { financeSnapshot } = await import('../growth/billing.js');
  const snapshot = await financeSnapshot();
  const expenses = await db.list('expenses', {}, 1000);
  expenses.sort((a: any, b: any) => String(b.incurred_at).localeCompare(String(a.incurred_at)));
  res.json({ ok: true, ...snapshot, expenses: expenses.slice(0, 100) });
});

const expenseSchema = z.object({
  category: z.enum(['payroll', 'contractor', 'software', 'tools', 'office', 'other']),
  description: z.string().trim().min(2).max(300),
  amount_inr: z.coerce.number().min(0.01),
  incurred_at: z.string().trim().max(30),
  recurring: z.boolean().optional(),
});

// POST /api/ops/finance/expenses
financeRouter.post('/expenses', async (req: Request, res: Response) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid expense' }); return; }
  const id = randomUUID();
  await db.insert('expenses', { ...parsed.data, recurring: Boolean(parsed.data.recurring), id, created_at: now() });
  res.json({ ok: true, id });
});

// GET /api/ops/finance/expenses - List expenses
financeRouter.get('/expenses', async (req: Request, res: Response) => {
  const { category } = req.query;
  let rows = await db.list('expenses', {}, 10000);
  if (category) rows = rows.filter((r) => r.category === category);
  rows.sort((a: any, b: any) => String(b.incurred_at).localeCompare(String(a.incurred_at)));
  res.json({ ok: true, expenses: rows.slice(0, 500), total: rows.length });
});

// POST /api/ops/finance/invoices/transition-overdue - Auto-transition overdue invoices
// Marks 'sent' invoices as 'overdue' when due_at has passed. Safe to call repeatedly (cron target).
financeRouter.post('/invoices/transition-overdue', async (_req: Request, res: Response) => {
  const nowIso = now();
  const invoices = await db.list('invoices', {}, 10000);
  let transitioned = 0;
  for (const inv of invoices) {
    if (inv.status !== 'sent') continue;
    if (!inv.due_at) continue;
    if (String(inv.due_at) < nowIso) {
      await db.update('invoices', inv.id, { status: 'overdue', updated_at: now() });
      transitioned++;
    }
  }
  res.json({ ok: true, transitioned });
});
