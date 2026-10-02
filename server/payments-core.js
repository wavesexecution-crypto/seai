/**
 * SEAI Public — payments core
 *
 * Single source of truth for every server-side call into seai.payments.
 * Both the Vercel functions in `api/payment/*.ts` and the Express proxy in
 * `server/payment-proxy.js` import this module, so the two deployments cannot
 * drift out of sync with the upstream contract.
 *
 * Contract (seai.payments, src/api/routes.ts + src/domain/types.ts):
 *   POST {base}/orders          -> { ok, order: { id, razorpayOrderId, amountPaise, currency, keyId, status } }
 *   POST {base}/payments/verify -> { ok, payment: {...}, order: {...} }
 *   GET  {base}/orders/:id      -> { ok, order: {...} }
 *   GET  {base}/plans           -> { ok, plans: [...] }
 *   Auth: `Authorization: Bearer <SEAI_PUBLIC_SERVICE_KEY>` on every /api/v1 route.
 *
 * Two invariants this module exists to enforce:
 *
 *  1. PLAN PRICES ARE NEVER READ FROM THE REQUEST. The browser sends a planId
 *     and nothing else. Amounts are resolved by seai.payments from its own
 *     PLANS table, so a tampered client cannot change what it is charged.
 *  2. THE SERVICE KEY NEVER LEAVES THE SERVER. It is read from the environment,
 *     attached to the upstream request only, and is never echoed into a
 *     response body, an error message, or a log line.
 */

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/** Mirrors `createOrderSchema.planId` in seai.payments domain/types.ts. */
export const ALLOWED_PLANS = Object.freeze(['starter', 'business', 'complete']);

/** `createOrderSchema.idempotencyKey` is min(1).max(128). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/** `createOrderSchema.customerId` is `z.string().uuid()`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Matches the 1mb body limit the rest of the stack uses. */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/** Upstream call timeout. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** RFC4122 v4 UUID, used for the client-generated customer identity. */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function newUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Node >= 19 always has randomUUID; this is a defensive fallback only.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An error whose `message` is safe to return to a browser: it is authored here,
 * never derived from an upstream body, so it cannot carry a secret.
 */
export class PublicError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    if (detail) this.detail = detail;
  }
}

export function isPublicError(err) {
  return (
    err instanceof PublicError ||
    (err && typeof err === 'object' && typeof err.status === 'number' && typeof err.message === 'string' && err.name === 'PublicError')
  );
}

// ---------------------------------------------------------------------------
// Request body reading
// ---------------------------------------------------------------------------

