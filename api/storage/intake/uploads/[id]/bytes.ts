/**
 * PUT /api/storage/intake/uploads/:id/bytes
 *
 * Byte relay for storage providers the browser cannot PUT to directly. The
 * bytes are forwarded verbatim — no re-encoding — because seai.storage hashes
 * and scans exactly what it receives.
 *
 * S3-backed deployments bypass this: the browser PUTs straight to the signed
 * uploadUrl, and only calls the complete endpoint afterwards.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  getCookie,
  INTAKE_COOKIE,
  intakeScope,
  isIntakeSessionId,
  isStorageFileId,
  MAX_INTAKE_BYTES,
  resolveStorageConfig,
  storageCall,
} from '../../../../../server/storage-core.js';

export const config = {
  api: { bodyParser: false },
};

async function readBytes(req: VercelRequest): Promise<Buffer | null> {
  const declared = Number(req.headers['content-length'] ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_INTAKE_BYTES) return null;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_INTAKE_BYTES) return null;
    chunks.push(buf);
  }
  if (size === 0) return null;
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStorageFileId(raw)) {
    return res.status(400).json({ ok: false, error: 'Invalid upload id' });
  }

  const sessionId = getCookie(req.headers.cookie, INTAKE_COOKIE);
  if (!isIntakeSessionId(sessionId)) {
    return res.status(401).json({ ok: false, error: 'Intake session required' });
  }
  const scope = intakeScope(sessionId);

  let bytes: Buffer | null;
  try {
    bytes = await readBytes(req);
  } catch {
    bytes = null;
  }
  if (!bytes) {
    return res.status(400).json({ ok: false, error: 'Empty or oversized upload' });
  }

  const cfg = resolveStorageConfig();
  try {
    const check = await storageCall(cfg, `/api/v1/files/${encodeURIComponent(raw)}`, { method: 'GET' });
    if (check.status !== 200 || check.data?.file?.customerId !== scope) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const result = await storageCall(cfg, `/api/v1/uploads/${encodeURIComponent(raw)}/bytes`, {
      method: 'PUT',
      headers: { 'x-on-behalf-of-customer': scope },
      rawBody: bytes,
      rawType: check.data.file.mimeType,
    });

    if (result.status !== 200) {
      return res.status(502).json({ ok: false, error: 'Could not transfer file' });
    }
    return res.status(200).json({ ok: true, receivedBytes: bytes.length });
  } catch (err: any) {
    const status = err?.statusCode === 503 ? 503 : 500;
    return res.status(status).json({
      ok: false,
      error: status === 503 ? 'Uploads are temporarily unavailable' : 'Could not transfer file',
    });
  }
}
