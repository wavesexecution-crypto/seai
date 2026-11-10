import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { sectionsForServices, requiredFields } from './onboarding-schema.js';
import { now, parseJsonArray } from './service.js';

const MAX_ASSET_BYTES = 2 * 1024 * 1024; // 2 MB inline cap
const ALLOWED_ASSET_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf',
  'video/mp4', 'application/zip',
]);

/** Resolve the client's purchased services from active agreements (fallback: all). */
export async function clientServices(clientId: string): Promise<string[]> {
  const agreements = await db.list('service_agreements', { client_id: clientId, status: 'active' }, 10);
  const services = new Set<string>();
  for (const a of agreements) for (const s of parseJsonArray(a.services)) services.add(s);
  return [...services];
}

export async function getOnboardingState(clientId: string) {
  const client = (await db.list('clients', { id: clientId }, 1))[0];
  if (!client) return null;
  const services = await clientServices(clientId);
  const sections = sectionsForServices(services);
  const responses = await db.list('onboarding_responses', { client_id: clientId }, 50);
  const bySection: Record<string, Record<string, unknown>> = {};
  const updatedAt: Record<string, string> = {};
  for (const r of responses) {
    try { bySection[r.section_key] = JSON.parse(r.data || '{}'); } catch { bySection[r.section_key] = {}; }
    updatedAt[r.section_key] = r.updated_at;
  }
  const req = requiredFields(services);
  let filled = 0;
  for (const { section, field } of req) {
    const v = bySection[section]?.[field];
    if (v !== undefined && v !== null && String(v).trim() !== '') filled += 1;
  }
  const assets = await db.list('onboarding_assets', { client_id: clientId }, 200);
  const invites = await db.list('onboarding_invites', { client_id: clientId }, 50);
  return {
    client: { id: client.id, brand_name: client.brand_name, status: client.status },
    services,
    sections: sections.map((s) => ({ ...s, saved: bySection[s.key] ?? {}, updated_at: updatedAt[s.key] ?? null })),
    progress: { required: req.length, filled, percent: req.length ? Math.round((filled / req.length) * 100) : 100 },
    assets: assets.map(({ data_url, ...a }) => ({ ...a, size_kb: Math.round(Number(a.size_bytes ?? 0) / 1024) })),
    invites,
  };
}

export async function saveOnboardingSection(clientId: string, sectionKey: string, data: unknown) {
  const client = (await db.list('clients', { id: clientId }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const services = await clientServices(clientId);
  const section = sectionsForServices(services).find((s) => s.key === sectionKey);
  if (!section) return { ok: false as const, error: 'Unknown section for this client’s services' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false as const, error: 'Section data must be an object' };
  const clean: Record<string, unknown> = {};
  for (const field of section.fields) {
    const v = (data as Record<string, unknown>)[field.key];
    if (v === undefined) continue;
    if (field.type === 'boolean') { clean[field.key] = Boolean(v); continue; }
    if (field.type === 'number') { const n = Number(v); clean[field.key] = Number.isFinite(n) ? n : null; continue; }
    clean[field.key] = String(v ?? '').slice(0, 8000);
  }
  const existing = (await db.list('onboarding_responses', { client_id: clientId, section_key: sectionKey }, 1))[0];
  if (existing) {
    await db.update('onboarding_responses', existing.id, { data: JSON.stringify(clean), updated_at: now() });
  } else {
    await db.insert('onboarding_responses', { id: randomUUID(), client_id: clientId, section_key: sectionKey, data: JSON.stringify(clean), updated_at: now() });
  }
  return { ok: true as const, section: sectionKey };
}

export async function addOnboardingAsset(clientId: string, input: { section_key?: string; field_key?: string; filename: string; mime: string; data_url: string }) {
  const client = (await db.list('clients', { id: clientId }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const { filename, mime, data_url } = input;
  const match = /^data:([^;,]+);base64,(.+)$/.exec(String(data_url ?? ''));
  if (!match) return { ok: false as const, error: 'Asset must be a base64 data URL' };
  const declaredMime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  if (!ALLOWED_ASSET_MIME.has(declaredMime)) return { ok: false as const, error: `Unsupported file type: ${declaredMime}` };
  if (bytes.length > MAX_ASSET_BYTES) return { ok: false as const, error: 'File exceeds the 2 MB inline limit — share a drive link instead' };
  if (String(mime).toLowerCase() !== declaredMime) return { ok: false as const, error: 'MIME type mismatch' };
  const id = randomUUID();
  await db.insert('onboarding_assets', {
    id, client_id: clientId, section_key: input.section_key ?? null, field_key: input.field_key ?? null,
    filename: String(filename).slice(0, 240), mime: declaredMime, size_bytes: bytes.length,
    data_url, created_at: now(),
  });
  return { ok: true as const, id, size_bytes: bytes.length };
}

export async function upsertInvite(clientId: string, input: { id?: string; platform: string; status?: string; invited_email?: string; notes?: string }) {
  const client = (await db.list('clients', { id: clientId }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const platform = String(input.platform ?? '').trim().toLowerCase();
  const allowed = ['meta_bm', 'meta_page', 'instagram', 'google_ads', 'analytics', 'gtm', 'crm', 'other'];
  if (!allowed.includes(platform)) return { ok: false as const, error: `Platform must be one of: ${allowed.join(', ')}` };
  const status = ['pending', 'sent', 'accepted', 'declined'].includes(String(input.status)) ? String(input.status) : 'pending';
  if (input.id) {
    await db.update('onboarding_invites', input.id, { platform, status, invited_email: input.invited_email ?? null, notes: input.notes ?? null, updated_at: now() });
    return { ok: true as const, id: input.id };
  }
  const existing = (await db.list('onboarding_invites', { client_id: clientId, platform }, 1))[0];
  if (existing) {
    await db.update('onboarding_invites', existing.id, { status, invited_email: input.invited_email ?? existing.invited_email, notes: input.notes ?? existing.notes, updated_at: now() });
    return { ok: true as const, id: existing.id };
  }
  const id = randomUUID();
  await db.insert('onboarding_invites', { id, client_id: clientId, platform, status, invited_email: input.invited_email ?? null, notes: input.notes ?? null, updated_at: now() });
  return { ok: true as const, id };
}
