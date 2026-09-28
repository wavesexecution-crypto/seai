/**
 * Payment proxy tests (no dependencies — node:test + global fetch).
 * seai.payments is stubbed at the fetch layer; assertions prove the proxy
 * contract: exact upstream paths, Bearer service auth, server-authoritative
 * plans, and no secret leakage into browser responses.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SEAI_PAYMENT_API_BASE = 'https://payments.test/api/v1';
process.env.SEAI_PUBLIC_SERVICE_KEY = 'test-payment-key';
process.env.ALLOWED_ORIGIN = 'https://seai.store';

const seen = [];

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
    return jsonResponse(200, {
      ok: true,
      order: { id: 'ord-1', razorpayOrderId: 'order_rzp1', amountPaise: 499900, currency: 'INR', keyId: 'rzp_test_x', status: 'order_created' },
    });
  }
  if (u === 'https://payments.test/api/v1/payments/verify') {
    if (!body?.razorpaySignature) return jsonResponse(400, { ok: false, error: 'bad signature' });
    return jsonResponse(200, {
      ok: true,
      payment: { id: 'pay-1', orderId: 'ord-1', amountPaise: 499900, currency: 'INR', status: 'captured' },
      order: { id: 'ord-1', status: 'paid' },
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

describe('payment proxy', () => {
  it('creates orders against /orders with Bearer service auth', async () => {
    const res = await call('POST', '/api/payment/order', {
      customerId: 'cust_abc',
      planId: 'business',
      idempotencyKey: 'intake_x',
      metadata: { source: 'seai.public' },
    });
    assert.equal(res.status, 200);
    // Server-authoritative amount from payments, never the browser.
    assert.equal(res.body.order.amountPaise, 499900);
    assert.ok(!JSON.stringify(res.body).includes('test-payment-key'));
    const fwd = seen.find((s) => s.url.endsWith('/orders'));
    assert.equal(fwd.headers.authorization, 'Bearer test-payment-key');
    assert.equal(fwd.headers['x-idempotency-key'], 'intake_x');
    assert.equal(fwd.body.planId, 'business');
  });

  it('rejects unknown plans before calling upstream', async () => {
    const before = seen.length;
    const res = await call('POST', '/api/payment/order', { customerId: 'c', planId: 'free-forever' });
    assert.equal(res.status, 400);
    assert.equal(seen.length, before);
  });

  it('requires customerId and planId', async () => {
    const res = await call('POST', '/api/payment/order', { planId: 'business' });
    assert.equal(res.status, 400);
  });

  it('verifies payments against /payments/verify without bypass', async () => {
    const res = await call('POST', '/api/payment/verify', {
      razorpayOrderId: 'order_rzp1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'sig_valid',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.order.status, 'paid');
    const bad = await call('POST', '/api/payment/verify', { razorpayOrderId: 'o', razorpayPaymentId: 'p' });
    assert.equal(bad.status, 400);
  });

  it('proxies public plans without secrets', async () => {
    const res = await call('GET', '/api/payment/plans');
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes('test-payment-key'));
  });
});
