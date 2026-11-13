import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;

function encryptionKey(): Buffer {
  const raw = process.env.SEAI_ENCRYPTION_KEY || '';
  if (!raw) throw new Error('SEAI_ENCRYPTION_KEY is not configured');
  return scryptSync(raw, 'seai-social-integration', KEY_LEN);
}

function encrypt(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') });
}

function decrypt(ciphertext: string): string {
  const key = encryptionKey();
  const { iv, tag, data } = JSON.parse(ciphertext) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export const socialIntegrationsRouter = Router();
socialIntegrationsRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'marketing'));

const integrationSchema = z.object({
  platform: z.enum(['meta', 'whatsapp', 'google', 'linkedin', 'youtube', 'tiktok']),
  account_id: z.string().trim().min(1),
  account_name: z.string().trim().min(1),
  access_token: z.string().trim().min(1),
  refresh_token: z.string().trim().optional(),
  token_expires_at: z.string().trim().optional(),
  scope: z.string().trim().default(''),
  workspace_type: z.enum(['seai', 'client']).default('seai'),
  workspace_id: z.string().trim().optional().or(z.literal('')),
});

// GET /api/ops/social/integrations
socialIntegrationsRouter.get('/', async (_req: Request, res: Response) => {
  const rows = await db.list('social_integrations', {}, 1000);
  const safe = rows.map((r) => ({ ...r, access_token_enc: undefined, refresh_token_enc: undefined }));
  res.json({ ok: true, integrations: safe });
});

