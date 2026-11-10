import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { PLAN_CATALOGUE, SERVICE_KEYS } from './constants.js';
import { now } from './service.js';
import { createPaymentsSubscription, verifyPaymentsSubscription, cancelPaymentsSubscription } from '../payments/client.js';

const SUBSCRIPTION_PLAN_BY_AGREEMENT: Record<string, 'retainer_starter' | 'retainer_growth' | 'retainer_scale'> = {
  starter: 'retainer_starter',
  growth: 'retainer_growth',
  scale: 'retainer_scale',
};

/** Razorpay plan key for an agreement, or null for custom (invoice-billed) agreements. */
export function subscriptionPlanFor(agreement: { plan?: string | null; monthly_fee_inr?: unknown }): { planKey: 'retainer_starter' | 'retainer_growth' | 'retainer_scale'; amountInr: number } | null {
  const planKey = SUBSCRIPTION_PLAN_BY_AGREEMENT[String(agreement?.plan ?? '').toLowerCase()] ?? null;
  if (!planKey) return null;
  const catalogue = PLAN_CATALOGUE.find((p) => `retainer_${p.key}` === planKey);
  const fee = Number(agreement?.monthly_fee_inr ?? catalogue?.monthlyFeeInr ?? 0);
  // Custom amounts are not subscription-billable: amounts are server-side
  // authoritative, never client-supplied. Surface the mismatch to staff.
  if (!catalogue || fee !== catalogue.monthlyFeeInr) return null;
  return { planKey, amountInr: catalogue.monthlyFeeInr };
}

export async function createAgreementSubscription(agreementId: string) {
  const agreement = (await db.list('service_agreements', { id: agreementId }, 1))[0];
  if (!agreement) return { ok: false as const, error: 'Agreement not found' };
  const client = (await db.list('clients', { id: agreement.client_id }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  if (agreement.status !== 'active') return { ok: false as const, error: 'Agreement is not active' };
  const mapping = subscriptionPlanFor(agreement);
  if (!mapping) {
    return {
      ok: false as const,
      error: 'This agreement cannot use Razorpay subscriptions (custom amounts are invoice-billed). Ask staff to issue an invoice instead.',
    };
  }
  const email = String(client.billing_email || client.email || '').trim();
  if (!email) return { ok: false as const, error: 'Client has no billing email — set one before creating a subscription' };
  try {
    const created = await createPaymentsSubscription({
      planKey: mapping.planKey,
      seaiClientId: client.id,
      seaiSubscriptionId: agreement.id,
      email,
      name: String(client.brand_name || client.legal_name || ''),
      phone: String(client.phone || ''),
      idempotencyKey: `agr_${agreement.id}`,
    });
    await db.update('service_agreements', agreement.id, {
      razorpay_subscription_id: created.razorpaySubscriptionId,
    });
    return { ok: true as const, ...created };
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message ?? err).slice(0, 400) };
  }
}

export async function verifyAgreementSubscription(input: { razorpayPaymentId: string; razorpaySubscriptionId: string; razorpaySignature: string }) {
  try {
    const result = await verifyPaymentsSubscription(input);
    return { ok: true as const, status: result.status };
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message ?? err).slice(0, 400) };
  }
}

export async function cancelAgreementSubscription(agreementId: string, reason?: string) {
  const agreement = (await db.list('service_agreements', { id: agreementId }, 1))[0];
  if (!agreement) return { ok: false as const, error: 'Agreement not found' };
  if (!agreement.razorpay_subscription_id) return { ok: false as const, error: 'No Razorpay subscription linked' };
  try {
    const result = await cancelPaymentsSubscription(agreement.razorpay_subscription_id, { cancelAtCycleEnd: true, reason });
    return { ok: true as const, status: result.status };
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message ?? err).slice(0, 400) };
  }
}

export interface AgreementInput {
  client_id: string;
  plan: string;                 // starter|growth|scale|custom
  name?: string;
  services?: string[];
  monthly_fee_inr?: number;     // defaults to plan catalogue price; custom must pass explicitly
  ad_budget_inr?: number | null;
  start_date?: string;
  contract_months?: number | null;
  renewal_terms?: string | null;
  billing_frequency?: string;
}

