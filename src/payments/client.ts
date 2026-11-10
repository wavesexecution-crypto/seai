import { config } from '../config.js';

/**
 * Server-side client for seai.payments (Razorpay control plane).
 * Service-to-service ONLY — the Bearer key (SEAI_SERVICE_KEY / PAYMENTS_SERVICE_KEY)
 * never leaves this process. Amounts and plan ids are server-side authoritative
 * in seai.payments; this client only relays parameters.
 *
 * Retainers are genuine Razorpay SUBSCRIPTIONS: create -> client authorises the
 * mandate in checkout with `subscription_id` (NOT `order_id`) -> verify here
 * calls payments /subscriptions/verify which confirms with Razorpay directly.
 * A subscription is never marked active on client claims alone.
 */

export interface PaymentsSubscriptionCreateInput {
  planKey: 'retainer_starter' | 'retainer_growth' | 'retainer_scale' | 'maintenance';
  seaiClientId: string;
  seaiSubscriptionId?: string;
  email: string;
  name?: string;
  phone?: string;
  idempotencyKey?: string;
}

export interface PaymentsSubscriptionCreateResult {
  subscriptionId: string;
  razorpaySubscriptionId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  planName: string;
  status: string;
}

const base = () => config.paymentsApiUrl.replace(/\/$/, '');

function requireKey(): string {
  const key = (config.paymentsServiceKey ?? '').trim();
  if (!key) throw new Error('Payments service key is not configured (PAYMENTS_SERVICE_KEY)');
  return key;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = requireKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Payments service unreachable (${(err as Error)?.message ?? err})`);
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Payments service returned ${res.status}`);
  }
  return data as T;
}

export async function createPaymentsSubscription(input: PaymentsSubscriptionCreateInput): Promise<PaymentsSubscriptionCreateResult> {
  return request<PaymentsSubscriptionCreateResult>('POST', '/api/v1/subscriptions', input);
}

export async function verifyPaymentsSubscription(input: {
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
  razorpaySignature: string;
}): Promise<{ status: string }> {
  return request<{ status: string }>('POST', '/api/v1/subscriptions/verify', input);
}

export async function cancelPaymentsSubscription(id: string, opts: { cancelAtCycleEnd?: boolean; reason?: string } = {}): Promise<{ status: string }> {
  return request<{ status: string }>('POST', `/api/v1/subscriptions/${encodeURIComponent(id)}/cancel`, {
    cancelAtCycleEnd: opts.cancelAtCycleEnd ?? true,
    reason: opts.reason,
  });
}

export async function getPaymentsSubscription(id: string): Promise<Record<string, unknown>> {
  const data = await request<{ subscription: Record<string, unknown> }>('GET', `/api/v1/subscriptions/${encodeURIComponent(id)}`);
  return data.subscription ?? {};
}
