/**
 * Payment proxy tests (no dependencies — node:test + global fetch).
 * seai.payments is stubbed at the fetch layer; assertions prove the proxy
 * contract: exact upstream paths, Bearer service auth, server-authoritative
 * plans, webhook-gated confirmation, and no secret leakage into responses.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SEAI_PAYMENT_API_BASE = 'https://payments.test/api/v1';
process.env.SEAI_PUBLIC_SERVICE_KEY = 'test-payment-key';
process.env.ALLOWED_ORIGIN = 'https://seai.store';

const seen = [];

// seai.payments types customerId as z.string().uuid() and order ids are
// generated with randomUUID(), so the fixtures must be real UUIDs.
const CUSTOMER_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ORDER_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9';

/** Mutable so a test can move the order to its webhook-confirmed state. */
const state = { orderStatus: 'order_created' };

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const realFetch = globalThis.fetch.bind(globalThis);

async function stubFetch(url, init = {}) {
  const u = String(url);
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[String(k).toLowerCase()] = v;
  let body = null;
  try {
    body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }
  seen.push({ url: u, method: init.method || 'GET', headers, body });
  if (headers.authorization !== 'Bearer test-payment-key') {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }
  if (u === 'https://payments.test/api/v1/orders') {
    if (!['starter', 'business', 'complete'].includes(body?.planId)) {
      return jsonResponse(400, { ok: false, error: 'Unknown plan' });
    }
    if (!/^[0-9a-f-]{36}$/i.test(body?.customerId ?? '')) {
      return jsonResponse(400, { ok: false, error: 'customerId must be a UUID' });
    }
    return jsonResponse(200, {
      ok: true,
      order: {
        id: ORDER_UUID,
        razorpayOrderId: 'order_rzp1',
        amountPaise: 499900,
        currency: 'INR',
        keyId: 'rzp_test_x',
        status: 'order_created',
      },
    });
  }
  if (u === 'https://payments.test/api/v1/payments/verify') {
    if (!body?.razorpaySignature) return jsonResponse(400, { ok: false, error: 'bad signature' });
    return jsonResponse(200, {
      ok: true,
      payment: { id: 'pay-1', orderId: ORDER_UUID, amountPaise: 499900, currency: 'INR', status: 'captured' },
      order: { id: ORDER_UUID, status: state.orderStatus },
    });
  }
  if (u === `https://payments.test/api/v1/orders/${ORDER_UUID}`) {
    return jsonResponse(200, {
      ok: true,
      order: {
        id: ORDER_UUID,
        razorpayOrderId: 'order_rzp1',
        planId: 'business',
        planName: 'BUSINESS',
        amountPaise: 499900,
        currency: 'INR',
        status: state.orderStatus,
      },
    });
  }
  if (u === 'https://payments.test/api/v1/plans') {
    return jsonResponse(200, { ok: true, plans: [{ id: 'business', amountPaise: 499900 }] });
  }
  return jsonResponse(404, { ok: false, error: 'Not found' });
}

globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://payments.test')) return stubFetch(url, init);
  return realFetch(url, init);
};

const { app } = await import('./payment-proxy.js');

let server;
let base;

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  state.orderStatus = 'order_created';
});

