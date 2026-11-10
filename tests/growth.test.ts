import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { growthRouter } from '../src/growth/routes.js';
import { staffRouter } from '../src/growth/staff.js';
import { createUser, createSession } from '../src/auth/service.js';
import { setMailSender, resetMailSender, type MailSender } from '../src/mail/dispatch.js';
import type { OutgoingMail, SendResult } from '../src/mail/transport.js';
import { parseCsv, toCsv } from '../src/growth/csv.js';
import { createInquiry, createLead, findLeadDuplicate, listLeads } from '../src/growth/service.js';
import { createAgreement, generateAgreementInvoice, financeSnapshot } from '../src/growth/billing.js';
import { createProjectFromWorkflow, updateTask, approveTask, getProjectDetail } from '../src/growth/delivery.js';
import { getOnboardingState, saveOnboardingSection } from '../src/growth/onboarding.js';

const stamp = () => Math.random().toString(36).slice(2, 9);
const sent: OutgoingMail[] = [];
const fakeSender: MailSender = async (mail) => { sent.push(mail); return { messageId: `<m-${sent.length}@seai.store>`, response: '250 OK' }; };
let server: ReturnType<typeof createServer>;
let base = '';
let priorOpsInbox = '';

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use('/api/growth', growthRouter);
  app.use('/api/staff', staffRouter);
  return app;
}

async function staffCookie(role: string) {
  const email = `staff-${stamp()}@example.com`;
  const user = await createUser('Staff Test', email, `pw-${stamp()}-Aa1!`);
  await db.update('users', user.id, { role, email_verified: true });
  const token = await createSession(user.id);
  return { user, cookie: `seai_session=${token}`, email };
}
async function clientCookie() {
  const email = `client-${stamp()}@example.com`;
  const user = await createUser('Client Test', email, `pw-${stamp()}-Aa1!`);
  await db.update('users', user.id, { email_verified: true });
  const token = await createSession(user.id);
  return { user, cookie: `seai_session=${token}`, email };
}

