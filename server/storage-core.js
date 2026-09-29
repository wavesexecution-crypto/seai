/**
 * SEAI Public — storage intake core
 *
 * Shared by the Vercel functions in `api/storage/**` and the Express proxy in
 * `server/storage-proxy.js`, for the same reason as `payments-core.js`: the two
 * runtimes must not drift.
 *
 * Tenant model: intake is anonymous and pre-payment, so this proxy mints a
 * server-side intake session (httpOnly `seai_intake` cookie, UUID v4) and scopes
 * every storage object to the provisional tenant `customerId = "intake:<uuid>"`.
 * A browser-supplied customerId is never forwarded. Adoption onto a real
 * customer happens later in CDF.
 *
 * The browser only ever receives a short-lived signed upload URL and a storage
 * file ID. Service credentials stay in this process.
 */

import { randomUUID } from 'node:crypto';

export const INTAKE_COOKIE = 'seai_intake';
export const INTAKE_COOKIE_MAX_AGE = 86_400; // 24h
export const MAX_INTAKE_BYTES = 5 * 1024 * 1024;
export const MAX_FILENAME_LENGTH = 253;
export const MAX_MIME_LENGTH = 127;
export const STORAGE_TIMEOUT_MS = 15_000;

export const ALLOWED_CATEGORIES = Object.freeze([
  'logo',
  'image',
  'brand_asset',
  'document',
  'intake_attachment',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIntakeSessionId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function newIntakeSessionId() {
  return randomUUID();
}

export function intakeScope(sessionId) {
  return `intake:${sessionId}`;
}

/** Read one cookie out of a raw `Cookie` header. */
export function getCookie(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Serialise the intake session cookie.
 *
 * httpOnly so script cannot read it, SameSite=Lax so it survives a top-level
 * navigation back from Razorpay, and Secure whenever the site is served over
 * https. Lax (not Strict) is deliberate: after Checkout the customer returns
 * via a cross-site redirect, and Strict would drop the cookie and orphan every
 * file they uploaded.
 */
export function intakeCookieHeader(sessionId, secure) {
  const parts = [
    `${INTAKE_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${INTAKE_COOKIE_MAX_AGE}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** True when the request arrived over https (directly, or via a TLS proxy). */
export function isSecureRequest(req) {
  if (process.env.NODE_ENV === 'production') return true;
  if (req?.headers?.['x-forwarded-proto'] === 'https') return true;
  return req?.protocol === 'https';
}

export function resolveStorageConfig(env = process.env) {
  return {
    storageApiBase: String(env.SEAI_STORAGE_API_BASE || '').replace(/\/+$/, ''),
    storageServiceName: env.SEAI_STORAGE_SERVICE_NAME || 'seai-public',
    storageServiceKey: env.SEAI_STORAGE_SERVICE_KEY || '',
  };
}

/**
 * Call seai.storage.
 *
 * `rawBody` is sent verbatim with the caller's content type; that is how the
 * byte relay preserves the bytes the safety scanner has to hash.
 *
 * @param {{storageApiBase: string, storageServiceName: string, storageServiceKey: string}} cfg
 * @param {string} path
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {any} [options.body]
 * @param {Buffer} [options.rawBody]
 * @param {string} [options.rawType]
 * @param {Record<string, string>} [options.headers]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @returns {Promise<{status: number, data: any}>}
 */
export async function storageCall(
  cfg,
  path,
  { method = 'GET', body, rawBody, rawType, headers = {}, fetchImpl = globalThis.fetch } = {},
) {
  if (!cfg.storageServiceKey) {
    throw Object.assign(new Error('Storage intake is not configured'), { statusCode: 503 });
  }

  const base = {
    'x-seai-service': cfg.storageServiceName,
    'x-seai-service-key': cfg.storageServiceKey,
    ...headers,
  };
  if (rawBody) base['Content-Type'] = rawType || 'application/octet-stream';
  else base['Content-Type'] = 'application/json';

  const res = await fetchImpl(`${cfg.storageApiBase}${path}`, {
    method,
    headers: base,
    body: rawBody || (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** Map a storage status onto a message that is safe for the browser. */
export function storageErrorMessage(status, fallback) {
  if (status === 413) return 'File is too large';
  if (status === 429) return 'Too many requests — please try again shortly';
  if (status === 410) return 'Upload expired — please upload again';
  if (status === 409) return 'Upload was not received — please upload again';
  if (status === 422) return 'File did not pass safety checks';
  return fallback;
}

/**
 * Validate the upload-initiation request.
 *
 * @param {any} body
 * @returns {{ok: true, value: {originalFilename: string, mimeType: string, sizeBytes: number, category: string}} | {ok: false, status: number, error: string}}
 */
export function validateUploadRequest(body) {
  const { originalFilename, mimeType, sizeBytes, category } = body || {};

  if (typeof originalFilename !== 'string' || originalFilename.length === 0 || originalFilename.length > MAX_FILENAME_LENGTH) {
    return { ok: false, status: 400, error: 'originalFilename is required' };
  }
  if (typeof mimeType !== 'string' || mimeType.length === 0 || mimeType.length > MAX_MIME_LENGTH) {
    return { ok: false, status: 400, error: 'mimeType is required' };
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_INTAKE_BYTES) {
    return { ok: false, status: 413, error: `Files are limited to ${MAX_INTAKE_BYTES} bytes` };
  }
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return { ok: false, status: 400, error: 'Unsupported category' };
  }
  return { ok: true, value: { originalFilename, mimeType, sizeBytes, category } };
}

/** Validate a storage file id used in a path segment. */
export function isStorageFileId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Best-effort per-client rate limiter.
 *
 * NOTE: this map is per-process. On Vercel each instance has its own, so the
 * effective limit is looser than the number below. seai.storage applies its own
 * per-service-key limit, which is the real backstop; this is only a courtesy
 * throttle to blunt a single client's retry loop.
 */
export function createRateLimiter({ max, windowMs } = { max: 30, windowMs: 60_000 }) {
  const buckets = new Map();
  return function limited(key) {
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) return true;
    hits.push(now);
    buckets.set(key, hits);
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) {
        if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
      }
    }
    return false;
  };
}
