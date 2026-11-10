import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/db.js';
import { createInquiry, now } from './service.js';
import { getOnboardingState, saveOnboardingSection, addOnboardingAsset } from './onboarding.js';
import { getProjectDetail, reviewApproval } from './delivery.js';

export const growthRouter = Router();

// ---------- rate limit (fixed window, per IP) ----------
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string): boolean {
  const nowMs = Date.now();
  const b = buckets.get(ip);
  if (!b || nowMs > b.reset) { buckets.set(ip, { count: 1, reset: nowMs + WINDOW_MS }); return true; }
  b.count += 1;
  return b.count <= MAX_PER_WINDOW;
}

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(6).max(32).regex(/^[0-9+()\-\s]+$/, 'Phone may only contain digits and + ( ) -'),
  industry: z.string().trim().max(120).optional(),
  website: z.string().trim().max(300).optional(),
  servicesRequired: z.union([z.array(z.string()).max(12), z.string().max(500)]).optional(),
  monthlyMarketingBudget: z.string().trim().max(60).optional(),
  advertisingBudget: z.string().trim().max(60).optional(),
  objective: z.string().trim().max(500).optional(),
  details: z.string().trim().max(4000).optional(),
  _gotcha: z.string().optional(), // honeypot — must stay empty
});

// POST /api/growth/inquiry — public, rate-limited, honeypot-guarded.
growthRouter.post('/inquiry', async (req: Request, res: Response) => {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  if (!rateLimit(ip)) { res.status(429).json({ ok: false, error: 'Too many submissions — please try again later.' }); return; }
  const parsed = inquirySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid submission' });
    return;
  }
  const { _gotcha, ...input } = parsed.data;
  if (_gotcha) { res.json({ ok: true, message: 'Thanks — we will be in touch shortly.' }); return; } // bot: silent accept, no store
  const ipHash = createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 16);
  const result = await createInquiry(input, ipHash);
  res.json({ ok: true, id: result.id, message: 'Thanks — we will reach out within one working day.' });
});

// ---------- client-scoped helpers ----------
async function clientFor(req: Request) {
  const user = req.user!;
  let rows = await db.list('clients', { user_id: user.id }, 1);
  if (!rows.length && user.email_verified) {
    // One-time auto-link: verified email matches the client's email.
    const byEmail = (await db.list('clients', { email: user.email.toLowerCase() }, 1))
      .concat(await db.list('clients', { billing_email: user.email.toLowerCase() }, 1));
    if (byEmail[0] && !byEmail[0].user_id) {
      await db.update('clients', byEmail[0].id, { user_id: user.id, updated_at: now() });
      rows = [{ ...byEmail[0], user_id: user.id }];
    }
  }
  return rows[0] ?? null;
}

const noClient = (res: Response) => res.status(404).json({ ok: false, error: 'No client workspace is linked to this account yet.' });

// GET /api/growth/me — client context for the dashboard
growthRouter.get('/me', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { res.json({ ok: true, client: null }); return; }
  const [agreements, projects, approvals] = await Promise.all([
    db.list('service_agreements', { client_id: client.id, status: 'active' }, 20),
    db.list('projects', { client_id: client.id }, 50),
    db.list('content_approvals', { client_id: client.id, status: 'pending' }, 50),
  ]);
  res.json({ ok: true, client: { ...client, agreements, projects, pendingApprovals: approvals.length } });
});

// GET /api/growth/me/onboarding
growthRouter.get('/me/onboarding', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  res.json({ ok: true, ...(await getOnboardingState(client.id)) });
});

// PUT /api/growth/me/onboarding/:section
growthRouter.put('/me/onboarding/:section', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const result = await saveOnboardingSection(client.id, req.params.section, req.body?.data);
  res.status(result.ok ? 200 : 400).json(result);
});

