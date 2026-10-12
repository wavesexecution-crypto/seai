import { randomUUID } from 'node:crypto';
import { renderTemplate, EmailRenderError } from './registry.js';
import { renderDocument, type Block, type RenderedEmail } from './design.js';
import { normalizeRecipient, buildDedupeKey, claimEvent, createDelivery, markEventStatus, releaseEventClaim, updateDelivery, encodeReapableVariables } from './store.js';
import { isMailConfigured, sendMailDetailed, type OutgoingMail, type SendResult } from './transport.js';
import { redactSecrets, assertNoSecrets } from './safety.js';
import type { EmailContext } from './context.js';
import { config } from '../config.js';

export type DispatchStatus = 'sent' | 'duplicate' | 'failed' | 'skipped';

export interface DispatchInput {
  /** Business event name, e.g. `change.received`. Usually equals the template name. */
  eventName: string;
  template: string;
  to: string;
  variables?: Partial<EmailContext>;
  customerId?: string | null;
  /** Unique business key for this occurrence. Replaying the same key never re-sends. */
  dedupeKey?: string;
  /** Used to build a dedupe key when `dedupeKey` is not supplied. */
  dedupeParts?: (string | number | null | undefined)[];
  correlationId?: string | null;
  /** Set false only for deliberate admin/QA sends. Default true. */
  idempotent?: boolean;
  /**
   * Pre-rendered content for internal operational reports whose layout is
   * driven by the data rather than by a registered template. Still runs the
   * secret scan and the full ledger/dedupe/SMTP path; only the template
   * lookup is bypassed. Customer emails always use `template`.
   */
  rendered?: RenderedEmail;
}

export interface DispatchResult {
  status: DispatchStatus;
  eventId: string | null;
  deliveryId: string | null;
  template: string;
  recipient: string;
  messageId?: string;
  duplicateEventId?: string;
  reason?: string;
  /** Which delivery attempt this was, counting retries of the same business event. */
  attempt?: number;
}

export type MailSender = (mail: OutgoingMail) => Promise<SendResult>;

let sender: MailSender = sendMailDetailed;
let dryRun = false;
// True once a test/QA sender replaces the real SMTP transport. SMTP
// configuration is then irrelevant, because no provider connection is made.
let senderInjected = false;

export function setMailSender(next: MailSender): void {
  sender = next;
  senderInjected = next !== sendMailDetailed;
}

export function resetMailSender(): void {
  sender = sendMailDetailed;
  senderInjected = false;
  dryRun = false;
}

export function setMailDryRun(value: boolean): void {
  dryRun = value;
}

// Control characters have no legitimate place in an address. NUL in particular
// is accepted by the shape regex below (it is neither whitespace nor @), so it
// must be excluded explicitly rather than left to nodemailer.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

/**
 * True when the value is a single, syntactically usable mailbox.
 *
 * Deliberately strict and single-recipient: CRLF sequences (header injection),
 * comma lists and space-separated lists are all rejected here rather than being
 * handed to the provider.
 */
export function isValidRecipient(value: string): boolean {
  const raw = String(value ?? '');
  if (!raw) return false;
  if (CONTROL_CHARS.test(raw)) return false;
  if (raw !== raw.trim()) return false;
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(raw);
}

let nonIdempotentSeq = 0;
function nonIdempotentCounter(): string {
  nonIdempotentSeq += 1;
  return `${Date.now().toString(36)}-${nonIdempotentSeq.toString(36)}-${randomUUID().slice(0, 8)}`;
}