function parseText(text, limitBytes) {
  if (text.length === 0) return { ok: false, error: 'empty_body' };
  if (Buffer.byteLength(text, 'utf8') > limitBytes) {
    return { ok: false, error: 'body_too_large' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

function readStream(req, limitBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      // Never leave the request in a half-read state for a later middleware.
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      resolve(err ? { ok: false, error: err } : { ok: true, buffer: value });
    };

    function onData(chunk) {
      size += chunk.length;
      if (size > limitBytes) {
        finish('body_too_large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      finish(null, Buffer.concat(chunks));
    }
    function onError() {
      finish('body_read_failed');
    }
    function onAborted() {
      finish('body_read_failed');
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

/**
 * Read and parse a JSON request body without ever double-consuming the stream.
 *
 * The original bug in this codebase was `for await (const chunk of req)`.
 * Vercel's Node runtime and `express.json()` have already consumed the socket
 * by the time a handler runs, so the async iterator either yields nothing (the
 * handler then reports a missing-field error) or replays bytes in the wrong
 * chunking (the handler reports "Invalid JSON"). Either way the order never
 * reaches seai.payments. seai.payments hit the same class of bug in its own
 * webhook and fixed it by consuming the stream exactly once, up front.
 *
 * Resolution order:
 *   1. `req.body` already populated by the platform or by express.json().
 *      A pre-parsed *object* is returned as-is without re-measuring: the
 *      platform's own body limit (1mb) already bounded it before this handler
 *      ran, so re-serialising it here would cost CPU and change nothing.
 *      Buffer and string bodies are size-checked because in those cases we are
 *      the ones deciding how much to hold in memory.
 *   2. The raw stream, but only if it has not already been read. The limit
 *      applies here: we buffer it, so we must bound it.
 *
 * A body that is absent, unparseable, or oversized is reported, never thrown.
 *
 * @returns {Promise<{ok: true, value: object} | {ok: false, error: string}>}
 */
export async function readJsonBody(req, options = {}) {
  const limitBytes = options.limitBytes ?? DEFAULT_BODY_LIMIT_BYTES;

  const existing = req?.body;
  if (existing !== undefined && existing !== null) {
    if (Buffer.isBuffer(existing)) {
      return existing.length > limitBytes
        ? { ok: false, error: 'body_too_large' }
        : parseText(existing.toString('utf8'), limitBytes);
    }
    if (typeof existing === 'string') return parseText(existing, limitBytes);
    if (typeof existing === 'object') return { ok: true, value: existing };
  }

  const streamIsUsable =
    req &&
    typeof req.on === 'function' &&
    typeof req[Symbol.asyncIterator] === 'function' &&
    !req.readableEnded &&
    !req.destroyed;

  if (streamIsUsable) {
    const result = await readStream(req, limitBytes);
    if (result.ok) {
      if (result.buffer.length === 0) return { ok: false, error: 'empty_body' };
      return parseText(result.buffer.toString('utf8'), limitBytes);
    }
    return { ok: false, error: result.error };
  }

  return { ok: false, error: 'empty_body' };
}

/** Map a readJsonBody failure onto an HTTP status and a safe message. */
export function bodyErrorResponse(error) {
  switch (error) {
    case 'invalid_json':
      return { status: 400, message: 'Request body must be valid JSON' };
    case 'body_too_large':
      return { status: 413, message: 'Request body is too large' };
    case 'body_read_failed':
      return { status: 400, message: 'Could not read request body' };
    default:
      return { status: 400, message: 'Request body is required' };
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalise a create-order request.
 *
 * `amount` is deliberately absent from the accepted fields. There is no code
 * path by which a client-supplied amount can reach seai.payments.
 */
export function normaliseOrderInput(input, options = {}) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  if (!input || typeof input !== 'object') {
    throw new PublicError(400, 'Request body is required');
  }

  const { customerId, planId, idempotencyKey, metadata } = input;

  if (typeof customerId !== 'string' || !isUuid(customerId)) {
    // seai.payments types customerId as z.string().uuid(); catching it here
    // turns an opaque upstream 400 into an actionable message.
    throw new PublicError(400, 'customerId must be a UUID');
  }

  if (typeof planId !== 'string' || !ALLOWED_PLANS.includes(planId)) {
    throw new PublicError(400, 'Unknown plan');
  }

  let key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (key.length === 0) {
    key = `intake_${now().toString(36)}_${random().toString(36).slice(2, 10)}`;
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    key = key.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);
  }

  let cleanMetadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    cleanMetadata = metadata;
  }

  return { customerId, planId, idempotencyKey: key, metadata: cleanMetadata };
}

/** Validate the three fields a Razorpay Checkout handler returns. */
export function normaliseVerifyInput(input) {
  if (!input || typeof input !== 'object') {
    throw new PublicError(400, 'Request body is required');
  }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;
  const missing = [];
  if (typeof razorpayOrderId !== 'string' || !razorpayOrderId) missing.push('razorpayOrderId');
  if (typeof razorpayPaymentId !== 'string' || !razorpayPaymentId) missing.push('razorpayPaymentId');
  if (typeof razorpaySignature !== 'string' || !razorpaySignature) missing.push('razorpaySignature');
  if (missing.length > 0) {
    throw new PublicError(400, `Missing verification fields: ${missing.join(', ')}`);
  }
  return { razorpayOrderId, razorpayPaymentId, razorpaySignature };
}

// ---------------------------------------------------------------------------
// Upstream client
// ---------------------------------------------------------------------------

/**
 * Resolve seai.payments connection settings from the environment.
 *
 * Both names are accepted for the service key: `SEAI_PUBLIC_SERVICE_KEY` is the
 * documented name in seai.payments (`middleware/auth.ts` service map) and in
 * `server/config.js`. `SEAPI_PUBLIC_SERVICE_KEY` is accepted only as a
 * legacy alias so an existing deployment does not silently start sending
 * `Bearer ` with an empty key.
 */
export function resolvePaymentsConfig(env = process.env) {
  const paymentApiBase = env.SEAI_PAYMENT_API_BASE || 'https://payments.seai.store/api/v1';
  const serviceKey = env.SEAI_PUBLIC_SERVICE_KEY || env.SEAPI_PUBLIC_SERVICE_KEY || '';
  return {
    paymentApiBase: paymentApiBase.replace(/\/+$/, ''),
    serviceKey,
  };
}

/**
 * Call seai.payments.
 *
 * - always attaches the service key
 * - always enforces a timeout
 * - tolerates a non-JSON upstream response (proxy error page, 502 HTML) by
 *   reporting a gateway error instead of throwing a parse exception
 * - never puts the service key in a thrown message
 *
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.serviceKey
 * @param {string} options.path
 * @param {string} [options.method]
 * @param {any} [options.body]
 * @param {Record<string, string>} [options.extraHeaders]
 * @param {number} [options.timeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @returns {Promise<{ok: true, status: number, data: any} | {ok: false, status: number, error: string}>}
 */
export async function callPaymentsApi({
  baseUrl,
  serviceKey,
  path,
  method = 'GET',
  body,
  extraHeaders = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
}) {
  if (!serviceKey) {
    // Fail closed and loudly: an unset key would otherwise produce an opaque
    // upstream 401 that looks like a bad plan or a bad customer.
    return { ok: false, status: 500, error: 'Payment service is not configured' };
  }

  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return timedOut
      ? { ok: false, status: 504, error: 'Payment service timed out' }
      : { ok: false, status: 503, error: 'Payment service is unreachable' };
  }

  const text = await response.text().catch(() => '');

  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    // Upstream `error` strings are authored by seai.payments and contain no
    // secrets, but bound the length so a hostile/garbled body cannot echo back.
    const upstream =
      data && typeof data.error === 'string' ? data.error.slice(0, 200) : 'Payment request failed';
    return { ok: false, status: response.status, error: upstream };
  }

  if (data === null) {
    return { ok: false, status: 502, error: 'Payment service returned an unreadable response' };
  }

  return { ok: true, status: response.status, data };
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

/**
 * Project seai.payments' order object down to exactly what the browser needs to
 * open Razorpay Checkout.
 *
 * Everything here originates upstream. `amountPaise`, `currency` and `keyId`
 * are the authoritative charge values, so the client never computes them.
 *
 * @param {any} data
 * @returns {{orderId: any, razorpayOrderId: string, amountPaise: number, currency: string, keyId: string, status: any} | null}
 */
export function toCheckoutPayload(data) {
  const order = data?.order;
  if (!order || typeof order !== 'object') {
    return null;
  }
  if (typeof order.razorpayOrderId !== 'string' || order.razorpayOrderId.length === 0) {
    return null;
  }
  if (!Number.isFinite(order.amountPaise)) {
    return null;
  }
  // A publishable key_id is required for Checkout to open. Rejecting it here
  // means the customer gets one clear error instead of a blank popup.
  if (typeof order.keyId !== 'string' || order.keyId.length === 0) {
    return null;
  }
  return {
    orderId: order.id,
    razorpayOrderId: order.razorpayOrderId,
    amountPaise: order.amountPaise,
    currency: order.currency ?? 'INR',
    keyId: order.keyId,
    status: order.status,
  };
}

/** Terminal-good and terminal-bad order states, per `OrderStatus`. */
export const PAID_STATES = Object.freeze(['paid']);
export const FAILED_STATES = Object.freeze(['failed', 'cancelled', 'refunded']);

/**
 * Interpret an upstream order row for the confirmation poll.
 *
 * `paid` is only reported once seai.payments has recorded it. In production
 * that state is written by the Razorpay webhook, so a `paid` result here is
 * webhook-confirmed, not browser-asserted.
 *
 * @param {any} data
 * @returns {{orderId: any, razorpayOrderId: any, planId: any, planName: any, amountPaise: number | null, currency: string, status: string, paid: boolean, failed: boolean, updatedAt: any} | null}
 */
export function describeOrderStatus(data) {
  const order = data?.order;
  if (!order || typeof order !== 'object') return null;
  const status = typeof order.status === 'string' ? order.status : 'unknown';
  return {
    orderId: order.id ?? null,
    razorpayOrderId: order.razorpayOrderId ?? null,
    planId: order.planId ?? null,
    planName: order.planName ?? null,
    amountPaise: Number.isFinite(order.amountPaise) ? order.amountPaise : null,
    currency: order.currency ?? 'INR',
    status,
    paid: PAID_STATES.includes(status),
    failed: FAILED_STATES.includes(status),
    updatedAt: order.updatedAt ?? null,
  };
}
