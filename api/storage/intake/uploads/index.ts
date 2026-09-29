/**
 * POST /api/storage/intake/uploads
 *
 * Starts an intake file upload by asking seai.storage for a short-lived signed
 * upload URL. The browser receives the URL and a file ID; it never receives a
 * service credential, and it never chooses its own tenant.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  createRateLimiter,
  getCookie,
  INTAKE_COOKIE,
  intakeCookieHeader,
  intakeScope,
  isIntakeSessionId,
  isSecureRequest,
  newIntakeSessionId,
  resolveStorageConfig,
  storageCall,
  storageErrorMessage,
  validateUploadRequest,
} from '../../../../server/storage-core.js';
import { bodyErrorResponse, readJsonBody } from '../../../../server/payments-core.js';

const limited = createRateLimiter({ max: 30, windowMs: 60_000 });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    const { status, message } = bodyErrorResponse(body.error);
    return res.status(status).json({ ok: false, error: message });
  }

  const validated = validateUploadRequest(body.value);
  if (!validated.ok) {
    return res.status(validated.status).json({ ok: false, error: validated.error });
  }

  const clientIp =
    (Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : req.headers['x-forwarded-for']) || req.socket?.remoteAddress || 'unknown';
  if (limited(String(clientIp))) {
    return res.status(429).json({ ok: false, error: 'Too many requests — please try again shortly' });
  }

  // Resolve (and mint when missing) the server-side intake session.
  let sessionId = getCookie(req.headers.cookie, INTAKE_COOKIE);
  if (!sessionId || !isIntakeSessionId(sessionId)) {
    sessionId = newIntakeSessionId();
    res.setHeader('Set-Cookie', intakeCookieHeader(sessionId, isSecureRequest(req)));
  }
  const scope = intakeScope(sessionId);

  const cfg = resolveStorageConfig();
  let result;
  try {
    result = await storageCall(cfg, '/api/v1/uploads', {
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
  } catch (err: any) {
    const status = err?.statusCode === 503 ? 503 : 500;
    return res.status(status).json({
      ok: false,
      error: status === 503 ? 'Uploads are temporarily unavailable' : 'Could not start upload',
    });
  }

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
}
