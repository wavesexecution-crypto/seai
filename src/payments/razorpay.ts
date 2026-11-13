import { config } from '../config.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay direct API client for ops invoice one-off payments.
 * Server-side only — key_secret never leaves this process.
 *
 * Order creation: POST https://api.razorpay.com/v1/orders
 *   returns { id: 'order_...', amount, currency, status, ... }
 *
 * Webhook verification: HMAC-SHA256(rawBody, razorpayWebhookSecret)
 *   compared against X-Razorpay-Signature header.
 */

const base = 'https://api.razorpay.com/v1';

function requireKeyId(): string {
  const key = (config.razorpayKeyId ?? '').trim();
  if (!key) throw new Error('Razorpay key id is not configured (RAZORPAY_KEY_ID)');
  return key;
}

function requireKeySecret(): string {
  const key = (config.razorpayKeySecret ?? '').trim();
  if (!key) throw new Error('Razorpay key secret is not configured (RAZORPAY_KEY_SECRET)');
  return key;
}

function requireWebhookSecret(): string {
  const secret = (config.razorpayWebhookSecret ?? '').trim();
  if (!secret) throw new Error('Razorpay webhook secret is not configured (RAZORPAY_WEBHOOK_SECRET)');
  return secret;
}

export interface RazorpayOrderInput {
  amountInr: number;        // whole rupees
  currency?: string;        // default INR
  receipt?: string;         // merchant reference (invoice number)
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;               // order_...
  entity: string;
  amount: number;           // paise
  currency: string;
  status: string;
  receipt?: string | null;
  notes?: Record<string, string>;
  created_at: number;
}

export async function createOrder(input: RazorpayOrderInput): Promise<RazorpayOrder> {
  const keyId = requireKeyId();
  const keySecret = requireKeySecret();
  const amountPaise = Math.round(input.amountInr * 100);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: input.currency ?? 'INR',
        receipt: input.receipt ?? undefined,
        notes: input.notes ?? {},
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Razorpay unreachable (${(err as Error)?.message ?? err})`);
  } finally {
    clearTimeout(timer);
  }

  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    throw new Error(data?.error?.description || `Razorpay returned ${res.status}`);
  }
  return {
    id: data.id,
    entity: data.entity,
    amount: data.amount,
    currency: data.currency,
    status: data.status,
    receipt: data.receipt ?? undefined,
    notes: data.notes ?? undefined,
    created_at: data.created_at,
  };
}

/**
 * Verify a Razorpay webhook signature.
 * Razorpay signs the raw body with the webhook secret using HMAC-SHA256.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
  try {
    const secret = requireWebhookSecret();
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isConfigured(): boolean {
  return Boolean(config.razorpayKeyId && config.razorpayKeySecret && config.razorpayWebhookSecret);
}