// POST /api/growth/me/onboarding/assets
growthRouter.post('/me/onboarding/assets', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const { section_key, field_key, filename, mime, data_url } = req.body ?? {};
  if (!filename || !mime || !data_url) { res.status(400).json({ ok: false, error: 'filename, mime and data_url are required' }); return; }
  const result = await addOnboardingAsset(client.id, { section_key, field_key, filename, mime, data_url });
  res.status(result.ok ? 200 : 400).json(result);
});

// GET /api/growth/me/projects
growthRouter.get('/me/projects', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const projects = await db.list('projects', { client_id: client.id }, 100);
  const withTasks = await Promise.all(projects.map(async (p) => {
    const tasks = await db.list('project_tasks', { project_id: p.id }, 200);
    tasks.sort((a, b) => Number(a.seq) - Number(b.seq));
    const done = tasks.filter((t) => t.status === 'done').length;
    return { ...p, tasks, progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }));
  res.json({ ok: true, projects: withTasks });
});

growthRouter.get('/me/projects/:id', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const detail = await getProjectDetail(req.params.id);
  if (!detail || detail.project.client_id !== client.id) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  res.json({ ok: true, ...detail });
});

// Approvals (client reviews)
growthRouter.get('/me/approvals', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const items = await db.list('content_approvals', { client_id: client.id }, 200);
  res.json({ ok: true, approvals: items });
});

growthRouter.post('/me/approvals/:id/review', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const row = (await db.list('content_approvals', { id: req.params.id }, 1))[0];
  if (!row || row.client_id !== client.id) { res.status(404).json({ ok: false, error: 'Approval item not found' }); return; }
  const decision = String(req.body?.decision ?? '');
  if (!['approved', 'rejected'].includes(decision)) { res.status(400).json({ ok: false, error: 'decision must be approved|rejected' }); return; }
  const result = await reviewApproval(row.id, decision as 'approved' | 'rejected', req.body?.feedback, req.user!.id);
  res.json(result);
});

// Advertising reports — source labelled; never invented metrics
growthRouter.get('/me/reports', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const reports = await db.list('campaign_reports', { client_id: client.id }, 200);
  res.json({ ok: true, reports, dataSources: ['manual', 'meta_api', 'google_ads_api'], liveIntegrations: false });
});

// Billing — agreements, invoices, downloadable HTML
growthRouter.get('/me/billing', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const [agreements, invoices] = await Promise.all([
    db.list('service_agreements', { client_id: client.id }, 20),
    db.list('invoices', { client_id: client.id }, 200),
  ]);
  invoices.sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
  res.json({ ok: true, agreements, invoices });
});

// ---------- Razorpay subscriptions (client authorises the mandate) ----------
// POST /me/subscriptions/create creates (or reuses) the Razorpay subscription
// for one of the client's own agreements and returns keyId + razorpaySubscriptionId.
// The browser opens Razorpay Checkout with subscription_id, then calls
// /me/subscriptions/verify with the handler response — verification happens
// server-to-server with Razorpay, never on client claims.
growthRouter.post('/me/subscriptions/create', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const agreementId = String(req.body?.agreementId ?? '').trim();
  if (!agreementId) { res.status(400).json({ ok: false, error: 'agreementId is required' }); return; }
  const agreement = (await db.list('service_agreements', { id: agreementId, client_id: client.id }, 1))[0];
  if (!agreement) { res.status(404).json({ ok: false, error: 'Agreement not found for this account' }); return; }
  const { createAgreementSubscription } = await import('./billing.js');
  const result = await createAgreementSubscription(agreementId);
  if (!result.ok) {
    const msg = (result as { error?: string }).error ?? 'Could not create a subscription';
    res.status(msg.startsWith('Payments') || msg.includes('unreachable') ? 503 : 400).json({ ok: false, error: msg });
    return;
  }
  const { subscriptionId, razorpaySubscriptionId, keyId, amountPaise, currency, planName } = result as unknown as { subscriptionId: string; razorpaySubscriptionId: string; keyId: string; amountPaise: number; currency: string; planName: string };
  res.json({ ok: true, subscriptionId, razorpaySubscriptionId, keyId, amountPaise, currency, planName });
});

