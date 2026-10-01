import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { redactSecrets } from './safety.js';
import { listTemplates } from './registry.js';

export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface EmailEventRecord {
  id: string;
  event_name: string;
  template: string;
  dedupe_key: string;
  customer_id: string | null;
  recipient: string;
  status: EmailStatus;
  /** Number of delivery attempts granted for this business event. */
  attempts: number;
  correlation_id: string | null;
  /** JSON-encoded render variables, or null when not reapplicable. */
  variables: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailDeliveryRecord {
  id: string;
  event_id: string;
  event_name: string;
  template: string;
  customer_id: string | null;
  recipient: string;
  subject: string;
  status: EmailStatus;
  provider: string;
  provider_message_id: string | null;
  provider_response: string | null;
  error: string | null;
  correlation_id: string | null;
  created_at: string;
  sent_at: string | null;
  failed_at: string | null;
}

export interface NewEmailEvent {
  eventName: string;
  template: string;
  dedupeKey: string;
  recipient: string;
  customerId?: string | null;
  correlationId?: string | null;
  /** Render variables, JSON-encoded, so a frozen send can be reconstructed. */
  variablesJson?: string | null;
}

/**
 * Templates whose variables embed a single-use secret (a password-reset or
 * email-verification token). Their render variables are deliberately NOT
 * persisted: duplicating a live token into `email_events` would defeat the
 * point of storing only `token_hash`. These events are never auto-reaped —
 * a customer who missed a reset email simply requests a new link, which mints
 * a fresh token.
 */
export const NOT_REAPABLE_TEMPLATES = new Set(['account.password_reset', 'account.verify_email']);

/** Variable keys that must never be written to the events table. */
const SECRET_VARIABLE_KEYS = new Set(['reset_url', 'verify_url', 'token', 'password']);

export function encodeReapableVariables(template: string, variables: Record<string, unknown> | undefined | null): string | null {
  if (NOT_REAPABLE_TEMPLATES.has(template)) return null;
  if (!variables || typeof variables !== 'object') return null;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variables)) {
    if (SECRET_VARIABLE_KEYS.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    safe[k] = v as never;
  }
  if (!Object.keys(safe).length) return null;
  try {
    return JSON.stringify(safe);
  } catch {
    return null;
  }
}

export function decodeReapableVariables(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface ClaimResult {
  event: EmailEventRecord;
  /** True when no new attempt is allowed: already sent, in progress, or exhausted. */
  duplicate: boolean;
  /** True when this claim re-uses the event row after a failed or crashed attempt. */
  retried: boolean;
}

/** Attempts allowed per business event, so a broken destination cannot loop forever. */
export const MAX_ATTEMPTS = 5;
/** A send still marked `sending` after this long is treated as crashed and retryable. */
export const STALE_SEND_MS = 10 * 60 * 1000;

const inFlight = new Set<string>();

function now(): string {
  return new Date().toISOString();
}

export function normalizeRecipient(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

export function buildDedupeKey(eventName: string, parts: (string | number | null | undefined)[]): string {
  const tail = parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim().toLowerCase()))
    .filter((p) => p.length > 0)
    .join('|');
  return `${eventName}:${tail}`;
}

export async function syncTemplateCatalog(): Promise<void> {
  for (const def of listTemplates()) {
    const row = {
      id: def.name,
      name: def.name,
      category: def.category,
      subject: def.subject.slice(0, 300),
      preheader: def.preheader.slice(0, 300),
      wired: def.wired,
      required_vars: def.required.join(','),
      updated_at: now(),
    };
    // `db.insert` is insert-or-nothing, so a changed subject or required list
    // would never refresh. Insert first, then update unconditionally: the
    // catalog mirror is best effort, so a failure here must not break sending.
    try {
      await db.insert('email_templates', row);
      await db.update('email_templates', row.id, {
        name: row.name,
        category: row.category,
        subject: row.subject,
        preheader: row.preheader,
        wired: row.wired,
        required_vars: row.required_vars,
        updated_at: row.updated_at,
      });
    } catch { /* catalog mirror is best effort */ }
  }
}

export async function findEventByDedupeKey(dedupeKey: string): Promise<EmailEventRecord | null> {
  const rows = await db.list('email_events', { dedupe_key: dedupeKey }, 1);
  return rows.length > 0 ? (rows[0] as EmailEventRecord) : null;
}

/** Releases the in-process claim held by `claimEvent`. Safe to call unconditionally. */
export function releaseEventClaim(dedupeKey: string): void {
  inFlight.delete(dedupeKey);
}