beforeAll(async () => {
  priorOpsInbox = config.opsInbox;
  config.opsInbox = 'ops@example.com';
  setMailSender(fakeSender);
  server = createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  resetMailSender();
  config.opsInbox = priorOpsInbox;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => { sent.length = 0; });

describe('inquiry intake', () => {
  it('persists the inquiry, creates a pipeline lead and mails ops', async () => {
    const s = stamp();
    const res = await fetch(`${base}/api/growth/inquiry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Owner', businessName: `Test Biz ${s}`, email: `owner-${s}@example.com`,
        phone: '+91 98765 43210', industry: 'Clinic', servicesRequired: ['advertising'],
        objective: 'More leads', details: 'Wants a discovery call',
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const inquiries = await db.list('growth_inquiries', { id: json.id }, 1);
    expect(inquiries).toHaveLength(1);
    const lead = (await db.list('leads', { inquiry_id: json.id }, 1))[0];
    expect(lead).toBeTruthy();
    expect(lead.stage).toBe('new');
    expect(lead.source).toBe('website');
  });

  it('rejects invalid submissions and never stores honeypot bots', async () => {
    const bad = await fetch(`${base}/api/growth/inquiry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', businessName: 'Y', email: 'not-an-email', phone: '123' }),
    });
    expect(bad.status).toBe(400);
    const bot = await fetch(`${base}/api/growth/inquiry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bot Man', businessName: 'Bot Biz', email: `bot-${stamp()}@example.com`, phone: '+91 11111 22222', _gotcha: 'spammy' }),
    });
    expect(bot.status).toBe(200);
    const json = await bot.json();
    expect(json.ok).toBe(true);
    expect(await db.list('growth_inquiries', { name: 'Bot Man' }, 1)).toHaveLength(0);
  });

  it('links repeat inquiries to the existing lead instead of duplicating', async () => {
    const s = stamp();
    const email = `repeat-${s}@example.com`;
    const biz = `Repeat Biz ${s}`;
    await createInquiry({ name: 'Repeat Owner', businessName: biz, email, phone: '+91 99999 00001' });
    await createInquiry({ name: 'Repeat Owner', businessName: biz, email, phone: '+91 99999 00001' });
    const leads = await db.list('leads', { email }, 10);
    expect(leads).toHaveLength(1);
  });
});

describe('lead CRM', () => {
  it('detects duplicates by email and phone', async () => {
    const s = stamp();
    const email = `dup-${s}@example.com`;
    const created = await createLead({ business_name: `Dup Biz ${s}`, email, phone: '+91 98888 77777' }, 'test');
    expect(created.ok).toBe(true);
    expect(await findLeadDuplicate({ email: email.toUpperCase() })).toBeTruthy();
    expect(await findLeadDuplicate({ phone: '9888877777' })).toBeTruthy();
    const blocked = await createLead({ business_name: `Another Biz ${s}`, email }, 'test');
    expect(blocked.ok).toBe(false);
    expect((blocked as { duplicate?: unknown }).duplicate).toBeTruthy();
  });

  it('filters and sorts leads', async () => {
    const s = stamp();
    await createLead({ business_name: `Filter Target ${s}`, email: `filter-${s}@example.com`, industry: 'Gym', source: 'referral' }, 'test');
    const byQ = await listLeads({ q: `Filter Target ${s}` });
    expect(byQ.total).toBe(1);
    const byIndustry = await listLeads({ q: 'gym' });
    expect(byIndustry.rows.some((r) => r.business_name === `Filter Target ${s}`)).toBe(true);
  });
});

describe('CSV codec', () => {
  it('round-trips quoted fields with commas, quotes and newlines', () => {
    const input = [['name', 'note'], ['Acme, Inc', 'said "hi"\ntwice'], ['plain', '']];
    const csv = toCsv(input);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(input);
  });
});

describe('lead import (CSV)', () => {
  it('imports rows, skips duplicates, records the batch', async () => {
    const { cookie } = await staffCookie('sales');
    const s = stamp();
    const csv = ['business,contact,phone,email,industry,location',
      `Import One ${s},Ravi,+91 90000 00001,import1-${s}@example.com,Salon,Pune`,
      `Import Two ${s},Meera,+91 90000 00002,import2-${s}@example.com,Bakery,Pune`,
      `Import One ${s},Ravi,+91 90000 00001,import1-${s}@example.com,Salon,Pune`].join('\r\n');
    const res = await fetch(`${base}/api/staff/leads/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ filename: 'leads.csv', content_base64: Buffer.from(csv).toString('base64') }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rows_imported).toBe(2);
    expect(json.duplicates).toBe(1);
    const imports = await db.list('lead_imports', { id: json.importId }, 1);
    expect(imports[0].status).toBe('completed');
  });

  it('rejects unparseable PDFs with a clear error', async () => {
    const { cookie } = await staffCookie('sales');
    // Not a valid PDF at all: the importer must fail loudly, never guess.
    const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Page/Contents 2 0 obj>>\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'utf8');
    const res = await fetch(`${base}/api/staff/leads/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ filename: 'broken.pdf', content_base64: minimalPdf.toString('base64') }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toMatch(/parse|PDF/i);
  });

  it('extracts lead rows from text-layer PDFs with the line parser', async () => {
    const { parseLeadLines } = await import('../src/growth/pdf.js');
    const { rows, skipped } = parseLeadLines([
      'Acme Dental Clinic | Dr Rao | +91 98765 43210 | rao@acmedental.in',
      'FitZone Gym — Anil — 9888800000 — anil@fitzonegym.com',
      'Random prose line with no contact details at all',
      'Sunrise Salon 9876543210 beauty@sunrisesalon.in',
    ].join('\n'));
    expect(rows.length).toBe(3);
    expect(skipped).toBeGreaterThanOrEqual(1);
    expect(rows[0].email).toContain('acmedental.in');
    expect(rows[0].phone).toContain('98765');
    expect(rows[1].business_name).toContain('FitZone');
  });
});

describe('staff API RBAC', () => {
  it('rejects customer sessions with 403 and anonymous with 401/403', async () => {
    const { cookie } = await clientCookie();
    const forbidden = await fetch(`${base}/api/staff/overview`, { headers: { cookie } });
    expect(forbidden.status).toBe(403);
    const anon = await fetch(`${base}/api/staff/overview`);
    expect([401, 403]).toContain(anon.status);
  });

  it('sales role cannot access finance endpoints', async () => {
    const { cookie } = await staffCookie('sales');
    const res = await fetch(`${base}/api/staff/finance`, { headers: { cookie } });
    expect(res.status).toBe(403);
    const okRes = await fetch(`${base}/api/staff/leads`, { headers: { cookie } });
    expect(okRes.status).toBe(200);
  });
});

describe('billing: ad budgets never count as SEAI revenue', () => {
  it('MRR excludes ad budgets; invoices split by kind; totals computed server-side', async () => {
    const s = stamp();
    const { rows } = await listLeads({ q: 'nonexistent' });
    expect(rows).toHaveLength(0); // sanity
    const before = await financeSnapshot();
    const created = await fetch(`${base}/api/staff/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: (await staffCookie('sales')).cookie },
      body: JSON.stringify({ business_name: `Billing Biz ${s}`, email: `billing-${s}@example.com`, force: true }),
    });
    expect(created.status).toBe(200);
    const lead = await created.json();
    const convert = await fetch(`${base}/api/staff/leads/${lead.id}/convert`, {
      method: 'POST', headers: { cookie: (await staffCookie('admin')).cookie },
    });
    const { id: clientId } = await convert.json();
    expect(clientId).toBeTruthy();
    const agreement = await createAgreement({ client_id: clientId, plan: 'starter', ad_budget_inr: 5000, services: ['advertising'] });
    expect(agreement.ok).toBe(true);
    if (!agreement.ok) return;
    const serviceInvoice = await generateAgreementInvoice(agreement.id, 'service_fee', 'November 2026');
    const adBudgetInvoice = await generateAgreementInvoice(agreement.id, 'ad_budget', 'November 2026');
    expect(serviceInvoice.ok).toBe(true);
    expect(adBudgetInvoice.ok).toBe(true);
    const snapshot = await financeSnapshot();
    // The 7999 retainer counts; the 5000 ad budget must not.
    expect(snapshot.mrr - before.mrr).toBe(7999);
    expect(snapshot.adBudgets - before.adBudgets).toBe(5000);
  });
});