growthRouter.post('/me/subscriptions/verify', async (req: Request, res: Response) => {
  // Authenticated client context only; the mandate itself is verified by
  // seai.payments against Razorpay (HMAC + live subscription fetch).
  if (!req.user) { res.status(401).json({ ok: false, error: 'Authentication required' }); return; }
  const payload = {
    razorpayPaymentId: String(req.body?.razorpayPaymentId ?? '').trim(),
    razorpaySubscriptionId: String(req.body?.razorpaySubscriptionId ?? '').trim(),
    razorpaySignature: String(req.body?.razorpaySignature ?? '').trim(),
  };
  if (!payload.razorpayPaymentId || !payload.razorpaySubscriptionId || !payload.razorpaySignature) {
    res.status(400).json({ ok: false, error: 'razorpayPaymentId, razorpaySubscriptionId and razorpaySignature are required' });
    return;
  }
  const { verifyAgreementSubscription } = await import('./billing.js');
  const result = await verifyAgreementSubscription(payload);
  if (!result.ok) { res.status(400).json({ ok: false, error: (result as { error?: string }).error }); return; }
  res.json({ ok: true, status: (result as { status?: string }).status ?? 'active' });
});

growthRouter.get('/me/invoices/:number/download', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const invoice = (await db.list('invoices', { number: req.params.number, client_id: client.id }, 1))[0];
  if (!invoice) { res.status(404).send('Invoice not found'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderInvoiceHtml(invoice, client));
});

// Support requests
growthRouter.get('/me/support', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const requests = await db.list('support_requests', { client_id: client.id }, 100);
  const withMessages = await Promise.all(requests.map(async (r) => ({
    ...r, messages: (await db.list('support_messages', { request_id: r.id }, 200)).reverse(),
  })));
  res.json({ ok: true, requests: withMessages });
});

growthRouter.post('/me/support', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const subject = String(req.body?.subject ?? '').trim().slice(0, 200);
  const body = String(req.body?.body ?? '').trim().slice(0, 4000);
  if (subject.length < 3 || body.length < 3) { res.status(400).json({ ok: false, error: 'Subject and message are required' }); return; }
  const id = randomUUID();
  await db.insert('support_requests', { id, client_id: client.id, subject, body, status: 'open', priority: String(req.body?.priority ?? 'normal'), created_at: now(), updated_at: now() });
  await db.insert('support_messages', { id: randomUUID(), request_id: id, sender_id: req.user!.id, sender_role: 'client', body, created_at: now() });
  res.json({ ok: true, id });
});

growthRouter.post('/me/support/:id/messages', async (req: Request, res: Response) => {
  const client = await clientFor(req);
  if (!client) { noClient(res); return; }
  const r = (await db.list('support_requests', { id: req.params.id, client_id: client.id }, 1))[0];
  if (!r) { res.status(404).json({ ok: false, error: 'Request not found' }); return; }
  const body = String(req.body?.body ?? '').trim().slice(0, 4000);
  if (!body) { res.status(400).json({ ok: false, error: 'Message is required' }); return; }
  await db.insert('support_messages', { id: randomUUID(), request_id: r.id, sender_id: req.user!.id, sender_role: 'client', body, created_at: now() });
  await db.update('support_requests', r.id, { updated_at: now() });
  res.json({ ok: true });
});

// Notifications
growthRouter.get('/me/notifications', async (req: Request, res: Response) => {
  const items = await db.list('notifications', { user_id: req.user!.id }, 100);
  res.json({ ok: true, notifications: items });
});
growthRouter.post('/me/notifications/:id/read', async (req: Request, res: Response) => {
  const n = (await db.list('notifications', { id: req.params.id, user_id: req.user!.id }, 1))[0];
  if (!n) { res.status(404).json({ ok: false, error: 'Notification not found' }); return; }
  await db.update('notifications', n.id, { read_at: now() });
  res.json({ ok: true });
});

