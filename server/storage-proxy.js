/**
 * SEAI Public Site - Storage Intake Proxy (SERVER-SIDE ONLY)
 *
 * Proxies seai.store intake uploads to seai.storage.
 * Keeps service-to-service credentials out of the browser: browsers only ever
 * receive short-lived signed upload URLs and storage file IDs.
 *
 * Tenant model: intake is anonymous/pre-payment, so the proxy mints a
 * server-side intake session (httpOnly `seai_intake` cookie, UUID v4) and
 * scopes all storage objects to the provisional tenant
 * `customerId = "intake:<uuid>"`. Adoption onto a real customer happens in
 * CDF after signup (see seai.storage docs/INTEGRATION_CONTRACT_FINAL.md §5).
 *
 * Deploy alongside the static site (same origin as the payment proxy).
 * Required environment variables:
 * - SEAI_STORAGE_API_BASE (e.g. http://localhost:4100)
 * - SEAI_STORAGE_SERVICE_NAME (e.g. seai-public)
 * - SEAI_STORAGE_SERVICE_KEY (never exposed to browsers)
 * - ALLOWED_ORIGIN (e.g. https://seai.store)
 */

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const app = express();
const PORT = process.env.PORT || 3003;

const INTAKE_COOKIE = 'seai_intake';
const MAX_INTAKE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CATEGORIES = ['logo', 'image', 'brand_asset', 'document', 'intake_attachment'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'https://seai.store',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// --- minimal cookie helpers (no extra dependency) ---
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setIntakeCookie(res, sessionId, secure) {
  const parts = [
    `${INTAKE_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// --- per-IP rate limiting (storage also limits per service key) ---
const buckets = new Map();
function limited(ip, group, max, windowMs) {
  const now = Date.now();
  const key = `${group}:${ip}`;
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return true;
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

function storageBase() {
  return String(config.storageApiBase || '').replace(/\/$/, '');
}

function serviceHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-seai-service': config.storageServiceName,
    'x-seai-service-key': config.storageServiceKey,
  };
}

function intakeScope(sessionId) {
  return `intake:${sessionId}`;
}

async function storageCall(path, { method = 'GET', body, rawBody, rawType, headers = {} } = {}) {
  if (!config.storageServiceKey) {
    throw Object.assign(new Error('Storage intake is not configured'), { statusCode: 503 });
  }
  const res = await fetch(`${storageBase()}${path}`, {
    method,
    headers: rawBody
      ? { ...serviceHeaders(), ...headers, 'Content-Type': rawType || 'application/octet-stream' }
      : { ...serviceHeaders(), ...headers },
    body: rawBody || (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(15000),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// Resolve (and set when missing) the server-side intake session.
function intakeSession(req, res) {
  let sessionId = getCookie(req, INTAKE_COOKIE);
  if (!sessionId || !UUID_RE.test(sessionId)) {
    sessionId = randomUUID();
    const secure = (process.env.NODE_ENV === 'production') || (req.protocol === 'https');
    setIntakeCookie(res, sessionId, secure);
  }
  return sessionId;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'seai.public-storage-proxy' });
});

// Proxy: initiate an intake upload (provisional intake scope only)
app.post('/api/storage/intake/uploads', async (req, res) => {
  try {
    if (limited(req.ip, 'uploads', 30, 60_000)) {
      return res.status(429).json({ ok: false, error: 'Too many requests — please try again shortly' });
    }
    const { originalFilename, mimeType, sizeBytes, category } = req.body || {};
    if (!originalFilename || typeof originalFilename !== 'string' || originalFilename.length > 253) {
      return res.status(400).json({ ok: false, error: 'originalFilename is required' });
    }
    if (!mimeType || typeof mimeType !== 'string' || mimeType.length > 127) {
      return res.status(400).json({ ok: false, error: 'mimeType is required' });
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_INTAKE_BYTES) {
      return res.status(413).json({ ok: false, error: `Files are limited to ${MAX_INTAKE_BYTES} bytes` });
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ ok: false, error: 'Unsupported category' });
    }
    const sessionId = intakeSession(req, res);
    const scope = intakeScope(sessionId);
    // NOTE: scope is always server-minted. Any browser-supplied customerId is
    // dropped here and never forwarded to storage.
    const result = await storageCall('/api/v1/uploads', {
      method: 'POST',
      headers: { 'x-on-behalf-of-customer': scope },
      body: { websiteId: null, originalFilename, mimeType, sizeBytes, checksumSha256: null, category, customerId: scope },
    });
    if (result.status !== 201) {
      const msg = result.status === 413 ? 'File is too large' : result.status === 429 ? 'Too many requests — please try again shortly' : 'Could not start upload';
      return res.status(result.status).json({ ok: false, error: msg });
    }
    return res.status(201).json({
      ok: true,
      fileId: result.data.object.id,
      uploadUrl: result.data.uploadUrl,
      expiresAt: result.data.expiresAt,
      intakeSessionId: sessionId,
      bytesEndpoint: `/api/storage/intake/uploads/${result.data.object.id}/bytes`,
    });
  } catch (err) {
    console.error('[storage-proxy] initiate error:', err);
    const status = err && err.statusCode === 503 ? 503 : 500;
    return res.status(status).json({ ok: false, error: status === 503 ? 'Uploads are temporarily unavailable' : 'Could not start upload' });
  }
});

// Proxy: complete an intake upload (verifies intake scope first)
app.post('/api/storage/intake/uploads/:id/complete', async (req, res) => {
  try {
    const sessionId = getCookie(req, INTAKE_COOKIE);
    if (!sessionId || !UUID_RE.test(sessionId)) {
      return res.status(401).json({ ok: false, error: 'Intake session required' });
    }
    const scope = intakeScope(sessionId);
    const check = await storageCall(`/api/v1/files/${encodeURIComponent(req.params.id)}`, { method: 'GET' });
    if (check.status !== 200 || check.data?.file?.customerId !== scope) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const result = await storageCall(`/api/v1/uploads/${encodeURIComponent(req.params.id)}/complete`, {
      method: 'POST',
      headers: { 'x-on-behalf-of-customer': scope },
      body: { customerId: scope },
    });
    if (result.status !== 200) {
      const msg = result.status === 410 ? 'Upload expired — please upload again'
        : result.status === 409 ? 'Upload was not received — please upload again'
        : result.status === 422 ? 'File did not pass safety checks'
        : 'Could not complete upload';
      return res.status(result.status).json({ ok: false, error: msg });
    }
    return res.json({ ok: true, fileId: result.data.object.id, status: result.data.object.status });
  } catch (err) {
    console.error('[storage-proxy] complete error:', err);
    return res.status(500).json({ ok: false, error: 'Could not complete upload' });
  }
});

// Proxy: relay bytes for non-S3 providers (S3 browsers PUT to uploadUrl directly)
app.put(
  '/api/storage/intake/uploads/:id/bytes',
  express.raw({ type: '*/*', limit: '6mb' }),
  async (req, res) => {
    try {
      const sessionId = getCookie(req, INTAKE_COOKIE);
      if (!sessionId || !UUID_RE.test(sessionId)) {
        return res.status(401).json({ ok: false, error: 'Intake session required' });
      }
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INTAKE_BYTES) {
        return res.status(400).json({ ok: false, error: 'Empty or oversized upload' });
      }
      const scope = intakeScope(sessionId);
      const check = await storageCall(`/api/v1/files/${encodeURIComponent(req.params.id)}`, { method: 'GET' });
      if (check.status !== 200 || check.data?.file?.customerId !== scope) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      const result = await storageCall(`/api/v1/uploads/${encodeURIComponent(req.params.id)}/bytes`, {
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
      console.error('[storage-proxy] bytes error:', err);
      return res.status(500).json({ ok: false, error: 'Could not transfer file' });
    }
  },
);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[storage-proxy] Intake storage proxy running on port ${PORT}`);
  });
}

export { app, INTAKE_COOKIE, MAX_INTAKE_BYTES, ALLOWED_CATEGORIES };
