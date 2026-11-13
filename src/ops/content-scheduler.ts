import { Router, type Request, type Response } from 'express';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

const MAX_RETRIES = 3;

/**
 * Shared publish logic used by both the manual publish endpoint
 * and the scheduled publisher. Nothing is fabricated — all calls
 * go to the real platform API.
 */
async function publishPost(post: any): Promise<{ ok: boolean; externalPostId?: string; error?: string }> {
  const integration = (await db.list('social_integrations', { id: post.integration_id }, 1))[0];
  if (!integration) {
    return { ok: false, error: 'Integration not found' };
  }

  const { createDecipheriv, scryptSync } = await import('node:crypto');
  const ALGORITHM = 'aes-256-gcm';
  const KEY_LEN = 32;

  function encryptionKey(): Buffer {
    const raw = process.env.SEAI_ENCRYPTION_KEY || '';
    if (!raw) throw new Error('SEAI_ENCRYPTION_KEY is not configured');
    return scryptSync(raw, 'seai-social-integration', KEY_LEN);
  }

  function decrypt(ciphertext: string): string {
    const key = encryptionKey();
    const { iv, tag, data } = JSON.parse(ciphertext) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  const accessToken = decrypt(integration.access_token_enc);

  if (post.platform === 'instagram' || post.platform === 'facebook') {
    // Step 1: Upload media
    const mediaResp = await fetch(`https://graph.facebook.com/v21.0/${integration.account_id}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: post.media_urls ? JSON.parse(post.media_urls)[0] : '',
        caption: post.caption,
        access_token: accessToken,
      }),
    });
    const mediaData = await mediaResp.json();

    if (!mediaData.id) {
      return { ok: false, error: mediaData.error?.message || 'Failed to upload media' };
    }

    // Step 2: Publish the media
    const publishResp2 = await fetch(`https://graph.facebook.com/v21.0/${integration.account_id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_id: mediaData.id,
        caption: post.caption,
        access_token: accessToken,
      }),
    });
    const publishData = await publishResp2.json();

    if (!publishResp2.ok || !publishData.id) {
      return { ok: false, error: publishData.error?.message || 'Failed to publish' };
    }

    return { ok: true, externalPostId: publishData.id };
  }

  if (post.platform === 'whatsapp') {
    const recipient = post.recipient;
    if (!recipient) {
      return { ok: false, error: 'No recipient phone number provided' };
    }
    const publishResp = await fetch(`https://graph.facebook.com/v21.0/${integration.account_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: post.caption },
      }),
    });
    const publishData = await publishResp.json();

    if (!publishResp.ok || !publishData.messages?.[0]?.id) {
      return { ok: false, error: publishData.error?.message || 'Failed to publish WhatsApp message' };
    }

    return { ok: true, externalPostId: publishData.messages[0].id };
  }

  return { ok: false, error: `Publishing to ${post.platform} not supported yet` };
}

export const contentSchedulerRouter = Router();
contentSchedulerRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'marketing'));

type ScheduleResult = { id: string; status: string; external_post_id?: string; error?: string; retry_count?: number };

// POST /api/ops/content/schedule/run — Manually trigger scheduled post processing
// Finds approved posts whose scheduled_at has passed and attempts to publish them.
contentSchedulerRouter.post('/run', async (_req: Request, res: Response) => {
  const nowIso = now();
  const posts = await db.list('social_posts', {}, 10000);

  const due = posts.filter((p) => {
    if (p.status !== 'approved') return false;
    if (!p.scheduled_at) return false;
    return String(p.scheduled_at) <= nowIso;
  });

  const results: ScheduleResult[] = [];

  for (const post of due) {
    const current = (await db.list('social_posts', { id: post.id }, 1))[0];
    if (!current) continue;
    if (current.status !== 'approved') continue;

    // Retry guard
    const retryCount = Number(current.retry_count ?? 0);
    if (retryCount >= MAX_RETRIES) {
      await db.update('social_posts', current.id, {
        status: 'failed',
        failed_reason: `Max retries (${MAX_RETRIES}) exceeded`,
        updated_at: now(),
      });
      results.push({ id: current.id, status: 'failed', error: 'Max retries exceeded' });
      continue;
    }

    const result = await publishPost(current);

    if (result.ok) {
      await db.update('social_posts', current.id, {
        status: 'published',
        external_post_id: result.externalPostId,
        published_at: now(),
        failed_reason: null,
        updated_at: now(),
      });
      results.push({ id: current.id, status: 'published', external_post_id: result.externalPostId });
    } else {
      const nextRetry = retryCount + 1;
      const isFinal = nextRetry >= MAX_RETRIES;
      await db.update('social_posts', current.id, {
        status: isFinal ? 'failed' : 'approved',
        retry_count: nextRetry,
        failed_reason: result.error,
        updated_at: now(),
      });
      results.push({ id: current.id, status: isFinal ? 'failed' : 'approved', error: result.error, retry_count: nextRetry });
    }
  }

  res.json({ ok: true, processed: due.length, results });
});

// GET /api/ops/content/schedule/due — List posts due for scheduling (dry run)
contentSchedulerRouter.get('/due', async (_req: Request, res: Response) => {
  const nowIso = now();
  const posts = await db.list('social_posts', {}, 10000);
  const due = posts.filter((p) => {
    if (p.status !== 'approved') return false;
    if (!p.scheduled_at) return false;
    return String(p.scheduled_at) <= nowIso;
  });
  res.json({ ok: true, due_count: due.length, due_posts: due.map((p) => ({ id: p.id, scheduled_at: p.scheduled_at, retry_count: p.retry_count })) });
});