// ---------- invoice HTML renderer (shared with staff download) ----------
export function renderInvoiceHtml(invoice: Record<string, any>, client: Record<string, any>): string {
  const lines: { label: string; qty: number; unit_inr: number }[] = parseJsonArrayLines(invoice.line_items);
  const money = (n: unknown) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;
  const rows = lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${l.qty}</td><td class="r">${money(l.unit_inr)}</td><td class="r">${money(l.qty * l.unit_inr)}</td></tr>`).join('');
  const adBudget = invoice.kind === 'ad_budget';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(invoice.number)} — SEAI</title>
<style>
@page { margin: 18mm; }
body { font: 14px/1.55 Georgia, serif; color:#111; max-width: 860px; margin: 0 auto; padding: 32px; }
.brand { display:flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 14px; }
.brand b { font-size: 26px; letter-spacing: 6px; }
.tag { font-style: italic; color:#555; font-size: 11px; }
h1 { font-size: 20px; margin: 22px 0 4px; }
.muted { color:#555; font-size: 12px; }
table { width:100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
th, td { border-bottom: 1px solid #ddd; padding: 8px 6px; text-align: left; }
th { background:#f5f5f5; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.r { text-align: right; }
.totals td { border: none; }
.note { margin-top: 18px; font-size: 11.5px; color:#444; border-left: 3px solid #111; padding: 8px 12px; background:#fafafa; }
.print { margin-top: 22px; }
@media print { .print { display: none; } body { padding: 0; } }
button { background:#111; color:#fff; border:0; padding: 10px 18px; border-radius: 6px; cursor:pointer; font-size: 13px; }
</style></head><body>
<div class="brand"><div><b>SEAI</b><div class="tag">Get Exposed. But in a Good Way.</div></div>
<div class="muted" style="text-align:right">SEAI · Marketing, Advertising &amp; Growth<br/>seai.store · workwithseai@gmail.com</div></div>
<h1>Invoice ${esc(invoice.number)}</h1>
<div class="muted">Issued ${esc(invoice.issued_at ?? '')} · Due ${esc(invoice.due_at ?? '')} · Status: <b>${esc(invoice.status)}</b>${adBudget ? ' · <b>CLIENT-FUNDED (not SEAI revenue)</b>' : ''}</div>
<table>
<tr><th>Bill to</th><td><b>${esc(client.legal_name || client.brand_name)}</b><br/>${esc(client.address ?? '')}<br/>${client.gstin ? `GSTIN: ${esc(client.gstin)}<br/>` : ''}${esc(client.billing_email || client.email || '')}</td></tr>
</table>
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot class="totals">
<tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(invoice.subtotal_inr)}</td></tr>
<tr><td colspan="3" class="r">GST${Number(invoice.gst_rate) ? ` @ ${invoice.gst_rate}%` : ' (not applicable)'}</td><td class="r">${money(invoice.gst_inr)}</td></tr>
<tr><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${money(invoice.total_inr)}</b></td></tr>
</tfoot></table>
${adBudget ? '<div class="note">This invoice records an advertising budget payable by the client to advertising platforms (Meta/Google) or as reimbursement where agreed in writing. It is accounted for separately from SEAI service fees and is never recognised as SEAI revenue. SEAI does not mark up ad spend.</div>' : '<div class="note">SEAI service fee. Amounts exclusive of GST where applicable; GST shown separately. Payment terms: due within 7 days of issue. No payment, no work — per the signed Scope of Work.</div>'}
<div class="print"><button onclick="window.print()">Download / Save as PDF</button></div>
</body></html>`;
}

function parseJsonArrayLines(v: unknown): { label: string; qty: number; unit_inr: number }[] {
  try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p : []; } catch { return []; }
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
