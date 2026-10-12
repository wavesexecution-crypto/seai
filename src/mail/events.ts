import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/db.js';
import { dispatchEmail, isValidRecipient, type DispatchResult } from './dispatch.js';
import { listTemplates, type EmailCategory } from './registry.js';
import { changeStatusLabel } from './templates/change.js';
import { websiteUrl } from './urls.js';
import { provisionPaidOrder } from '../payments/provision.js';

// Server-to-server intake for authoritative events (seai.payments, SEAI ops,
// deployment tooling). This is the ONLY path allowed to claim that a payment
// succeeded, maintenance activated, a domain connected, or a site went live.
//
// Security:
// - Disabled entirely unless SEAI_EVENTS_SHARED_SECRET is configured.
// - HMAC-SHA256 over the raw body, constant-time compared.
// - Timestamp + replay window; the id must be unused, so a replay is a no-op.

export const mailEventsRouter = Router();

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const WIRED_NAMES = new Set(listTemplates().filter((t) => t.wired).map((t) => t.name));

const eventSchema = z.object({
  id: z.string().min(8).max(120),
  name: z.string().min(3).max(80),
  recipient: z.string().email().optional(),
  customerId: z.string().max(80).optional(),
  occurredAt: z.string().datetime().optional(),
  variables: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

function unauthorized(res: Response): void {
  res.status(401).json({ ok: false, error: 'Invalid event signature' });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function rawBody(req: Request): string {
  return (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
}

function signatureFor(body: string, timestamp: string): string {
  return createHmac('sha256', config.eventsSharedSecret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyEventSignature(body: string, timestamp: string, signature: string): boolean {
  if (!config.eventsSharedSecret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) return false;
  return timingSafeEqualStr(signatureFor(body, timestamp), signature);
}

async function seenEventId(id: string): Promise<boolean> {
  const rows = await db.list('email_events', { correlation_id: `evt:${id}` }, 1);
  return rows.length > 0;
}

/**
 * Maps an incoming event name to the email template that should carry it.
 * Only the client-lifecycle categories may be triggered from here.
 */
export function templateForEvent(name: string): string | null {
  const direct = name.startsWith('payment.') ? `payment.${name.split('.')[1]}` : name;
  if (!WIRED_NAMES.has(direct)) return null;
  const def = listTemplates().find((t) => t.name === direct)!;
  const allowed: EmailCategory[] = ['website', 'maintenance', 'payment', 'service', 'change', 'account'];
  return allowed.includes(def.category) ? def.name : null;
}

// A webhook that omits `status` would fail closed and lose a real customer
// email, so derive the human label from the event name when it is unambiguous.
const STATUS_FROM_EVENT: Record<string, string> = {
  'payment.successful': 'Successful',
  'payment.failed': 'Failed',
  'payment.pending': 'Pending',
  'payment.refunded': 'Refunded',
  'maintenance.payment_required': 'Payment required',
  'maintenance.activated': 'Active',
  'maintenance.payment_successful': 'Successful',
  'maintenance.payment_failed': 'Failed',
  'maintenance.renewing': 'Renewed',
  'maintenance.ended': 'Ended',
  'website.domain_connected': 'Connected',
  'website.deployed': 'Live',
};

function statusFromEvent(eventName: string, template: string): string {
  const direct = STATUS_FROM_EVENT[eventName];
  if (direct) return direct;
  if (template.startsWith('change.')) {
    const status = template.slice('change.'.length);
    return changeStatusLabel(status) || status;
  }
  return '';
}

mailEventsRouter.post('/events', async (req: Request, res: Response) => {
  if (!config.eventsSharedSecret) {
    res.status(503).json({ ok: false, error: 'Event intake is disabled' });
    return;
  }
  const timestamp = String(req.header('x-seai-event-timestamp') ?? '');
  const signature = String(req.header('x-seai-event-signature') ?? '');
  if (!verifyEventSignature(rawBody(req), timestamp, signature)) {
    unauthorized(res);
    return;
  }
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Invalid event payload', detail: parsed.error.errors[0].message });
    return;
  }
  const event = parsed.data;
  if (await seenEventId(event.id)) {
    res.json({ ok: true, status: 'duplicate', id: event.id });
    return;
  }
  const template = templateForEvent(event.name);
  if (!template) {
    res.status(400).json({ ok: false, error: `Unsupported event: ${event.name}` });
    return;
  }
  const variables = { ...(event.variables ?? {}) } as Record<string, unknown>;
  if (!String(variables.status ?? '').trim()) {
    const derived = statusFromEvent(event.name, template);
    if (derived) variables.status = derived;
  }

  // A paid-payment event first provisions the CDF customer/website record.
  // Without this, the payment row lives in seai.payments but the customer has
  // no dashboard-visible purchase/entitlement to sign in to.
  if (event.name === 'payment.successful') {
    const storageFileIds = String(variables.storage_file_ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const recipientForProvisioning = String(event.recipient ?? variables.email ?? variables.recipient ?? '').trim();
    if (!recipientForProvisioning) {
      res.status(400).json({ ok: false, error: 'No recipient for this event' });
      return;
    }
    const provision = await provisionPaidOrder({
      orderId: String(variables.order_id ?? ''),
      paymentId: String(variables.payment_id ?? ''),
      customerId: event.customerId ?? null,
      email: recipientForProvisioning,
      businessName: String(variables.business_name ?? ''),
      planName: String(variables.plan_name ?? ''),
      amountPaise: Number(variables.amount_paise ?? 0) || undefined,
      currency: String(variables.currency ?? 'INR'),
      purchaseConfirmedAt: String(variables.purchased_at ?? ''),
      intakeSessionId: String(variables.intake_session_id ?? variables.intake_session ?? ''),
      storageFileIds,
    });
    if (!provision.ok) {
      res.status(502).json({ ok: false, error: provision.reason });
      return;
    }
    variables.provisioned = true;
    variables.provisioning_repeated = provision.repeated;
  }

  // A ready/deployed/domain-connected event must carry the real recorded domain.
  // Without it the render fails closed instead of inventing a live URL.
  if (['website.ready', 'website.deployed', 'website.domain_connected'].includes(template)) {
    const domain = String(variables.domain ?? '').trim();
    if (!domain) {
      res.status(400).json({ ok: false, error: `${template} requires a recorded domain` });
      return;
    }
    try {
      variables.website_url = String(variables.website_url ?? '') || websiteUrl(domain);
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
      return;
    }
  }

  // Resolution order: explicit recipient, then the customer's own address.
  let recipient = String(event.recipient ?? variables.email ?? '').trim();
  if (!isValidRecipient(recipient)) {
    recipient = event.customerId ? await resolveCustomerEmail(event.customerId) : '';
  }
  if (!recipient) {
    res.status(400).json({ ok: false, error: 'No recipient for this event' });
    return;
  }

  const result: DispatchResult = await dispatchEmail({
    eventName: event.name,
    template,
    to: recipient,
    variables: variables as never,
    customerId: event.customerId ?? null,
    correlationId: `evt:${event.id}`,
    dedupeKey: `event:${event.name}:${event.id}`,
  });
  res.status(result.status === 'failed' ? 502 : 200).json({
    ok: result.status !== 'failed',
    status: result.status,
    template,
    id: event.id,
    reason: result.reason,
  });
});

async function resolveCustomerEmail(userId: string): Promise<string> {
  const users = await db.list('users', { id: userId }, 1);
  const email = users[0] ? String((users[0] as { email?: string }).email ?? '') : '';
  return email;
}
