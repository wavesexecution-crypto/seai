/**
 * GET /api/payment/status?orderId=<uuid>
 *
 * Authoritative order state, read from seai.payments.
 *
 * This is the step that makes the customer-facing "you're paid" screen honest.
 * Razorpay Checkout returning a handler callback only proves the customer
 * completed a checkout; the order is not marked `paid` until seai.payments
 * receives and verifies the Razorpay webhook. The client polls this endpoint
 * and only renders success once `paid` is observed here.
 *
 * Nothing in this file infers or fabricates a status.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  callPaymentsApi,
  describeOrderStatus,
  isUuid,
  resolvePaymentsConfig,
} from '../../server/payments-core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const raw = Array.isArray(req.query.orderId) ? req.query.orderId[0] : req.query.orderId;

  if (typeof raw !== 'string' || raw.length === 0) {
    return res.status(400).json({ ok: false, error: 'orderId is required' });
  }
  if (!isUuid(raw)) {
    return res.status(400).json({ ok: false, error: 'orderId must be a UUID' });
  }

  const { paymentApiBase, serviceKey } = resolvePaymentsConfig();

  const upstream = await callPaymentsApi({
    baseUrl: paymentApiBase,
    serviceKey,
    path: `/orders/${encodeURIComponent(raw)}`,
    method: 'GET',
  });

  if (!upstream.ok) {
    // An order that does not exist upstream is a 404, not a gateway error.
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const status = describeOrderStatus(upstream.data);
  if (!status) {
    return res.status(502).json({ ok: false, error: 'Payment service returned an incomplete order' });
  }

  // Short-lived: this drives a live poll and must not be cached.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({ ok: true, order: status });
}
