/**
 * SEAI Public — Express intake storage proxy
 *
 * Same-origin proxy for seai.storage. Keeps service credentials out of the
 * browser: browsers only ever receive short-lived signed upload URLs and
 * storage file IDs.
 *
 * This is the local/self-hosted counterpart to the Vercel functions in
 * `api/storage/**`. Both delegate to `server/storage-core.js` so the two
 * runtimes cannot drift.
 *
 * Tenant model: intake is anonymous and pre-payment, so this proxy mints a
 * server-side intake session (httpOnly `seai_intake` cookie, UUID v4) and
 * scopes every storage object to the provisional tenant
 * `customerId = "intake:<uuid>"`. A browser-supplied customerId is never
 * forwarded. Adoption onto a real customer happens later in CDF.
 *
 * Required environment variables:
 * - SEAI_STORAGE_API_BASE     e.g. http://localhost:4100
 * - SEAI_STORAGE_SERVICE_NAME e.g. seai-public
 * - SEAI_STORAGE_SERVICE_KEY  never exposed to browsers
 * - ALLOWED_ORIGIN            e.g. https://seai.store
 */

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import {
  ALLOWED_CATEGORIES,
  createRateLimiter,
  getCookie,
  INTAKE_COOKIE,
  intakeCookieHeader,
  intakeScope,
  isIntakeSessionId,
  isSecureRequest,
  isStorageFileId,
  MAX_INTAKE_BYTES,
  newIntakeSessionId,
  resolveStorageConfig,
  storageCall,
  storageErrorMessage,
  validateUploadRequest,
} from './storage-core.js';
import { bodyErrorResponse, readJsonBody } from './payments-core.js';

const app = express();
const PORT = process.env.PORT || 3003;

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || 'https://seai.store',
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

const limited = createRateLimiter({ max: 30, windowMs: 60_000 });

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function fail(res, err, fallback) {
  const status = err && err.statusCode === 503 ? 503 : 500;
  console.error('[storage-proxy]', fallback, err);
  return res
    .status(status)
    .json({ ok: false, error: status === 503 ? 'Uploads are temporarily unavailable' : fallback });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'seai.public-storage-proxy' });
});

/** Initiate an intake upload. */
app.post('/api/storage/intake/uploads', async (req, res) => {
  const body = await readJsonBody(req);
  if (!body.ok) {
    const { status, message } = bodyErrorResponse(body.error);
    return res.status(status).json({ ok: false, error: message });
  }

  const validated = validateUploadRequest(body.value);
  if (!validated.ok) {
    return res.status(validated.status).json({ ok: false, error: validated.error });
  }

  if (limited(String(clientIp(req)))) {
    return res.status(429).json({ ok: false, error: 'Too many requests — please try again shortly' });
  }

  let sessionId = getCookie(req.headers.cookie, INTAKE_COOKIE);
  if (!sessionId || !isIntakeSessionId(sessionId)) {
    sessionId = newIntakeSessionId();
    res.setHeader('Set-Cookie', intakeCookieHeader(sessionId, isSecureRequest(req)));
  }
  const scope = intakeScope(sessionId);

  try {
    const result = await storageCall(resolveStorageConfig(), '/api/v1/uploads', {
      method: 'POST',
      headers: { 'x-on-behalf-of-customer': scope },
      // A browser-supplied customerId is dropped here, never forwarded.
      body: {
        websiteId: null,
        originalFilename: validated.value.originalFilename,
        mimeType: validated.value.mimeType,
        sizeBytes: validated.value.sizeBytes,
        checksumSha256: null,
        category: validated.value.category,
        customerId: scope,
      },
    });

    if (result.status !== 201) {
      return res
        .status(result.status)
        .json({ ok: false, error: storageErrorMessage(result.status, 'Could not start upload') });
    }

    const fileId = result.data?.object?.id;
    const uploadUrl = result.data?.uploadUrl;
    if (typeof fileId !== 'string' || typeof uploadUrl !== 'string') {
      return res.status(502).json({ ok: false, error: 'Could not start upload' });
    }

    return res.status(201).json({
      ok: true,
      fileId,
      uploadUrl,
      expiresAt: result.data.expiresAt ?? null,
      intakeSessionId: sessionId,
      bytesEndpoint: `/api/storage/intake/uploads/${encodeURIComponent(fileId)}/bytes`,
    });
  } catch (err) {
    return fail(res, err, 'Could not start upload');
  }
});

/** Complete an intake upload after verifying the intake scope. */
app.post('/api/storage/intake/uploads/:id/complete', async (req, res) => {
  if (!isStorageFileId(req.params.id)) {
    return res.status(400).json({ ok: false, error: 'Invalid upload id' });
  }
  const sessionId = getCookie(req.headers.cookie, INTAKE_COOKIE);
  if (!isIntakeSessionId(sessionId)) {
    return res.status(401).json({ ok: false, error: 'Intake session required' });
  }
  const scope = intakeScope(sessionId);
  const id = encodeURIComponent(req.params.id);

  try {
    const check = await storageCall(resolveStorageConfig(), `/api/v1/files/${id}`, { method: 'GET' });
    if (check.status !== 200 || check.data?.file?.customerId !== scope) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const result = await storageCall(resolveStorageConfig(), `/api/v1/uploads/${id}/complete`, {
      method: 'POST',
      headers: { 'x-on-behalf-of-customer': scope },
      body: { customerId: scope },
    });

    if (result.status !== 200) {
      return res
        .status(result.status)
        .json({ ok: false, error: storageErrorMessage(result.status, 'Could not complete upload') });
    }

    return res.json({
      ok: true,
      fileId: result.data?.object?.id ?? req.params.id,
      status: result.data?.object?.status ?? 'available',
    });
  } catch (err) {
    return fail(res, err, 'Could not complete upload');
  }
});

/** Relay bytes for storage providers the browser cannot PUT to directly. */
app.put(
  '/api/storage/intake/uploads/:id/bytes',
  express.raw({ type: '*/*', limit: '6mb' }),
  async (req, res) => {
    if (!isStorageFileId(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Invalid upload id' });
    }
    const sessionId = getCookie(req.headers.cookie, INTAKE_COOKIE);
    if (!isIntakeSessionId(sessionId)) {
      return res.status(401).json({ ok: false, error: 'Intake session required' });
    }
    const scope = intakeScope(sessionId);
    const id = encodeURIComponent(req.params.id);
    const bytes = req.body;

    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INTAKE_BYTES) {
      return res.status(400).json({ ok: false, error: 'Empty or oversized upload' });
    }

    try {
      const check = await storageCall(resolveStorageConfig(), `/api/v1/files/${id}`, { method: 'GET' });
      if (check.status !== 200 || check.data?.file?.customerId !== scope) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }

      const result = await storageCall(resolveStorageConfig(), `/api/v1/uploads/${id}/bytes`, {
        method: 'PUT',
        headers: { 'x-on-behalf-of-customer': scope },
        rawBody: bytes,
        rawType: check.data.file.mimeType,
      });

      if (result.status !== 200) {
        return res.status(502).json({ ok: false, error: 'Could not transfer file' });
      }
      return res.json({ ok: true, receivedBytes: bytes.length });
    } catch (err) {
      return fail(res, err, 'Could not transfer file');
    }
  },
);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[storage-proxy] Intake storage proxy running on port ${PORT}`);
  });
}

export { app, INTAKE_COOKIE, MAX_INTAKE_BYTES, ALLOWED_CATEGORIES };