function isStaleSend(event: EmailEventRecord): boolean {
  const updated = Date.parse(event.updated_at ?? '');
  return !Number.isFinite(updated) || Date.now() - updated > STALE_SEND_MS;
}

/**
 * Decides what a replay of an existing dedupe key means.
 *
 * A business event must produce at most one *successful* email, but a failed
 * attempt must stay recoverable: if SMTP was down when `maintenance.payment_required`
 * fired, a later replay has to be able to send it. Reusing the same event row
 * keeps the unique dedupe key intact and records each try as its own delivery.
 */
async function resolveExisting(
  existing: EmailEventRecord,
  recipient: string,
  variablesJson?: string | null,
): Promise<ClaimResult> {
  // Already delivered: never send twice.
  if (existing.status === 'sent') return { event: existing, duplicate: true, retried: false };
  const attempts = Number(existing.attempts ?? 0);
  if (attempts >= MAX_ATTEMPTS) return { event: existing, duplicate: true, retried: false };
  // A queued/sending row that is fresh is another request working on it right now.
  if (existing.status !== 'failed' && !isStaleSend(existing)) {
    return { event: existing, duplicate: true, retried: false };
  }
  if (inFlight.has(existing.dedupe_key)) return { event: existing, duplicate: true, retried: false };

  inFlight.add(existing.dedupe_key);
  try {
    const next = attempts + 1;
    const patch: Record<string, unknown> = {
      status: 'queued' as EmailStatus,
      attempts: next,
      recipient,
      updated_at: now(),
    };
    // A retry that carries fresh variables (reaper, or a business re-fire)
    // replaces the stored set; a retry without them keeps what we already have.
    if (variablesJson) patch.variables = variablesJson;
    await db.update('email_events', existing.id, patch);
    return {
      event: { ...existing, status: 'queued', attempts: next, recipient, updated_at: now() },
      duplicate: false,
      retried: true,
    };
  } catch (err) {
    inFlight.delete(existing.dedupe_key);
    throw err;
  }
}

export async function claimEvent(input: NewEmailEvent): Promise<ClaimResult> {
  const recipient = normalizeRecipient(input.recipient);
  const variablesJson = input.variablesJson ?? null;
  const existing = await findEventByDedupeKey(input.dedupeKey);
  if (existing) return resolveExisting(existing, recipient, variablesJson);
  if (inFlight.has(input.dedupeKey)) {
    // Another request inserted this key between our read and our insert; the
    // unique index will reject our row, so treat it as a duplicate.
    const running = await findEventByDedupeKey(input.dedupeKey);
    if (running) return { event: running, duplicate: true, retried: false };
  }
  inFlight.add(input.dedupeKey);
  try {
    const row = {
      id: randomUUID(),
      event_name: input.eventName,
      template: input.template,
      dedupe_key: input.dedupeKey,
      customer_id: input.customerId ?? null,
      recipient,
      status: 'queued' as EmailStatus,
      attempts: 1,
      correlation_id: input.correlationId ?? null,
      variables: variablesJson,
      created_at: now(),
      updated_at: now(),
    };
    await db.insert('email_events', row);
    const stored = await findEventByDedupeKey(input.dedupeKey);
    return { event: (stored ?? row) as EmailEventRecord, duplicate: false, retried: false };
  } catch (err) {
    inFlight.delete(input.dedupeKey);
    throw err;
  }
}

export async function markEventStatus(eventId: string, status: EmailStatus): Promise<void> {
  await db.update('email_events', eventId, { status, updated_at: now() });
}

/**
 * True when this business event already has a successful delivery.
 *
 * The authoritative duplicate guard for the reaper. A row's status alone is not
 * enough: if a `sent` event is ever observed as `queued`/`sending` again (a
 * corrupted status, a manual repair, a rollback), a status-driven retry would
 * send a second copy. The delivery log is the record that decides.
 */
export async function hasSentDelivery(eventId: string): Promise<boolean> {
  const rows = await db.list('email_deliveries', { event_id: eventId, status: 'sent' }, 1);
  return rows.length > 0;
}

/** Statuses that represent a send which started but never finished. */
export const ORPHANABLE_STATUSES: EmailStatus[] = ['queued', 'sending'];

/**
 * Events that were mid-send when the runtime froze and are now older than
 * `STALE_SEND_MS`. Candidates come from equality-only `list` calls and are
 * filtered by timestamp in JS, so this works on both the Postgres and the
 * disk-backed memory driver.
 *
 * Bounded per status and overall, so one sweep can never flood the queue.
 */
