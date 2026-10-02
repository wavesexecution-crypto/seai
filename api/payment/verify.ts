/**
 * POST /api/payment/verify
 *
 * Forwards the three values a Razorpay Checkout handler returns to
 * seai.payments, which performs the actual HMAC signature check against
 * Razorpay. This function never decides that a payment succeeded; it only
 * relays the answer.
 *
 * Verification is intentionally NOT sufficient to show the customer success:
 * seai.payments marks the order paid on the Razorpay webhook. The client polls
 * GET /api/payment/status for that authoritative state.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  PublicError,
  bodyErrorResponse,
  callPaymentsApi,
  isPublicError,
  normaliseVerifyInput,
  readJsonBody,
  resolvePaymentsConfig,
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
    input = normaliseVerifyInput(body.value);
  } catch (err) {
    if (isPublicError(err)) {
      return res.status((err as PublicError).status).json({ ok: false, error: (err as PublicError).message });
    }
    console.error('[payment-verify] validation error', err);
    return res.status(400).json({ ok: false, error: 'Invalid verification request' });
  }

  const { paymentApiBase, serviceKey } = resolvePaymentsConfig();

  const upstream = await callPaymentsApi({
    baseUrl: paymentApiBase,
    serviceKey,
    path: '/payments/verify',
    method: 'POST',
    body: input,
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const payment = upstream.data?.payment;
  const order = upstream.data?.order;
  if (!payment || !order) {
    return res
      .status(502)
      .json({ ok: false, error: 'Payment service returned an incomplete verification' });
  }

  return res.status(200).json({
    ok: true,
    payment: {
      id: payment.id ?? null,
      amountPaise: payment.amountPaise ?? null,
      currency: payment.currency ?? null,
      method: payment.method ?? null,
      status: payment.status ?? null,
      capturedAt: payment.capturedAt ?? null,
    },
    order: {
      id: order.id ?? null,
      status: order.status ?? null,
    },
  });
  } catch (err: any) {
    console.error('[payment-verify] unhandled error', err);
    if (res.headersSent) return;
    const status = typeof err?.status === 'number' ? err.status : 500;
    return res.status(status).json({ ok: false, error: status === 500 ? 'Payment verification failed' : err.message });
  }
}