describe('payment proxy', () => {
  it('creates orders against /orders with Bearer service auth', async () => {
    const res = await call('POST', '/api/payment/order', {
      customerId: CUSTOMER_UUID,
      planId: 'business',
      idempotencyKey: 'intake_x',
      metadata: { source: 'seai.public' },
    });
    assert.equal(res.status, 200);
    // Server-authoritative amount from payments, never the browser.
    assert.equal(res.body.order.amountPaise, 499900);
    assert.equal(res.body.order.currency, 'INR');
    // Razorpay Checkout needs these three; they all come from upstream.
    assert.equal(res.body.order.razorpayOrderId, 'order_rzp1');
    assert.equal(res.body.order.keyId, 'rzp_test_x');
    assert.ok(!JSON.stringify(res.body).includes('test-payment-key'));
    const fwd = seen.find((s) => s.url.endsWith('/orders'));
    assert.equal(fwd.headers.authorization, 'Bearer test-payment-key');
    assert.equal(fwd.headers['x-idempotency-key'], 'intake_x');
    assert.equal(fwd.body.planId, 'business');
  });

  it('never forwards a browser-supplied amount', async () => {
    const res = await call('POST', '/api/payment/order', {
      customerId: CUSTOMER_UUID,
      planId: 'starter',
      amount: 1,
      amountPaise: 1,
      total: 1,
      price: 1,
    });
    assert.equal(res.status, 200);
    // stub returns 499900 for every plan, proving the client value is ignored
    assert.equal(res.body.order.amountPaise, 499900);
    const fwd = seen.filter((s) => s.url.endsWith('/orders')).pop();
    const forwarded = JSON.stringify(fwd.body);
    for (const key of ['amount', 'amountPaise', 'total', 'price']) {
      assert.ok(!forwarded.includes(`"${key}"`), `client ${key} must not be forwarded`);
    }
  });

  it('rejects unknown plans before calling upstream', async () => {
    const before = seen.length;
    const res = await call('POST', '/api/payment/order', {
      customerId: CUSTOMER_UUID,
      planId: 'free-forever',
    });
    assert.equal(res.status, 400);
    assert.equal(seen.length, before);
  });

  it('rejects a non-UUID customerId, which upstream would refuse anyway', async () => {
    const before = seen.length;
    const res = await call('POST', '/api/payment/order', { customerId: 'cust_abc', planId: 'business' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /UUID/);
    assert.equal(seen.length, before, 'must not spend an upstream call on a doomed request');
  });

  it('requires customerId and planId', async () => {
    const res = await call('POST', '/api/payment/order', { planId: 'business' });
    assert.equal(res.status, 400);
  });

  it('generates an idempotency key when the client omits one', async () => {
    const res = await call('POST', '/api/payment/order', { customerId: CUSTOMER_UUID, planId: 'starter' });
    assert.equal(res.status, 200);
    const fwd = seen.filter((s) => s.url.endsWith('/orders')).pop();
    assert.ok(fwd.headers['x-idempotency-key'], 'header must never be undefined');
    assert.equal(fwd.body.idempotencyKey, fwd.headers['x-idempotency-key']);
  });

  it('verifies payments against /payments/verify without bypass', async () => {
    const res = await call('POST', '/api/payment/verify', {
      razorpayOrderId: 'order_rzp1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'sig_valid',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.payment.status, 'captured');
    const bad = await call('POST', '/api/payment/verify', { razorpayOrderId: 'o', razorpayPaymentId: 'p' });
    assert.equal(bad.status, 400);
  });

  it('reports paid only once the webhook has written the state', async () => {
    // Verification alone does not flip the order.
    const early = await call('GET', `/api/payment/status?orderId=${ORDER_UUID}`);
    assert.equal(early.status, 200);
    assert.equal(early.body.order.status, 'order_created');
    assert.equal(early.body.order.paid, false);

    // The webhook lands.
    state.orderStatus = 'paid';
    const after = await call('GET', `/api/payment/status?orderId=${ORDER_UUID}`);
    assert.equal(after.body.order.paid, true);
    assert.equal(after.body.order.planName, 'BUSINESS');
  });

  it('marks failed order states so the client never shows a receipt', async () => {
    state.orderStatus = 'failed';
    const res = await call('GET', `/api/payment/status?orderId=${ORDER_UUID}`);
    assert.equal(res.body.order.paid, false);
    assert.equal(res.body.order.failed, true);
  });

  it('rejects a non-UUID orderId on status', async () => {
    const before = seen.length;
    const res = await call('GET', '/api/payment/status?orderId=ord-1');
    assert.equal(res.status, 400);
    assert.equal(seen.length, before);
  });

  it('proxies public plans with service auth and without secrets', async () => {
    const res = await call('GET', '/api/payment/plans');
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes('test-payment-key'));
    const fwd = seen.find((s) => s.url.endsWith('/plans'));
    // /plans sits behind the same service auth as every other /api/v1 route.
    assert.equal(fwd.headers.authorization, 'Bearer test-payment-key');
  });

  it('rejects non-POST methods on the order endpoint', async () => {
    const res = await fetch(`${base}/api/payment/order`);
    assert.equal(res.status, 405);
  });

  it('surfaces a missing service key as a clear server error, not a 401', async () => {
    const { callPaymentsApi, resolvePaymentsConfig } = await import('./payments-core.js');
    const cfg = resolvePaymentsConfig({});
    assert.equal(cfg.serviceKey, '');
    const out = await callPaymentsApi({
      baseUrl: cfg.paymentApiBase,
      serviceKey: cfg.serviceKey,
      path: '/plans',
    });
    assert.equal(out.ok, false);
    assert.equal(out.status, 500);
    assert.match(out.error, /not configured/);
  });
});
