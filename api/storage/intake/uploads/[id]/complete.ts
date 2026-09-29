/**
 * POST /api/storage/intake/uploads/:id/complete
 *
 * Tells seai.storage that the bytes have landed so it can run its safety checks
 * and promote the object to `available`.
 *
 * The intake session cookie is verified, and the file's owner is re-checked
 * against the session's provisional tenant before anything is completed. Without
 * that check a customer could complete (and thereby read back) another
 * customer's upload by guessing an id.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  getCookie,
  INTAKE_COOKIE,
  intakeScope,
  isIntakeSessionId,
  isStorageFileId,
  resolveStorageConfig,
  storageCall,
  storageErrorMessage,
} from '../../../../../server/storage-core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

  const cfg = resolveStorageConfig();
  try {
    const check = await storageCall(cfg, `/api/v1/files/${encodeURIComponent(raw)}`, { method: 'GET' });
    if (check.status !== 200 || check.data?.file?.customerId !== scope) {
      // Same response whether the file is missing or simply not ours, so this
      // cannot be used to probe for other tenants' file ids.
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    const result = await storageCall(cfg, `/api/v1/uploads/${encodeURIComponent(raw)}/complete`, {
      method: 'POST',
      headers: { 'x-on-behalf-of-customer': scope },
      body: { customerId: scope },
    });

    if (result.status !== 200) {
      return res
        .status(result.status)
        .json({ ok: false, error: storageErrorMessage(result.status, 'Could not complete upload') });
    }

    return res.status(200).json({
      ok: true,
      fileId: result.data?.object?.id ?? raw,
      status: result.data?.object?.status ?? 'available',
    });
  } catch (err: any) {
    const status = err?.statusCode === 503 ? 503 : 500;
    return res.status(status).json({
      ok: false,
      error: status === 503 ? 'Uploads are temporarily unavailable' : 'Could not complete upload',
    });
  }
}