// GET /api/ops/social/integrations/:id
socialIntegrationsRouter.get('/:id', async (req: Request, res: Response) => {
  const row = (await db.list('social_integrations', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Integration not found' }); return; }
  const safe = { ...row, access_token_enc: undefined, refresh_token_enc: undefined };
  res.json({ ok: true, integration: safe });
});

// POST /api/ops/social/integrations
socialIntegrationsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = integrationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid integration' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('social_integrations', {
    id, platform: d.platform, account_id: d.account_id, account_name: d.account_name,
    access_token_enc: encrypt(d.access_token),
    refresh_token_enc: d.refresh_token ? encrypt(d.refresh_token) : null,
    token_expires_at: d.token_expires_at || null,
    scope: d.scope, is_active: true, health_status: 'healthy',
    workspace_type: d.workspace_type, workspace_id: d.workspace_id || null,
    created_by: req.user!.id,
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/social/integrations/:id
socialIntegrationsRouter.patch('/:id', async (req: Request, res: Response) => {
  const row = (await db.list('social_integrations', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Integration not found' }); return; }
  const allowed = ['account_name', 'access_token', 'refresh_token', 'token_expires_at', 'scope', 'is_active', 'health_status', 'error_message'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (k === 'access_token') patch.access_token_enc = encrypt(String(req.body[k]));
      else if (k === 'refresh_token') patch.refresh_token_enc = req.body[k] ? encrypt(String(req.body[k])) : null;
      else patch[k] = req.body[k];
    }
  }
  patch.updated_at = now();
  await db.update('social_integrations', req.params.id, patch);
  res.json({ ok: true });
});

// DELETE /api/ops/social/integrations/:id
socialIntegrationsRouter.delete('/:id', async (req: Request, res: Response) => {
  await db.deleteWhere('social_integrations', { id: req.params.id });
  res.json({ ok: true });
});

// POST /api/ops/social/integrations/:id/refresh — Refresh Meta long-lived token via fb_exchange_token grant
socialIntegrationsRouter.post('/:id/refresh', async (req: Request, res: Response) => {
  const row = (await db.list('social_integrations', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Integration not found' }); return; }

  const clientId = process.env.META_APP_ID || '';
  const clientSecret = process.env.META_APP_SECRET || '';
  if (!clientId || !clientSecret) {
    res.status(500).json({ ok: false, error: 'Meta OAuth credentials not configured' });
    return;
  }

  try {
    let newAccessToken: string;
    let newExpiresIn: number;

    if (row.platform === 'meta' && row.access_token_enc) {
      const currentToken = decrypt(row.access_token_enc);
      // Exchange current (short- or long-lived) token for a new long-lived token
      const refreshResp = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${currentToken}`);
      const refreshData = await refreshResp.json();

      if (!refreshResp.ok || !refreshData.access_token) {
        await db.update('social_integrations', req.params.id, {
          health_status: 'error',
          error_message: refreshData.error?.message || 'Token refresh failed',
          updated_at: now(),
        });
        res.status(503).json({ ok: false, error: 'Token refresh failed' });
        return;
      }
      newAccessToken = refreshData.access_token;
      newExpiresIn = Number(refreshData.expires_in || 5184000);
    } else if (row.platform === 'whatsapp' && row.access_token_enc) {
      // WhatsApp tokens do not use fb_exchange_token; re-verify the existing token
      const currentToken = decrypt(row.access_token_enc);
      const verifyResp = await fetch(`https://graph.facebook.com/v21.0/${row.account_id}?fields=id,name&access_token=${currentToken}`);
      if (!verifyResp.ok) {
        await db.update('social_integrations', req.params.id, {
          health_status: 'expired',
          error_message: 'WhatsApp token verification failed',
          updated_at: now(),
        });
        res.status(400).json({ ok: false, error: 'WhatsApp token is invalid or expired' });
        return;
      }
      newAccessToken = currentToken;
      newExpiresIn = 30 * 24 * 60 * 60; // 30 days
    } else {
      res.status(400).json({ ok: false, error: 'Token refresh not supported for this platform' });
      return;
    }

    await db.update('social_integrations', req.params.id, {
      access_token_enc: encrypt(newAccessToken),
      token_expires_at: new Date(Date.now() + newExpiresIn * 1000).toISOString(),
      health_status: 'healthy',
      error_message: null,
      updated_at: now(),
    });
    res.json({ ok: true });
  } catch (err: any) {
    await db.update('social_integrations', req.params.id, {
      health_status: 'error',
      error_message: String(err?.message ?? err).slice(0, 500),
      updated_at: now(),
    });
    res.status(503).json({ ok: false, error: 'Token refresh failed' });
  }
});

// GET /api/ops/social/integrations/:id/health — Verify token is still valid against Meta API
socialIntegrationsRouter.get('/:id/health', async (req: Request, res: Response) => {
  const row = (await db.list('social_integrations', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Integration not found' }); return; }

  try {
    if (row.platform === 'meta' || row.platform === 'meta_page' || row.platform === 'instagram' || row.platform === 'whatsapp') {
      const token = decrypt(row.access_token_enc);
      // Verify token by calling /me for user-level, or /{account_id} for page-level
      const verifyUrl = row.platform === 'meta'
        ? `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${token}`
        : `https://graph.facebook.com/v21.0/${row.account_id}?fields=id,name&access_token=${token}`;
      const verifyResp = await fetch(verifyUrl);
      const verifyData = await verifyResp.json();

      if (!verifyResp.ok) {
        await db.update('social_integrations', req.params.id, {
          health_status: 'expired',
          error_message: verifyData.error?.message || 'Token verification failed',
          updated_at: now(),
        });
        res.json({ ok: true, healthy: false, error: verifyData.error?.message || 'Token verification failed' });
        return;
      }

      await db.update('social_integrations', req.params.id, {
        health_status: 'healthy',
        error_message: null,
        last_synced_at: now(),
        updated_at: now(),
      });
      res.json({ ok: true, healthy: true, account_id: verifyData.id, account_name: verifyData.name });
      return;
    }

    res.json({ ok: true, healthy: true, note: `Health check not implemented for platform ${row.platform}` });
  } catch (err: any) {
    await db.update('social_integrations', req.params.id, {
      health_status: 'error',
      error_message: String(err?.message ?? err).slice(0, 500),
      updated_at: now(),
    });
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});