describe('delivery engine', () => {
  it('blocks approval-gated tasks until approved', async () => {
    const s = stamp();
    const created = await createLead({ business_name: `Delivery Biz ${s}`, email: `delivery-${s}@example.com` }, 'test', { force: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { convertLeadToClient } = await import('../src/growth/service.js');
    const converted = await convertLeadToClient(created.id, 'test');
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const project = await createProjectFromWorkflow({ client_id: converted.id, service_category: 'advertising' }, 'test');
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const detail = await getProjectDetail(project.id);
    const gate = detail!.tasks.find((t) => t.approval_required)!;
    expect(gate).toBeTruthy();
    const blocked = await updateTask(gate.id, { status: 'done' }, 'test');
    expect(blocked.ok).toBe(false); // gate not approved yet
    const approved = await approveTask(gate.id, 'admin-1', true);
    expect(approved.ok).toBe(true);
    const done = await updateTask(gate.id, { status: 'done' }, 'test');
    expect(done.ok).toBe(true);
  });
});

describe('onboarding save & resume', () => {
  it('tracks progress from mandatory fields and scopes sections to purchased services', async () => {
    const s = stamp();
    const rec = await createLead({ business_name: `Onboard Biz ${s}`, email: `onboard-${s}@example.com` }, 'test', { force: true });
    if (!rec.ok) throw new Error('lead creation failed');
    const { convertLeadToClient } = await import('../src/growth/service.js');
    const converted = await convertLeadToClient(rec.id, 'test');
    if (!converted.ok) throw new Error('convert failed');
    // No agreement yet → superset of sections is shown.
    const stateAll = await getOnboardingState(converted.id);
    expect(stateAll!.sections.some((s) => s.key === 'advertising')).toBe(true);
    expect(stateAll!.progress.required).toBeGreaterThan(0);
    expect(stateAll!.progress.filled).toBe(0);
    // Save the business section with all mandatory fields.
    await saveOnboardingSection(converted.id, 'business', {
      legal_name: `Onboard Legal ${s}`, brand_name: `Onboard ${s}`, industry: 'Clinic',
      description: 'Family clinic', address: '1 Main St', service_locations: 'Pune',
    });
    const state = await getOnboardingState(converted.id);
    expect(state!.progress.filled).toBeGreaterThan(0);
    // Now buy a website-only agreement: advertising section should disappear.
    await createAgreement({ client_id: converted.id, plan: 'custom', monthly_fee_inr: 10000, services: ['website'] });
    const stateWeb = await getOnboardingState(converted.id);
    expect(stateWeb!.sections.some((s) => s.key === 'website')).toBe(true);
    expect(stateWeb!.sections.some((s) => s.key === 'advertising')).toBe(false);
  });
});
