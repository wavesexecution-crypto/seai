/**
 * POST /api/payment/order
 *
 * Creates a payment order in seai.payments on behalf of the browser.
 *
 * The browser sends a customerId (UUID) and a planId. Nothing else is trusted:
 * the amount and currency are resolved upstream from seai.payments' own PLANS
 * table, and the Razorpay keyId returned to the client is the upstream one.
 * The service key stays in this function's environment.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  PublicError,
  bodyErrorResponse,
  callPaymentsApi,
  isPublicError,
  normaliseOrderInput,
  readJsonBody,
  resolvePaymentsConfig,
  toCheckoutPayload,
} from '../../server/payments-core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    const { status, message } = bodyErrorResponse(body.error);
    return res.status(status).json({ ok: false, error: message });
  }

  let input;
  try {
    input = normaliseOrderInput(body.value);
  } catch (err) {
    if (isPublicError(err)) {
      return res.status((err as PublicError).status).json({ ok: false, error: (err as PublicError).message });
    }
    console.error('[payment-order] validation error', err);
    return res.status(400).json({ ok: false, error: 'Invalid order request' });
  }

  const { paymentApiBase, serviceKey } = resolvePaymentsConfig();

  const upstream = await callPaymentsApi({
    baseUrl: paymentApiBase,
    serviceKey,
    path: '/orders',
    method: 'POST',
    body: {
      customerId: input.customerId,
      planId: input.planId,
      idempotencyKey: input.idempotencyKey,
      // `source_service` is stamped by seai.payments from the authenticated
      // service identity. `source` here is only a human-readable breadcrumb.
      metadata: { ...(input.metadata ?? {}), source: 'seai.public' },
    },
    extraHeaders: { 'X-Idempotency-Key': input.idempotencyKey },
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const checkout = toCheckoutPayload(upstream.data);
  if (!checkout) {
    // Upstream said 2xx but did not return a usable order. Treat as a gateway
    // problem rather than handing the client a half-built order.
    return res
      .status(502)
      .json({ ok: false, error: 'Payment service returned an incomplete order' });
  }

  return res.status(200).json({ ok: true, order: checkout });
  } catch (err: any) {
    console.error('[payment-order] unhandled error', err);
    if (res.headersSent) return;
    const status = typeof err?.status === 'number' ? err.status : 500;
    return res.status(status).json({ ok: false, error: status === 500 ? 'Payment order failed' : err.message });
  }
}