export async function createAgreement(input: AgreementInput) {
  const client = (await db.list('clients', { id: input.client_id }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const plan = PLAN_CATALOGUE.find((p) => p.key === input.plan);
  if (!plan && input.plan !== 'custom') return { ok: false as const, error: 'Unknown plan' };
  const fee = input.monthly_fee_inr ?? plan?.monthlyFeeInr ?? 0;
  if (!Number.isFinite(fee) || fee < 0) return { ok: false as const, error: 'Invalid monthly fee' };
  const services = Array.isArray(input.services) ? input.services.filter((s) => SERVICE_KEYS.includes(s)) : [];
  const start = input.start_date || new Date().toISOString().slice(0, 10);
  const id = randomUUID();
  await db.insert('service_agreements', {
    id, client_id: input.client_id, plan: input.plan,
    name: input.name?.trim() || (plan ? `SEAI ${plan.name}` : 'Custom agreement'),
    services: JSON.stringify(services),
    monthly_fee_inr: fee,
    ad_budget_inr: input.ad_budget_inr ?? null,
    billing_frequency: input.billing_frequency || 'monthly',
    start_date: start,
    renewal_date: addMonths(start, 1),
    contract_months: input.contract_months ?? null,
    renewal_terms: input.renewal_terms ?? 'Auto-renews monthly; 15-day written notice to cancel',
    status: 'active', razorpay_subscription_id: null,
    created_at: now(),
  });
  return { ok: true as const, id };
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const rupees = (n: unknown): number => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? Math.round(v) : 0;
};

export interface InvoiceLine { label: string; qty: number; unit_inr: number; }

export async function createInvoice(input: {
  client_id: string; agreement_id?: string | null; kind: string;
  description: string; lines: InvoiceLine[]; gst_rate?: number; due_in_days?: number;
}) {
  const client = (await db.list('clients', { id: input.client_id }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const lines = (input.lines ?? [])
    .map((l) => ({ label: String(l.label ?? '').trim(), qty: Math.max(0, Number(l.qty) || 0), unit_inr: Math.max(0, Number(l.unit_inr) || 0) }))
    .filter((l) => l.label && l.qty > 0);
  if (!lines.length) return { ok: false as const, error: 'At least one valid line item is required' };
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_inr, 0);
  const gstRate = Number.isFinite(input.gst_rate as number) ? Number(input.gst_rate) : (client.gstin ? 18 : 0);
  const gst = Math.round((subtotal * gstRate) / 100);
  const total = subtotal + gst;
  const id = randomUUID();
  const number = await nextInvoiceNumber();
  const issued = now().slice(0, 10);
  const due = new Date(Date.now() + (input.due_in_days ?? 7) * 86400000).toISOString().slice(0, 10);
  await db.insert('invoices', {
    id, number, client_id: input.client_id, agreement_id: input.agreement_id ?? null,
    kind: input.kind, description: input.description.trim(),
    line_items: JSON.stringify(lines),
    subtotal_inr: subtotal, gst_rate: gstRate, gst_inr: gst, total_inr: total,
    currency: 'INR', status: 'draft', issued_at: issued, due_at: due,
    created_at: now(),
  });
  return { ok: true as const, id, number, total_inr: total };
}

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const all = await db.list('invoices', {}, 10000);
  const max = all
    .map((i) => String(i.number ?? ''))
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Generate a monthly invoice for an agreement. Server-side amounts only. */
export async function generateAgreementInvoice(agreementId: string, kind: 'service_fee' | 'ad_budget', periodLabel?: string) {
  const agreement = (await db.list('service_agreements', { id: agreementId }, 1))[0];
  if (!agreement) return { ok: false as const, error: 'Agreement not found' };
  const period = periodLabel?.trim() || new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  if (kind === 'service_fee') {
    return createInvoice({
      client_id: agreement.client_id, agreement_id: agreement.id, kind,
      description: `SEAI service retainer — ${period}`,
      lines: [{ label: `Monthly service fee — ${agreement.name} (${period})`, qty: 1, unit_inr: rupees(agreement.monthly_fee_inr) }],
    });
  }
  const adBudget = rupees(agreement.ad_budget_inr);
  if (adBudget <= 0) return { ok: false as const, error: 'No advertising budget is recorded on this agreement' };
  return createInvoice({
    client_id: agreement.client_id, agreement_id: agreement.id, kind,
    description: `Advertising budget — ${period} (client-funded, paid to platforms; not SEAI revenue)`,
    lines: [{ label: `Advertising budget — ${period} (Meta/Google, paid directly to platforms)`, qty: 1, unit_inr: adBudget }],
    gst_rate: 0,
  });
}

/** Revenue figures. Ad budgets are excluded from SEAI revenue by construction. */
export async function financeSnapshot() {
  const agreements = await db.list('service_agreements', { status: 'active' }, 10000);
  const mrr = agreements.reduce((s, a) => s + rupees(a.monthly_fee_inr), 0);
  const adBudgets = agreements.reduce((s, a) => s + rupees(a.ad_budget_inr), 0);
  const invoices = await db.list('invoices', {}, 10000);
  const outstanding = invoices.filter((i) => ['sent', 'overdue'].includes(String(i.status)));
  const outstandingService = outstanding.filter((i) => i.kind !== 'ad_budget').reduce((s, i) => s + rupees(i.total_inr), 0);
  const outstandingAdBudget = outstanding.filter((i) => i.kind === 'ad_budget').reduce((s, i) => s + rupees(i.total_inr), 0);
  const expenses = await db.list('expenses', {}, 10000);
  const expenseTotal = expenses.reduce((s, e) => s + rupees(e.amount_inr), 0);
  const oneTimePaid = invoices.filter((i) => i.kind === 'one_time' && i.status === 'paid').reduce((s, i) => s + rupees(i.total_inr), 0);
  const servicePaid = invoices.filter((i) => i.kind === 'service_fee' && i.status === 'paid').reduce((s, i) => s + rupees(i.total_inr), 0);
  const renewals = agreements
    .filter((a) => a.renewal_date)
    .sort((a, b) => String(a.renewal_date).localeCompare(String(b.renewal_date)))
    .slice(0, 10)
    .map((a) => ({ id: a.id, client_id: a.client_id, name: a.name, renewal_date: a.renewal_date, monthly_fee_inr: rupees(a.monthly_fee_inr) }));
  return { mrr, adBudgets, outstandingService, outstandingAdBudget, expenseTotal, oneTimePaid, servicePaid, activeAgreements: agreements.length, renewals };
}

export async function staffOverview() {
  const [clients, leads, projects, invoices] = await Promise.all([
    db.list('clients', {}, 10000),
    db.list('leads', {}, 10000),
    db.list('projects', {}, 10000),
    db.list('invoices', {}, 10000),
  ]);
  const nowDate = new Date();
  const weekAgo = new Date(nowDate.getTime() - 7 * 86400000).toISOString();
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[String(l.stage)] = (byStage[String(l.stage)] ?? 0) + 1;
  const won = byStage['won'] ?? 0;
  const lost = byStage['lost'] ?? 0;
  const closed = won + lost;
  const finance = await financeSnapshot();
  const today = nowDate.toISOString().slice(0, 10);
  const in30 = new Date(nowDate.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    clients: { total: clients.length, active: clients.filter((c) => c.status === 'active').length, onboarding: clients.filter((c) => c.status === 'onboarding').length },
    leads: {
      total: leads.length, byStage,
      new7d: leads.filter((l) => String(l.created_at) >= weekAgo).length,
      qualified: byStage['qualified'] ?? 0,
      proposalsSent: byStage['proposal_sent'] ?? 0,
      negotiation: byStage['negotiation'] ?? 0,
      won, lost,
      conversionRate: closed ? Math.round((won / closed) * 100) : null,
      followUpDue: leads.filter((l) => l.next_follow_up_at && String(l.next_follow_up_at).slice(0, 10) <= today && !['won', 'lost'].includes(String(l.stage))).length,
    },
    projects: {
      total: projects.length,
      active: projects.filter((p) => p.status === 'active').length,
      planned: projects.filter((p) => p.status === 'planned').length,
      completed: projects.filter((p) => p.status === 'completed').length,
    },
    finance: { ...finance, outstandingCount: invoices.filter((i) => ['sent', 'overdue'].includes(String(i.status))).length },
    renewalsNext30d: finance.renewals.filter((r) => String(r.renewal_date).slice(0, 10) <= in30).length,
  };
}

