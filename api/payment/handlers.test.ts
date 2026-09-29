/**
 * Handler-level tests for the Vercel functions in api/payment/*.ts.
 *
 * These run the real default-exported handlers with mock VercelRequest /
 * VercelResponse objects, because the reported production failure
 * ("/api/payment/order returned Invalid JSON") lived in the handler, not in a
 * helper. The mock request reproduces the Vercel Node runtime: the platform has
 * already parsed the body onto `req.body` AND the underlying socket is already
 * ended, so the old `for await (const chunk of req)` drained nothing.
 *
 * Run with: node --import tsx --test api/payment/handlers.test.ts
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.SEAI_PAYMENT_API_BASE = 'https://payments.test/api/v1';
process.env.SEAI_PUBLIC_SERVICE_KEY = 'test-payment-key';

const CUSTOMER_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ORDER_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9';

const state = { orderStatus: 'order_created', orderMode: 'normal' };
const seen: any[] = [];

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  if (!u.startsWith('https://payments.test')) return realFetch(url, init);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[String(k).toLowerCase()] = String(v);
  let body: any = null;
  try {
    body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }
  seen.push({ url: u, method: init.method || 'GET', headers, body });

  if (headers.authorization !== 'Bearer test-payment-key') {
    return jsonResponse(401, { ok: false, error: 'Invalid service API key' });
  }
  if (u === 'https://payments.test/api/v1/orders') {
    if (state.orderMode === 'no-order') {
      return jsonResponse(200, { ok: true, order: { id: ORDER_UUID } });
    }
    return jsonResponse(200, {
      ok: true,
      order: {
        id: ORDER_UUID,
        razorpayOrderId: 'order_rzp1',
        amountPaise: 299900,
        currency: 'INR',
        keyId: 'rzp_test_x',
        status: 'order_created',
      },
    });
  }
  if (u === 'https://payments.test/api/v1/payments/verify') {
    return jsonResponse(200, {
      ok: true,
      payment: { id: 'pay-1', amountPaise: 299900, currency: 'INR', status: 'captured', method: 'card' },
      order: { id: ORDER_UUID, status: state.orderStatus },
    });
  }
  if (u === `https://payments.test/api/v1/orders/${ORDER_UUID}`) {
    return jsonResponse(200, {
      ok: true,
      order: {
        id: ORDER_UUID,
        razorpayOrderId: 'order_rzp1',
        planId: 'starter',
        planName: 'STARTER',
        amountPaise: 299900,
        currency: 'INR',
        status: state.orderStatus,
      },
    });
  }
  if (u === 'https://payments.test/api/v1/plans') {
    return jsonResponse(200, { ok: true, plans: [{ id: 'starter', name: 'STARTER', amountPaise: 299900 }] });
  }
  return jsonResponse(404, { ok: false, error: 'Not found' });
}) as typeof globalThis.fetch;

const { default: orderHandler } = await import('./order.ts');
const { default: verifyHandler } = await import('./verify.ts');
const { default: statusHandler } = await import('./status.ts');
const { default: plansHandler } = await import('./plans.ts');

/**
 * Build a request shaped like the Vercel Node runtime gives a handler:
 * a real (already ended) IncomingMessage plus a pre-parsed `req.body`.
 *
 * The stream is a genuine Readable — not a spread copy — so the prototype
 * methods `readJsonBody` probes for (`on`, `Symbol.asyncIterator`) are present
 * and the "already consumed" flags actually mean something.
 */
function vercelRequest(method: string, body: unknown, query: Record<string, unknown> = {}) {
  const req: any = Readable.from([]);
  Object.defineProperty(req, 'readableEnded', { value: true, configurable: true });
  Object.defineProperty(req, 'destroyed', { value: true, configurable: true });
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  req.query = query;
  req.body = body;
  return req;
}

function vercelPost(body: unknown) {
  return vercelRequest('POST', body);
}

function vercelGet(query: Record<string, unknown> = {}) {
  return vercelRequest('GET', undefined, query);
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
  };
  res.setHeader = (k: string, v: string) => {
    res.headers[String(k).toLowerCase()] = v;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res;
}

beforeEach(() => {
  state.orderStatus = 'order_created';
  state.orderMode = 'normal';
  seen.length = 0;
});