function log(parts: Record<string, unknown>): void {
  const line = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? redactSecrets(v, 200) : String(v)}`)
    .join(' ');
  console.log(`[mail] ${line}`);
}

export function mailDispatchEnabled(): boolean {
  return config.mailEventsEnabled !== false;
}

function correlationOf(input: DispatchInput): string | null {
  return input.correlationId ?? null;
}

/**
 * Sends one transactional email for one business event.
 * - Never throws: failures are recorded and returned.
 * - Idempotent by default: a replay of an already-delivered dedupe key is
 *   recorded as `duplicate` and no second email is sent.
 * - Recoverable: a replay after a provider failure retries the same event
 *   (bounded by MAX_ATTEMPTS), so an SMTP outage cannot silently lose a
 *   customer email.
 * - Recipient, template, and rendering problems can never reach the provider.
 */
export async function dispatchEmail(input: DispatchInput): Promise<DispatchResult> {
  const template = input.template;
  const recipient = normalizeRecipient(input.to);
  const started = Date.now();
  const dedupeKey = input.dedupeKey ?? buildDedupeKey(input.eventName, input.dedupeParts ?? [input.variables?.order_id, input.variables?.request_id, recipient]);
  const correlationId = correlationOf(input);

  if (!mailDispatchEnabled()) {
    const reason = 'mail events disabled (SEAI_MAIL_EVENTS_ENABLED=false)';
    log({ event: input.eventName, template, to: recipient, status: 'skipped', reason });
    return { status: 'skipped', eventId: null, deliveryId: null, template, recipient, reason };
  }
  if (!isValidRecipient(recipient)) {
    const reason = 'invalid recipient';
    log({ event: input.eventName, template, status: 'skipped', reason });
    return { status: 'skipped', eventId: null, deliveryId: null, template, recipient: '', reason };
  }
  if (!dryRun && !senderInjected && !isMailConfigured()) {
    const reason = 'email service not configured';
    log({ event: input.eventName, template, to: recipient, status: 'skipped', reason });
    return { status: 'skipped', eventId: null, deliveryId: null, template, recipient, reason };
  }

  const idempotent = input.idempotent !== false;
  const claimedDedupeKey = idempotent ? dedupeKey : `${dedupeKey}:${nonIdempotentCounter()}`;
  let claim;
  try {
    claim = await claimEvent({
      eventName: input.eventName,
      template,
      // A non-idempotent send must never collide, not even twice in the same
      // millisecond, so the key gets a monotonic counter and a random suffix.
      dedupeKey: claimedDedupeKey,
      recipient,
      customerId: input.customerId ?? null,
      correlationId,
      // Persisted so a send frozen by a serverless teardown can be rebuilt.
      // Token-bearing templates return null here and are never reaped.
      variablesJson: encodeReapableVariables(template, input.variables as Record<string, unknown> | undefined),
    });
  } catch (err) {
    const reason = `claim failed: ${redactSecrets((err as Error).message, 200)}`;
    log({ event: input.eventName, template, to: recipient, status: 'skipped', reason });
    return { status: 'skipped', eventId: null, deliveryId: null, template, recipient, reason };
  }
  if (claim.duplicate) {
    log({ event: claim.event.id, name: input.eventName, template, to: recipient, status: 'duplicate', reason: claim.event.status });
    return { status: 'duplicate', eventId: claim.event.id, deliveryId: null, template, recipient, duplicateEventId: claim.event.id };
  }

  const eventId = claim.event.id;
  const attempt = Number(claim.event.attempts ?? 1);

  try {
    return await deliver(input, { eventId, attempt, retried: claim.retried });
  } finally {
    releaseEventClaim(claimedDedupeKey);
  }
}

interface DeliverContext {
  eventId: string;
  attempt: number;
  retried: boolean;
}

async function deliver(input: DispatchInput, ctx: DeliverContext): Promise<DispatchResult> {
  const { eventId, attempt, retried } = ctx;
  const template = input.template;
  const recipient = normalizeRecipient(input.to);
  const started = Date.now();
  const correlationId = correlationOf(input);
  const label = `${input.eventName}`;

  let rendered: RenderedEmail;
  try {
    rendered = input.rendered ?? renderTemplate(template, { ...input.variables, email: recipient });
    // Rendered content must clear the same leak scan as template content.
    assertNoSecrets(rendered.html, `${template} html`);
    assertNoSecrets(rendered.text, `${template} text`);
  } catch (err) {
    const reason = err instanceof EmailRenderError ? `${err.code}: ${err.message}` : redactSecrets((err as Error).message, 300);
    const failed = await createDelivery({
      eventId,
      eventName: input.eventName,
      template,
      recipient,
      subject: '',
      customerId: input.customerId ?? null,
      correlationId,
    });
    await updateDelivery(failed.id, { status: 'failed', error: reason });
    await markEventStatus(eventId, 'failed');
    log({ event: eventId, name: label, template, to: recipient, status: 'render_failed', reason, attempt, ms: Date.now() - started });
    return { status: 'failed', eventId, deliveryId: failed.id, template, recipient, reason, attempt };
  }

  const delivery = await createDelivery({
    eventId,
    eventName: input.eventName,
    template,
    recipient,
    subject: rendered.subject,
    customerId: input.customerId ?? null,
    correlationId,
  });
  await markEventStatus(eventId, 'sending');

  if (dryRun) {
    await updateDelivery(delivery.id, { status: 'sent', provider: 'dry-run', providerResponse: 'dry run: not sent' });
    await markEventStatus(eventId, 'sent');
    log({ event: eventId, name: label, template, to: recipient, status: 'dry_run', attempt, ms: Date.now() - started });
    return { status: 'sent', eventId, deliveryId: delivery.id, template, recipient, messageId: 'dry-run', attempt };
  }

  try {
    const result = await sender({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        'X-SEAI-Event': input.eventName,
        'X-SEAI-Template': template,
        ...(correlationId ? { 'X-SEAI-Correlation-Id': correlationId } : {}),
      },
    });
    await updateDelivery(delivery.id, {
      status: 'sent',
      providerMessageId: result.messageId,
      providerResponse: result.response,
    });
    await markEventStatus(eventId, 'sent');
    log({ event: eventId, name: label, template, to: recipient, status: retried ? 'sent_on_retry' : 'sent', message_id: result.messageId, response: result.response, attempt, ms: Date.now() - started });
    return { status: 'sent', eventId, deliveryId: delivery.id, template, recipient, messageId: result.messageId, attempt };
  } catch (err) {
    const reason = redactSecrets((err as Error).message, 300);
    await updateDelivery(delivery.id, { status: 'failed', error: reason });
    await markEventStatus(eventId, 'failed');
    log({ event: eventId, name: label, template, to: recipient, status: 'failed', reason, attempt, ms: Date.now() - started });
    return { status: 'failed', eventId, deliveryId: delivery.id, template, recipient, reason, attempt };
  }
}

export async function dispatchMany(inputs: DispatchInput[]): Promise<DispatchResult[]> {
  const out: DispatchResult[] = [];
  for (const input of inputs) out.push(await dispatchEmail(input));
  return out;
}

export interface RenderedDispatchInput {
  /** Business event name, e.g. `internal.intake_report`. */
  eventName: string;
  to: string;
  subject: string;
  preheader?: string;
  blocks: Block[];
  /** Replaying the same key never sends a second report. */
  dedupeKey?: string;
  dedupeParts?: (string | number | null | undefined)[];
  correlationId?: string | null;
}

/**
 * Sends a data-driven internal report through the identical delivery path used
 * by customer email: design system rendering, secret scan, DB-backed dedupe,
 * ledger records, retries and provider bookkeeping.
 */
export async function dispatchRenderedEmail(input: RenderedDispatchInput): Promise<DispatchResult> {
  const rendered = renderDocument({
    preheader: input.preheader ?? '',
    blocks: input.blocks,
    reason: '',
    title: input.subject,
  });
  return dispatchEmail({
    eventName: input.eventName,
    template: input.eventName,
    to: input.to,
    dedupeKey: input.dedupeKey,
    dedupeParts: input.dedupeParts,
    correlationId: input.correlationId ?? null,
    rendered,
  });
}
