import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { dispatchEmail } from '../mail/dispatch.js';
import { trackPendingMail } from '../mail/pending.js';
import { config } from '../config.js';
import { LEAD_STAGE_KEYS, LEAD_SOURCES, LEAD_PRIORITIES, BUSINESS_SIZES } from './constants.js';

export const now = () => new Date().toISOString();

export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase();
}
export function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  // Drop Indian trunk/country prefix for comparison purposes.
  return digits.length > 10 ? digits.slice(-10) : digits;
}
export function normalizeName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function jsonArray(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => String(x)));
  const s = String(v).trim();
  return s ? JSON.stringify([s]) : undefined;
}
export function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}
export function parseJsonObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  try { const p = JSON.parse(String(v ?? '{}')); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}

const genRef = () => `LD-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;

// ---------------- Duplicate detection ----------------
export interface DuplicateHit { id: string; lead_ref?: string; business_name: string; reason: 'email' | 'phone' | 'business_name'; }

export async function findLeadDuplicate(input: { email?: string | null; phone?: string | null; business_name?: string | null }): Promise<DuplicateHit | null> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = normalizeName(input.business_name);
  const recent = await db.list('leads', {}, 5000);
  if (email) {
    const hit = recent.find((r) => normalizeEmail(r.email) === email);
    if (hit) return { id: hit.id, lead_ref: hit.lead_ref, business_name: hit.business_name, reason: 'email' };
  }
  if (phone && phone.length >= 8) {
    const hit = recent.find((r) => normalizePhone(r.phone) === phone);
    if (hit) return { id: hit.id, lead_ref: hit.lead_ref, business_name: hit.business_name, reason: 'phone' };
  }
  if (name && name.length >= 4) {
    const hit = recent.find((r) => normalizeName(r.business_name) === name);
    if (hit) return { id: hit.id, lead_ref: hit.lead_ref, business_name: hit.business_name, reason: 'business_name' };
  }
  return null;
}

// ---------------- Leads ----------------
export interface LeadInput {
  business_name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  industry?: string | null;
  location?: string | null;
  website?: string | null;
  social_links?: unknown;
  source?: string | null;
  business_size?: string | null;
  potential_services?: unknown;
  estimated_budget_inr?: number | null;
  estimated_mrr_inr?: number | null;
  priority?: string | null;
  stage?: string | null;
  assigned_to?: string | null;
  next_follow_up_at?: string | null;
  notes?: string | null;
}

function cleanEnum(v: string | null | undefined, allowed: readonly string[], fallback: string): string {
  const s = String(v ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? s : fallback;
}

export async function createLead(input: LeadInput, actor: string | null, opts: { force?: boolean; importBatchId?: string; inquiryId?: string } = {}) {
  const businessName = String(input.business_name ?? '').trim();
  if (!businessName) return { ok: false as const, error: 'Business name is required' };
  if (!opts.force) {
    const dup = await findLeadDuplicate(input);
    if (dup) return { ok: false as const, error: 'Possible duplicate lead', duplicate: dup };
  }
  const id = randomUUID();
  const stage = cleanEnum(input.stage, LEAD_STAGE_KEYS, 'new');
  const row = {
    id,
    lead_ref: genRef(),
    business_name: businessName,
    contact_person: input.contact_person?.trim() || null,
    phone: input.phone?.trim() || null,
    email: normalizeEmail(input.email) || null,
    industry: input.industry?.trim() || null,
    location: input.location?.trim() || null,
    website: input.website?.trim() || null,
    social_links: input.social_links ? JSON.stringify(input.social_links) : null,
    source: cleanEnum(input.source, LEAD_SOURCES, 'manual'),
    business_size: input.business_size ? cleanEnum(input.business_size, BUSINESS_SIZES, 'small') : null,
    potential_services: jsonArray(input.potential_services) ?? null,
    estimated_budget_inr: input.estimated_budget_inr ?? null,
    estimated_mrr_inr: input.estimated_mrr_inr ?? null,
    priority: cleanEnum(input.priority, LEAD_PRIORITIES, 'normal'),
    stage,
    assigned_to: input.assigned_to || null,
    next_follow_up_at: input.next_follow_up_at || null,
    inquiry_id: opts.inquiryId ?? null,
    import_batch_id: opts.importBatchId ?? null,
    created_at: now(),
    updated_at: now(),
  };
  await db.insert('leads', row);
  await addActivity(id, actor, 'created', 'Lead created', { source: row.source, stage });
  if (input.notes?.trim()) await addActivity(id, actor, 'note', input.notes.trim());
  return { ok: true as const, id, lead_ref: row.lead_ref };
}

export async function addActivity(leadId: string, actor: string | null, type: string, body: string, meta?: Record<string, unknown>) {
  await db.insert('lead_activities', {
    id: randomUUID(), lead_id: leadId, actor: actor ?? 'system', type, body,
    meta: meta ? JSON.stringify(meta) : null, created_at: now(),
  });
}

export interface LeadFilter {
  q?: string; stage?: string; assigned_to?: string; priority?: string; source?: string;
  follow_up_due?: boolean; limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc';
}

export async function listLeads(filter: LeadFilter) {
  const all = await db.list('leads', {}, 10000);
  let rows = all;
  const q = String(filter.q ?? '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.business_name, r.contact_person, r.email, r.phone, r.location, r.industry, r.lead_ref, r.website]
        .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }
  if (filter.stage) rows = rows.filter((r) => r.stage === filter.stage);
  if (filter.assigned_to) rows = rows.filter((r) => r.assigned_to === filter.assigned_to);
  if (filter.priority) rows = rows.filter((r) => r.priority === filter.priority);
  if (filter.source) rows = rows.filter((r) => r.source === filter.source);
  if (filter.follow_up_due) {
    const today = new Date().toISOString().slice(0, 10);
    rows = rows.filter((r) => r.next_follow_up_at && String(r.next_follow_up_at).slice(0, 10) <= today && !['won', 'lost'].includes(String(r.stage)));
  }
  const sortKey = ['created_at', 'updated_at', 'next_follow_up_at', 'business_name', 'priority', 'stage', 'estimated_mrr_inr'].includes(String(filter.sort)) ? String(filter.sort) : 'created_at';
  const dir = filter.order === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? '';
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
  const total = rows.length;
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  return { total, rows: rows.slice(offset, offset + limit) };
}

export async function getLeadDetail(id: string) {
  const lead = (await db.list('leads', { id }, 1))[0];
  if (!lead) return null;
  const activities = await db.list('lead_activities', { lead_id: id }, 500);
  return { lead, activities: activities.reverse() };
}

export async function updateLead(id: string, patch: Record<string, unknown>, actor: string | null) {
  const existing = (await db.list('leads', { id }, 1))[0];
  if (!existing) return { ok: false as const, error: 'Lead not found' };
  const allowed: Record<string, (v: unknown) => unknown> = {
    business_name: (v) => String(v ?? '').trim() || undefined,
    contact_person: (v) => String(v ?? '').trim() || null,
    phone: (v) => String(v ?? '').trim() || null,
    email: (v) => normalizeEmail(String(v ?? '')) || null,
    industry: (v) => String(v ?? '').trim() || null,
    location: (v) => String(v ?? '').trim() || null,
    website: (v) => String(v ?? '').trim() || null,
    business_size: (v) => (v ? cleanEnum(String(v), BUSINESS_SIZES, 'small') : null),
    potential_services: (v) => jsonArray(v) ?? null,
    estimated_budget_inr: (v) => (v === null || v === '' ? null : Number(v)),
    estimated_mrr_inr: (v) => (v === null || v === '' ? null : Number(v)),
    priority: (v) => cleanEnum(String(v ?? 'normal'), LEAD_PRIORITIES, 'normal'),
    source: (v) => cleanEnum(String(v ?? 'manual'), LEAD_SOURCES, 'manual'),
    assigned_to: (v) => (v ? String(v) : null),
    next_follow_up_at: (v) => (v ? String(v) : null),
    social_links: (v) => (v ? JSON.stringify(v) : null),
  };
  const clean: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(allowed)) {
    if (k in patch) {
      const v = fn(patch[k]);
      if (v !== undefined) clean[k] = v;
    }
  }
  if ('stage' in patch) {
    const stage = cleanEnum(String(patch.stage ?? ''), LEAD_STAGE_KEYS, String(existing.stage));
    if (stage !== existing.stage) {
      clean.stage = stage;
      clean.last_contacted_at = ['contacted', 'responded'].includes(stage) ? now() : existing.last_contacted_at ?? null;
      await addActivity(id, actor, 'stage_change', `Stage: ${existing.stage} → ${stage}`, { from: existing.stage, to: stage });
      if (stage === 'lost' && patch.lost_reason) {
        clean.lost_reason = String(patch.lost_reason).slice(0, 500);
      }
    }
  }
  if (!Object.keys(clean).length) return { ok: true as const, id };
  clean.updated_at = now();
  await db.update('leads', id, clean);
  if ('assigned_to' in clean) await addActivity(id, actor, 'assignment', clean.assigned_to ? `Assigned to ${clean.assigned_to}` : 'Unassigned');
  return { ok: true as const, id };
}

// ---------------- Inquiry intake (public form) ----------------
export interface InquiryInput {
  name: string; businessName: string; email: string; phone: string;
  industry?: string; website?: string; servicesRequired?: unknown;
  monthlyMarketingBudget?: string; advertisingBudget?: string;
  objective?: string; details?: string;
}

export async function createInquiry(input: InquiryInput, ipHash?: string) {
  const id = randomUUID();
  const row = {
    id,
    name: input.name.trim(), business_name: input.businessName.trim(),
    email: normalizeEmail(input.email), phone: input.phone.trim(),
    industry: input.industry?.trim() || null, website: input.website?.trim() || null,
    services_required: jsonArray(input.servicesRequired) ?? null,
    monthly_marketing_budget: input.monthlyMarketingBudget?.trim() || null,
    ad_budget: input.advertisingBudget?.trim() || null,
    objective: input.objective?.trim() || null, details: input.details?.trim() || null,
    source: 'website', status: 'new', ip_hash: ipHash ?? null, created_at: now(),
  };
  await db.insert('growth_inquiries', row);

  // Auto-create (or link) a pipeline lead — this is the acquisition system,
  // not a dead-end form. Duplicates are linked, never duplicated.
  const dup = await findLeadDuplicate({ email: row.email, phone: row.phone, business_name: row.business_name });
  let leadId: string | null = null;
  if (dup) {
    leadId = dup.id;
    await addActivity(dup.id, 'system', 'note', `Website inquiry linked (duplicate of ${dup.reason})`, { inquiryId: id });
    await db.update('growth_inquiries', id, { lead_id: dup.id });
  } else {
    const created = await createLead({
      business_name: row.business_name, contact_person: row.name,
      phone: row.phone, email: row.email, industry: row.industry, website: row.website,
      source: 'website', potential_services: input.servicesRequired,
      notes: [input.objective ? `Objective: ${input.objective}` : null, input.details ? `Details: ${input.details}` : null,
        row.monthly_marketing_budget ? `Marketing budget: ${row.monthly_marketing_budget}` : null,
        row.ad_budget ? `Ad budget: ${row.ad_budget}` : null].filter(Boolean).join('\n'),
    }, 'system', { force: true, inquiryId: id });
    if (created.ok) {
      leadId = created.id;
      await db.update('growth_inquiries', id, { lead_id: created.id });
    }
  }

  // Notify the internal ops inbox — recorded + deduplicated by the mail pipeline.
  try {
    trackPendingMail(() => dispatchEmail({
      eventName: 'internal.inquiry_report',
      template: 'internal.inquiry_report',
      to: config.opsInbox,
      variables: {
        website_name: row.business_name,
        customer_name: row.name,
        email: row.email,
        request_summary: [
          row.objective ? `Objective: ${row.objective}` : null,
          input.servicesRequired ? `Services wanted: ${parseJsonArray(jsonArray(input.servicesRequired)).join(', ') || input.servicesRequired}` : null,
          row.monthly_marketing_budget ? `Marketing budget: ${row.monthly_marketing_budget}` : null,
          row.ad_budget ? `Ad budget: ${row.ad_budget}` : null,
          row.details ? `Details: ${row.details}` : null,
          `Phone: ${row.phone}`,
        ].filter(Boolean).join('\n'),
        alert_summary: [
          `Industry: ${row.industry || '—'}`,
          `Website: ${row.website || '—'}`,
          `Services: ${parseJsonArray(jsonArray(input.servicesRequired)).join(', ') || '—'}`,
        ].join('\n'),
      },
      dedupeParts: [id],
    }));
  } catch (err) {
    console.error('[growth] inquiry email skipped:', (err as Error).message);
  }

  return { ok: true as const, id, leadId };
}

// ---------------- Convert won lead → client ----------------
export async function convertLeadToClient(leadId: string, actor: string | null) {
  const lead = (await db.list('leads', { id: leadId }, 1))[0];
  if (!lead) return { ok: false as const, error: 'Lead not found' };
  if (lead.stage !== 'won') {
    await db.update('leads', leadId, { stage: 'won', updated_at: now() });
    await addActivity(leadId, actor, 'stage_change', `Stage: ${lead.stage} → won`);
  }
  const existing = await db.list('clients', { lead_id: leadId }, 1);
  if (existing.length) return { ok: true as const, id: existing[0].id, existing: true };
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
  await addActivity(leadId, actor, 'converted', 'Lead converted to client (onboarding started)');
  return { ok: true as const, id };
}

// ---------------- Clients ----------------
export async function listClients(filter: { q?: string; status?: string; limit?: number; offset?: number }) {
  const all = await db.list('clients', {}, 10000);
  let rows = all;
  const q = String(filter.q ?? '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => [r.brand_name, r.legal_name, r.email, r.phone, r.industry, r.primary_contact].some((v) => String(v ?? '').toLowerCase().includes(q)));
  if (filter.status) rows = rows.filter((r) => r.status === filter.status);
  const total = rows.length;
  const offset = Math.max(0, filter.offset ?? 0);
  return { total, rows: rows.slice(offset, offset + Math.min(500, Math.max(1, filter.limit ?? 100))) };
}