export async function listStaleSendEvents(limit = 25): Promise<EmailEventRecord[]> {
  const bounded = Math.max(1, Math.min(500, limit));
  const out: EmailEventRecord[] = [];
  for (const status of ORPHANABLE_STATUSES) {
    const rows = (await db.list('email_events', { status }, bounded)) as EmailEventRecord[];
    for (const row of rows) {
      const updated = Date.parse(String(row.updated_at ?? row.created_at ?? ''));
      if (!Number.isFinite(updated)) continue;
      if (Date.now() - updated <= STALE_SEND_MS) continue;
      out.push(row);
    }
  }
  // Oldest first, so a bounded sweep always rescues the longest-orphaned work.
  out.sort((a, b) => Date.parse(String(a.updated_at)) - Date.parse(String(b.updated_at)));
  return out.slice(0, bounded);
}

/**
 * Atomically take ownership of a stale event by flipping it to `failed`, the
 * state `resolveExisting` already treats as retryable.
 *
 * The compare-and-set is on (id, status, updated_at). If another worker already
 * touched the row the update matches nothing and returns 0, so the loser skips
 * instead of sending the same email twice.
 */
export async function claimStaleEvent(event: EmailEventRecord): Promise<boolean> {
  const changed = await db.updateWhere(
    'email_events',
    { id: event.id, status: event.status, updated_at: event.updated_at },
    { status: 'failed' as EmailStatus, updated_at: now() },
  );
  return changed === 1;
}

export async function createDelivery(input: {
  eventId: string;
  eventName: string;
  template: string;
  recipient: string;
  subject: string;
  customerId?: string | null;
  correlationId?: string | null;
  status?: EmailStatus;
}): Promise<EmailDeliveryRecord> {
  const row: EmailDeliveryRecord = {
    id: randomUUID(),
    event_id: input.eventId,
    event_name: input.eventName,
    template: input.template,
    customer_id: input.customerId ?? null,
    recipient: normalizeRecipient(input.recipient),
    subject: String(input.subject ?? '').slice(0, 300),
    status: input.status ?? 'queued',
    provider: 'smtp',
    provider_message_id: null,
    provider_response: null,
    error: null,
    correlation_id: input.correlationId ?? null,
    created_at: now(),
    sent_at: null,
    failed_at: null,
  };
  await db.insert('email_deliveries', row);
  return row;
}

export async function updateDelivery(
  deliveryId: string,
  patch: {
    status?: EmailStatus;
    provider?: string;
    providerMessageId?: string | null;
    providerResponse?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.status) update.status = patch.status;
  if (patch.provider) update.provider = patch.provider;
  if (patch.providerMessageId !== undefined) update.provider_message_id = patch.providerMessageId;
  if (patch.providerResponse !== undefined) update.provider_response = redactSecrets(String(patch.providerResponse ?? ''), 200);
  if (patch.error !== undefined) update.error = redactSecrets(String(patch.error ?? ''), 300);
  if (patch.status === 'sent') update.sent_at = now();
  if (patch.status === 'failed') update.failed_at = now();
  if (!Object.keys(update).length) return;
  await db.update('email_deliveries', deliveryId, update);
}

export interface DeliveryFilter {
  status?: string;
  recipient?: string;
  eventName?: string;
  customerId?: string;
  limit?: number;
}

export async function listDeliveries(filter: DeliveryFilter = {}): Promise<EmailDeliveryRecord[]> {
  const where: Record<string, string> = {};
  if (filter.status) where.status = filter.status;
  if (filter.recipient) where.recipient = normalizeRecipient(filter.recipient);
  if (filter.eventName) where.event_name = filter.eventName;
  if (filter.customerId) where.customer_id = filter.customerId;
  return (await db.list('email_deliveries', where, filter.limit ?? 50)) as EmailDeliveryRecord[];
}

export interface EventFilter {
  status?: string;
  customerId?: string;
  eventName?: string;
  limit?: number;
}

export async function listEvents(filter: EventFilter = {}): Promise<EmailEventRecord[]> {
  const where: Record<string, string> = {};
  if (filter.status) where.status = filter.status;
  if (filter.customerId) where.customer_id = filter.customerId;
  if (filter.eventName) where.event_name = filter.eventName;
  return (await db.list('email_events', where, filter.limit ?? 50)) as EmailEventRecord[];
}
