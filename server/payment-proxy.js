/**
 * SEAI Public — Express payment proxy
 *
 * Same-origin proxy for seai.payments. Keeps service-to-service credentials out
 * of the browser.
 *
 * This is the local/self-hosted counterpart to the Vercel functions in
 * `api/payment/*.ts`. Both delegate to `server/payments-core.js` so the two
 * deployments cannot drift out of sync with the upstream contract.
 *
 * Required environment variables:
 * - SEAI_PUBLIC_SERVICE_KEY   service API key for the `seai.public` identity
 *                             (SEAPI_PUBLIC_SERVICE_KEY accepted as an alias)
 * - SEAI_PAYMENT_API_BASE     e.g. https://payments.seai.store/api/v1
 * - ALLOWED_ORIGIN            e.g. https://seai.store
 *
 * Contract: seai.payments README + src/api/routes.ts. Auth is
 * `Authorization: Bearer <SEAI_PUBLIC_SERVICE_KEY>`. Plan pricing is
 * server-authoritative in seai.payments — this proxy allowlists plan IDs and
 * never forwards a browser-supplied amount.
 */

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import {
  ALLOWED_PLANS,
  bodyErrorResponse,
  callPaymentsApi,
  describeOrderStatus,
  isUuid,
  normaliseOrderInput,
  normaliseVerifyInput,
  readJsonBody,
  toCheckoutPayload,
} from './payments-core.js';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || 'https://seai.store',
    credentials: true,
  }),
);
// Parsed here so `readJsonBody` sees an object; the same helper also copes with
// an unparsed stream, so behaviour matches the Vercel functions either way.
app.use(express.json({ limit: '1mb' }));

/** Shared request-body handling for both runtimes. */
async function readBody(req, res) {
  const body = await readJsonBody(req);
  if (body.ok) return body.value;
  const { status, message } = bodyErrorResponse(body.error);
  res.status(status).json({ ok: false, error: message });
  return null;
}

/**
 * Register a POST-only route that answers 405 for every other method.
 *
 * Express would otherwise fall through to its 404 handler, so a GET to
 * /api/payment/order would report 404 here but 405 on Vercel. Same endpoint,
 * same contract, same status.
 */
function postOnly(path, handler) {
  app.post(path, handler);
  app.all(path, (req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
  });
}

/** Register a GET-only route with the same 405 alignment. */
function getOnly(path, handler) {
  app.get(path, handler);
  app.all(path, (req, res) => {
    res.set('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
  });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'seai.public-payment-proxy' });
});

/** Create a payment order. */
postOnly('/api/payment/order', async (req, res) => {
  const raw = await readBody(req, res);
  if (raw === null) return;

  let input;
  try {
    input = normaliseOrderInput(raw);
  } catch (err) {
    return res.status(err.status ?? 400).json({ ok: false, error: err.message });
  }

  const upstream = await callPaymentsApi({
    baseUrl: config.paymentApiBase,
    serviceKey: config.serviceKey,
    path: '/orders',
    method: 'POST',
    body: {
      customerId: input.customerId,
      planId: input.planId,
      idempotencyKey: input.idempotencyKey,
      metadata: { ...(input.metadata ?? {}), source: 'seai.public' },
    },
    extraHeaders: { 'X-Idempotency-Key': input.idempotencyKey },
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const checkout = toCheckoutPayload(upstream.data);
  if (!checkout) {
    return res
      .status(502)
      .json({ ok: false, error: 'Payment service returned an incomplete order' });
  }

  res.json({ ok: true, order: checkout });
});

/** Verify a payment signature through seai.payments. */
postOnly('/api/payment/verify', async (req, res) => {
  const raw = await readBody(req, res);
  if (raw === null) return;

  let input;
  try {
    input = normaliseVerifyInput(raw);
  } catch (err) {
    return res.status(err.status ?? 400).json({ ok: false, error: err.message });
  }

  const upstream = await callPaymentsApi({
    baseUrl: config.paymentApiBase,
    serviceKey: config.serviceKey,
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

  res.json({
    ok: true,
    payment: {
      id: payment.id ?? null,
      amountPaise: payment.amountPaise ?? null,
      currency: payment.currency ?? null,
      method: payment.method ?? null,
      status: payment.status ?? null,
      capturedAt: payment.capturedAt ?? null,
    },
    order: { id: order.id ?? null, status: order.status ?? null },
  });
});

/** Authoritative (webhook-confirmed) order state. */
getOnly('/api/payment/status', async (req, res) => {
  const orderId = req.query.orderId;
  if (typeof orderId !== 'string' || orderId.length === 0) {
    return res.status(400).json({ ok: false, error: 'orderId is required' });
  }
  if (!isUuid(orderId)) {
    return res.status(400).json({ ok: false, error: 'orderId must be a UUID' });
  }

  const upstream = await callPaymentsApi({
    baseUrl: config.paymentApiBase,
    serviceKey: config.serviceKey,
    path: `/orders/${encodeURIComponent(orderId)}`,
    method: 'GET',
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const status = describeOrderStatus(upstream.data);
  if (!status) {
    return res.status(502).json({ ok: false, error: 'Payment service returned an incomplete order' });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({ ok: true, order: status });
});

/** Plan catalogue, straight from the pricing authority. */
getOnly('/api/payment/plans', async (_req, res) => {
  const upstream = await callPaymentsApi({
    baseUrl: config.paymentApiBase,
    serviceKey: config.serviceKey,
    path: '/plans',
    method: 'GET',
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const plans = Array.isArray(upstream.data?.plans) ? upstream.data.plans : [];
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({ ok: true, plans });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[proxy] Payment proxy server running on port ${PORT}`);
  });
}

export { app, ALLOWED_PLANS };