describe('POST /api/payment/order', () => {
  let res: any;
  // Captured here because the shared beforeEach clears `seen` after this runs.
  let fwd: any;
  before(async () => {
    res = mockRes();
    await orderHandler(vercelPost({ customerId: CUSTOMER_UUID, planId: 'starter', idempotencyKey: 'k1' }), res);
    fwd = seen[0];
  });

  it('creates the order instead of failing on the body (regression: "Invalid JSON")', () => {
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
  });

  it('returns the fields Razorpay Checkout needs, all server-side', () => {
    assert.deepEqual(res.body.order, {
      orderId: ORDER_UUID,
      razorpayOrderId: 'order_rzp1',
      amountPaise: 299900,
      currency: 'INR',
      keyId: 'rzp_test_x',
      status: 'order_created',
    });
  });

  it('sent the service key and the idempotency key upstream', () => {
    assert.ok(fwd, 'no upstream call was made');
    assert.equal(fwd.url, 'https://payments.test/api/v1/orders');
    assert.equal(fwd.headers.authorization, 'Bearer test-payment-key');
    assert.equal(fwd.headers['x-idempotency-key'], 'k1');
    assert.equal(fwd.body.idempotencyKey, 'k1');
  });

  it('never echoes the service key to the browser', () => {
    assert.ok(!JSON.stringify(res.body).includes('test-payment-key'));
  });
});

describe('order body handling', () => {
  it('rejects a non-UUID customerId before spending an upstream call', async () => {
    const res = mockRes();
    await orderHandler(vercelPost({ customerId: 'cust_abc', planId: 'starter' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /UUID/);
    assert.equal(seen.length, 0);
  });

  it('rejects an unknown plan before spending an upstream call', async () => {
    const res = mockRes();
    await orderHandler(vercelPost({ customerId: CUSTOMER_UUID, planId: 'enterprise' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(seen.length, 0);
  });

  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const res = mockRes();
    await orderHandler(vercelPost('this is not json'), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /valid JSON/);
  });

  it('returns 400 for a missing body', async () => {
    const res = mockRes();
    await orderHandler(vercelRequest('POST', undefined), res);
    assert.equal(res.statusCode, 400);
  });

  it('ignores a client-supplied amount', async () => {
    const res = mockRes();
    await orderHandler(vercelPost({ customerId: CUSTOMER_UUID, planId: 'starter', amountPaise: 1, amount: 1 }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order.amountPaise, 299900);
    const fwd = JSON.stringify(seen[0].body);
    assert.ok(!fwd.includes('amountPaise'));
    assert.ok(!fwd.includes('"amount"'));
  });

  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await orderHandler(vercelGet({}), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'POST');
  });

  it('rejects a 2xx upstream reply with no usable order', async () => {
    state.orderMode = 'no-order';
    const res = mockRes();
    await orderHandler(vercelPost({ customerId: CUSTOMER_UUID, planId: 'starter' }), res);
    assert.equal(res.statusCode, 502);
  });
});

describe('POST /api/payment/verify', () => {
  it('relays the signature check and returns the upstream verdict', async () => {
    const res = mockRes();
    await verifyHandler(
      vercelPost({ razorpayOrderId: 'order_rzp1', razorpayPaymentId: 'pay_1', razorpaySignature: 'sig' }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payment.status, 'captured');
    assert.equal(res.body.order.status, 'order_created');
    assert.equal(seen[0].url, 'https://payments.test/api/v1/payments/verify');
    assert.equal(seen[0].headers.authorization, 'Bearer test-payment-key');
  });

  it('names missing fields and spends no upstream call', async () => {
    const res = mockRes();
    await verifyHandler(vercelPost({ razorpayOrderId: 'o' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /razorpayPaymentId/);
    assert.equal(seen.length, 0);
  });

  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await verifyHandler(vercelGet({}), res);
    assert.equal(res.statusCode, 405);
  });
});

describe('GET /api/payment/status', () => {
  it('is not paid until the webhook has written the state', async () => {
    const res = mockRes();
    await statusHandler(vercelGet({ orderId: ORDER_UUID }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order.paid, false);
    assert.equal(res.body.order.status, 'order_created');
    assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
  });

  it('reports paid once the webhook lands', async () => {
    state.orderStatus = 'paid';
    const res = mockRes();
    await statusHandler(vercelGet({ orderId: ORDER_UUID }), res);
    assert.equal(res.body.order.paid, true);
    assert.equal(res.body.order.planName, 'STARTER');
  });

  it('surfaces a failed order so no receipt is shown', async () => {
    state.orderStatus = 'failed';
    const res = mockRes();
    await statusHandler(vercelGet({ orderId: ORDER_UUID }), res);
    assert.equal(res.body.order.failed, true);
    assert.equal(res.body.order.paid, false);
  });

  it('validates the orderId', async () => {
    const missing = mockRes();
    await statusHandler(vercelGet({}), missing);
    assert.equal(missing.statusCode, 400);

    const bad = mockRes();
    await statusHandler(vercelGet({ orderId: 'ord-1' }), bad);
    assert.equal(bad.statusCode, 400);
    assert.equal(seen.length, 0);
  });
});

describe('GET /api/payment/plans', () => {
  it('authenticates upstream and leaks no key', async () => {
    const res = mockRes();
    await plansHandler(vercelGet({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.plans[0].amountPaise, 299900);
    assert.equal(seen[0].headers.authorization, 'Bearer test-payment-key');
    assert.ok(!JSON.stringify(res.body).includes('test-payment-key'));
  });
});
