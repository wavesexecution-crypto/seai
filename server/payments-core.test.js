/**
 * Unit tests for the body reader and validation in server/payments-core.js.
 *
 * The first describe block is a regression guard for the reported production
 * bug: "Vercel serverless /api/payment/order returned 'Invalid JSON'". The cause
 * was `for await (const chunk of req)`. On Vercel's Node runtime the platform
 * has already consumed the socket by the time the handler runs, so the async
 * iterator yields nothing and the handler answers with a missing-field error
 * instead of forwarding the order. Each case below reproduces a different way
 * a request body reaches a handler and asserts we parse it exactly once.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  ALLOWED_PLANS,
  DEFAULT_TIMEOUT_MS,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  PublicError,
  bodyErrorResponse,
  callPaymentsApi,
  describeOrderStatus,
  isUuid,
  newUuid,
  normaliseOrderInput,
  normaliseVerifyInput,
  readJsonBody,
  resolvePaymentsConfig,
  toCheckoutPayload,
} from './payments-core.js';

const UUID_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UUID_B = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('readJsonBody', () => {
  it('reads a body the platform already parsed (Vercel express.json path)', async () => {
    const req = { body: { customerId: UUID_A, planId: 'business' } };
    const out = await readJsonBody(req);
    assert.equal(out.ok, true);
    assert.equal(out.value.planId, 'business');
  });

  it('reads a body the platform buffered (Vercel leaves a Buffer for some types)', async () => {
    const req = { body: Buffer.from(JSON.stringify({ customerId: UUID_A, planId: 'starter' }), 'utf8') };
    const out = await readJsonBody(req);
    assert.equal(out.ok, true);
    assert.equal(out.value.planId, 'starter');
  });

  it('reads a body the platform left as a string', async () => {
    const req = { body: '{"planId":"complete"}' };
    const out = await readJsonBody(req);
    assert.equal(out.ok, true);
    assert.equal(out.value.planId, 'complete');
  });

  it('reads an untouched stream exactly once', async () => {
    const req = Readable.from([Buffer.from('{"planId":') , Buffer.from('"business"}')]);
    const out = await readJsonBody(req);
    assert.equal(out.ok, true);
    assert.equal(out.value.planId, 'business');
  });

  it('handles a multi-byte character split across stream chunks', async () => {
    // "₹" is 3 UTF-8 bytes; splitting it mid-sequence is exactly the corruption
    // that produces a bogus "Invalid JSON" from naive stream concatenation.
    const bytes = Buffer.from(JSON.stringify({ note: '₹2,999' }), 'utf8');
    const req = Readable.from([bytes.subarray(0, 20), bytes.subarray(20)]);
    const out = await readJsonBody(req);
    assert.equal(out.ok, true);
    assert.equal(out.value.note, '₹2,999');
  });

  it('does not double-consume: a pre-read body is not re-read from the stream', async () => {
    // This is the regression that produced "Invalid JSON": the platform parsed
    // the body AND the handler drained the stream, so the handler saw a
    // different byte sequence than the one that was signed/sent.
    const stream = Readable.from([Buffer.from('{"planId":"tampered"}')]);
    const req = Object.assign(stream, { body: { planId: 'business' } });
    const out = await readJsonBody(req);
    assert.equal(out.ok, true);
    assert.equal(out.value.planId, 'business', 'the parsed body wins; the stream is never drained');
  });

  it('reports invalid JSON rather than throwing', async () => {
    const out = await readJsonBody({ body: 'not json at all' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'invalid_json');
  });

  it('reports an empty body', async () => {
    assert.deepEqual(await readJsonBody({ body: '' }), { ok: false, error: 'empty_body' });
    assert.deepEqual(await readJsonBody({}), { ok: false, error: 'empty_body' });
  });

  it('rejects an over-limit buffer or string body', async () => {
    const asString = await readJsonBody({ body: JSON.stringify({ blob: 'x'.repeat(2048) }) }, { limitBytes: 512 });
    assert.equal(asString.ok, false);
    assert.equal(asString.error, 'body_too_large');

    const asBuffer = await readJsonBody({ body: Buffer.alloc(2048, 0x78) }, { limitBytes: 512 });
    assert.equal(asBuffer.ok, false);
    assert.equal(asBuffer.error, 'body_too_large');
  });

  it('passes through an already-parsed object without re-measuring it', async () => {
    // The platform (Vercel / express.json) applied its own 1mb limit before
    // this handler ran, so the object is already bounded. Re-serialising it to
    // measure it would cost CPU and cannot reject anything the platform let in.
    const big = { blob: 'x'.repeat(2048) };
    const out = await readJsonBody({ body: big }, { limitBytes: 512 });
    assert.equal(out.ok, true);
    assert.equal(out.value, big);
  });

  it('rejects an over-limit stream instead of buffering it', async () => {
    const req = Readable.from([Buffer.from('x'.repeat(4096))]);
    const out = await readJsonBody(req, { limitBytes: 256 });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'body_too_large');
  });
});

describe('bodyErrorResponse', () => {
  it('maps every failure to a 4xx and never to 500', () => {
    for (const code of ['invalid_json', 'body_too_large', 'body_read_failed', 'empty_body']) {
      const { status } = bodyErrorResponse(code);
      assert.ok(status >= 400 && status < 500, `${code} -> ${status}`);
    }
    assert.equal(bodyErrorResponse('invalid_json').message, 'Request body must be valid JSON');
  });
});

describe('normaliseOrderInput', () => {
  it('accepts a UUID customer and a known plan', () => {
    const out = normaliseOrderInput({ customerId: UUID_A, planId: 'business', idempotencyKey: 'k1' });
    assert.equal(out.customerId, UUID_A);
    assert.equal(out.planId, 'business');
    assert.equal(out.idempotencyKey, 'k1');
  });

  it('rejects a non-UUID customerId', () => {
    // This is the bug that made every real purchase fail: the client sent
    // "cust_<email>_<ts>" while the contract requires a UUID.
    assert.throws(() => normaliseOrderInput({ customerId: 'cust_john_abc', planId: 'business' }), (e) => {
      assert.ok(e instanceof PublicError);
      assert.equal(e.status, 400);
      assert.match(e.message, /UUID/);
      return true;
    });
  });

  it('rejects every plan outside the allowlist', () => {
    for (const planId of ['free', 'enterprise', '', null, 42, 'starter ']) {
      assert.throws(() => normaliseOrderInput({ customerId: UUID_A, planId }), PublicError);
    }
    for (const planId of ALLOWED_PLANS) {
      assert.equal(normaliseOrderInput({ customerId: UUID_A, planId }).planId, planId);
    }
  });

  it('ignores any amount the client tries to smuggle in', () => {
    const out = normaliseOrderInput({
      customerId: UUID_A,
      planId: 'starter',
      amount: 1,
      amountPaise: 1,
      price: 1,
      total: 1,
    });
    for (const key of ['amount', 'amountPaise', 'price', 'total']) {
      assert.equal(out[key], undefined, `${key} must not survive validation`);
    }
    assert.deepEqual(Object.keys(out).sort(), ['customerId', 'idempotencyKey', 'metadata', 'planId']);
  });

  it('generates an idempotency key when absent, and bounds its length', () => {
    // `Date.now().toString(36)` for 1 is "1"; (0.5).toString(36) is "0.i" so
    // the random slice is "i".
    const a = normaliseOrderInput({ customerId: UUID_A, planId: 'starter' }, { now: () => 1, random: () => 0.5 });
    assert.equal(a.idempotencyKey, 'intake_1_i');
    const long = normaliseOrderInput({
      customerId: UUID_A,
      planId: 'starter',
      idempotencyKey: 'x'.repeat(500),
    });
    assert.equal(long.idempotencyKey.length, MAX_IDEMPOTENCY_KEY_LENGTH);
  });

  it('discards a non-object metadata field', () => {
    assert.equal(normaliseOrderInput({ customerId: UUID_A, planId: 'starter', metadata: 'x' }).metadata, undefined);
    assert.equal(normaliseOrderInput({ customerId: UUID_A, planId: 'starter', metadata: [1] }).metadata, undefined);
    const meta = { source: 'seai.public' };
    assert.equal(normaliseOrderInput({ customerId: UUID_A, planId: 'starter', metadata: meta }).metadata, meta);
  });
});

describe('normaliseVerifyInput', () => {
  it('names every missing field', () => {
    assert.throws(() => normaliseVerifyInput({}), (e) => {
      assert.match(e.message, /razorpayOrderId/);
      assert.match(e.message, /razorpayPaymentId/);
      assert.match(e.message, /razorpaySignature/);
      return true;
    });
  });

  it('passes through a complete triple', () => {
    const out = normaliseVerifyInput({ razorpayOrderId: 'o', razorpayPaymentId: 'p', razorpaySignature: 's' });
    assert.equal(out.razorpaySignature, 's');
  });
});

describe('resolvePaymentsConfig', () => {
  it('prefers the documented SEAI_PUBLIC_SERVICE_KEY', () => {
    const cfg = resolvePaymentsConfig({ SEAI_PUBLIC_SERVICE_KEY: 'right', SEAPI_PUBLIC_SERVICE_KEY: 'typo' });
    assert.equal(cfg.serviceKey, 'right');
  });

  it('accepts the legacy misspelling so deployments do not silently 401', () => {
    const cfg = resolvePaymentsConfig({ SEAPI_PUBLIC_SERVICE_KEY: 'typo' });
    assert.equal(cfg.serviceKey, 'typo');
  });

  it('strips trailing slashes from the base URL', () => {
    assert.equal(
      resolvePaymentsConfig({ SEAI_PAYMENT_API_BASE: 'https://payments.seai.store/api/v1///' }).paymentApiBase,
      'https://payments.seai.store/api/v1',
    );
  });
});

describe('callPaymentsApi', () => {
  it('fails closed when no service key is configured', async () => {
    const out = await callPaymentsApi({ baseUrl: 'https://x', serviceKey: '', path: '/plans' });
    assert.equal(out.ok, false);
    assert.equal(out.status, 500);
  });

  it('attaches the service key and never leaks it on failure', async () => {
    const fetchImpl = async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer secret-key');
      return new Response(JSON.stringify({ ok: false, error: 'nope' }), { status: 400 });
    };
    const out = await callPaymentsApi({
      baseUrl: 'https://x',
      serviceKey: 'secret-key',
      path: '/orders',
      method: 'POST',
      body: {},
      fetchImpl,
    });
    assert.equal(out.ok, false);
    assert.equal(out.status, 400);
    assert.ok(!JSON.stringify(out).includes('secret-key'));
  });

  it('turns a non-JSON upstream response into 502, not a crash', async () => {
    const fetchImpl = async () => new Response('<html>502 Bad Gateway</html>', { status: 200 });
    const out = await callPaymentsApi({ baseUrl: 'https://x', serviceKey: 'k', path: '/plans', fetchImpl });
    assert.equal(out.ok, false);
    assert.equal(out.status, 502);
  });

  it('maps a network failure to 503 and a timeout to 504', async () => {
    const boom = async () => {
      throw new TypeError('fetch failed');
    };
    const out = await callPaymentsApi({ baseUrl: 'https://x', serviceKey: 'k', path: '/p', fetchImpl: boom });
    assert.equal(out.status, 503);

    const slow = async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    };
    const out2 = await callPaymentsApi({ baseUrl: 'https://x', serviceKey: 'k', path: '/p', fetchImpl: slow });
    assert.equal(out2.status, 504);
  });

  it('bounds an oversized upstream error string', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: 'x'.repeat(5000) }), { status: 400 });
    const out = await callPaymentsApi({ baseUrl: 'https://x', serviceKey: 'k', path: '/p', fetchImpl });
    assert.equal(out.error.length, 200);
  });

  it('sends no body on GET', async () => {
    let seenBody = 'unset';
    const fetchImpl = async (_u, init) => {
      seenBody = init.body;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await callPaymentsApi({ baseUrl: 'https://x', serviceKey: 'k', path: '/plans', fetchImpl });
    assert.equal(seenBody, undefined);
  });
});

describe('toCheckoutPayload', () => {
  it('projects only server-authoritative checkout fields', () => {
    const out = toCheckoutPayload({
      ok: true,
      order: {
        id: UUID_A,
        razorpayOrderId: 'order_1',
        amountPaise: 299900,
        currency: 'INR',
        keyId: 'rzp_test_1',
        status: 'order_created',
      },
    });
    assert.deepEqual(out, {
      orderId: UUID_A,
      razorpayOrderId: 'order_1',
      amountPaise: 299900,
      currency: 'INR',
      keyId: 'rzp_test_1',
      status: 'order_created',
    });
  });

  it('refuses an order missing anything Checkout needs', () => {
    assert.equal(toCheckoutPayload({ order: null }), null);
    assert.equal(toCheckoutPayload({}), null);
    // No razorpayOrderId -> Checkout cannot open.
    assert.equal(toCheckoutPayload({ order: { id: UUID_A, amountPaise: 1, keyId: 'k' } }), null);
    // No amount -> nothing to charge.
    assert.equal(toCheckoutPayload({ order: { id: UUID_A, razorpayOrderId: 'o', keyId: 'k' } }), null);
    // No keyId -> Checkout cannot open.
    assert.equal(
      toCheckoutPayload({ order: { id: UUID_A, razorpayOrderId: 'o', amountPaise: 1, keyId: '' } }),
      null,
    );
  });
});

describe('describeOrderStatus', () => {
  it('marks only paid as paid', () => {
    for (const status of ['order_created', 'checkout_started', 'created']) {
      assert.equal(describeOrderStatus({ order: { status } }).paid, false, status);
      assert.equal(describeOrderStatus({ order: { status } }).failed, false, status);
    }
    assert.equal(describeOrderStatus({ order: { status: 'paid' } }).paid, true);
  });

  it('marks failed/cancelled/refunded as failed so no receipt is shown', () => {
    for (const status of ['failed', 'cancelled', 'refunded']) {
      const d = describeOrderStatus({ order: { status } });
      assert.equal(d.paid, false, status);
      assert.equal(d.failed, true, status);
    }
  });

  it('defaults currency and tolerates a missing body', () => {
    assert.equal(describeOrderStatus({ order: { status: 'paid' } }).currency, 'INR');
    assert.equal(describeOrderStatus(null), null);
    assert.equal(describeOrderStatus({ order: 'nope' }), null);
  });
});

describe('uuid helpers', () => {
  it('generates valid v4 uuids', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = newUuid();
      assert.ok(isUuid(id), id);
      assert.equal(id[14], '4', 'version nibble');
      assert.ok('89ab'.includes(id[19]), 'variant nibble');
    }
  });

  it('rejects non-uuids', () => {
    for (const bad of ['', 'cust_x', '1234', null, undefined, 42, {}, `${UUID_A}x`]) {
      assert.equal(isUuid(bad), false, String(bad));
    }
    assert.equal(isUuid(UUID_A), true);
    assert.equal(isUuid(UUID_B), true);
  });
});

describe('contract constants', () => {
  it('matches the plan allowlist and default timeout used everywhere', () => {
    assert.deepEqual([...ALLOWED_PLANS], ['starter', 'business', 'complete']);
    assert.equal(DEFAULT_TIMEOUT_MS, 15000);
  });
});
