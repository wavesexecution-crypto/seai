import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID, createDecipheriv, scryptSync } from 'node:crypto';
import { db } from '../db/db.js';
import { now } from '../growth/service.js';

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

export const contentCalendarRouter = Router();

const socialPostSchema = z.object({
  integration_id: z.string().trim().min(1),
  platform: z.enum(['instagram', 'facebook', 'whatsapp', 'meta', 'google']),
  content_type: z.enum(['text', 'image', 'carousel', 'reel', 'story', 'text_post', 'image_post']).default('text'),
  caption: z.string().trim().min(1).max(2200),
  recipient: z.string().trim().min(1).max(100).optional(),
  hashtags: z.array(z.string()).optional(),
  media_urls: z.array(z.string()).optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'scheduled', 'published', 'failed', 'rejected']).default('draft'),
  scheduled_at: z.string().trim().optional(),
  external_post_id: z.string().trim().optional(),
});

// GET /api/ops/content/posts - List social posts
contentCalendarRouter.get('/posts', async (req: Request, res: Response) => {
  const { status, platform, integration_id } = req.query;
  let rows = await db.list('social_posts', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (platform) rows = rows.filter((r) => r.platform === platform);
  if (integration_id) rows = rows.filter((r) => r.integration_id === integration_id);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, posts: rows.slice(0, 500), total: rows.length });
});

// POST /api/ops/content/posts - Create a social post
contentCalendarRouter.post('/posts', async (req: Request, res: Response) => {
  const parsed = socialPostSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid post' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('social_posts', {
    id,
    integration_id: d.integration_id,
    platform: d.platform,
    external_post_id: null,
    content_type: d.content_type,
    caption: d.caption,
    recipient: d.recipient || null,
    hashtags: JSON.stringify(d.hashtags || []),
    media_urls: JSON.stringify(d.media_urls || []),
    status: d.status,
    scheduled_at: d.scheduled_at || null,
    published_at: null,
    failed_reason: null,
    retry_count: 0,
    approved_by: null,
    approved_at: null,
    created_by: req.user!.id,
    created_at: now(),
    updated_at: now(),
  });
  res.json({ ok: true, id });
});

// GET /api/ops/content/posts/:id - Get a single social post
contentCalendarRouter.get('/posts/:id', async (req: Request, res: Response) => {
  const post = (await db.list('social_posts', { id: req.params.id }, 1))[0];
  if (!post) { res.status(404).json({ ok: false, error: 'Post not found' }); return; }
  res.json({ ok: true, post: post });
});

// PATCH /api/ops/content/posts/:id - Update a social post
contentCalendarRouter.patch('/posts/:id', async (req: Request, res: Response) => {
  const post = (await db.list('social_posts', { id: req.params.id }, 1))[0];
  if (!post) { res.status(404).json({ ok: false, error: 'Post not found' }); return; }
  const allowed = ['caption', 'hashtags', 'media_urls', 'recipient', 'status', 'scheduled_at', 'content_type'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (['hashtags', 'media_urls'].includes(k)) patch[k] = JSON.stringify(req.body[k]);
      else patch[k] = req.body[k];
    }
  }
  patch.updated_at = now();
  await db.update('social_posts', req.params.id, patch);
  res.json({ ok: true });
});

// POST /api/ops/content/posts/:id/submit - Submit post for approval
contentCalendarRouter.post('/posts/:id/submit', async (req: Request, res: Response) => {
  const post = (await db.list('social_posts', { id: req.params.id }, 1))[0];
  if (!post) { res.status(404).json({ ok: false, error: 'Post not found' }); return; }
  await db.update('social_posts', req.params.id, { status: 'submitted', updated_at: now() });
  res.json({ ok: true, status: 'submitted' });
});

// POST /api/ops/content/posts/:id/approve - Approve post for publishing
contentCalendarRouter.post('/posts/:id/approve', async (req: Request, res: Response) => {
  const post = (await db.list('social_posts', { id: req.params.id }, 1))[0];
  if (!post) { res.status(404).json({ ok: false, error: 'Post not found' }); return; }
  await db.update('social_posts', req.params.id, {
    status: 'approved',
    approved_by: req.user!.id,
    approved_at: now(),
    updated_at: now(),
  });
  res.json({ ok: true, status: 'approved' });
});

// POST /api/ops/content/posts/:id/publish - Publish an approved post
contentCalendarRouter.post('/posts/:id/publish', async (req: Request, res: Response) => {
  const post = (await db.list('social_posts', { id: req.params.id }, 1))[0];
  if (!post) { res.status(404).json({ ok: false, error: 'Post not found' }); return; }
  if (post.status !== 'approved') {
    res.status(400).json({ ok: false, error: 'Post must be approved before publishing' });
    return;
  }

  const integration = (await db.list('social_integrations', { id: post.integration_id }, 1))[0];
  if (!integration) { res.status(404).json({ ok: false, error: 'Integration not found' }); return; }

  try {
    const accessToken = decrypt(integration.access_token_enc);

    if (post.platform === 'instagram' || post.platform === 'facebook') {
      const publishResp = await fetch(`https://graph.facebook.com/v21.0/${integration.account_id}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: post.media_urls ? JSON.parse(post.media_urls)[0] : '',
          caption: post.caption,
          access_token: accessToken,
        }),
      });
      const mediaData = await publishResp.json();

      if (!mediaData.id) {
        await db.update('social_posts', req.params.id, {
          status: 'failed',
          failed_reason: mediaData.error?.message || 'Failed to upload media',
          updated_at: now(),
        });
        res.status(400).json({ ok: false, error: mediaData.error?.message || 'Failed to upload media' });
        return;
      }

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
        await db.update('social_posts', req.params.id, {
          status: 'failed',
          failed_reason: publishData.error?.message || 'Failed to publish',
          updated_at: now(),
        });
        res.status(400).json({ ok: false, error: publishData.error?.message || 'Failed to publish' });
        return;
      }

      await db.update('social_posts', req.params.id, {
        status: 'published',
        external_post_id: publishData.id,
        published_at: new Date().toISOString(),
        updated_at: now(),
      });
    } else if (post.platform === 'whatsapp') {
      const recipient = post.recipient;
      if (!recipient) {
        await db.update('social_posts', req.params.id, {
          status: 'failed',
          failed_reason: 'No recipient phone number provided',
          updated_at: now(),
        });
        res.status(400).json({ ok: false, error: 'Recipient phone number is required for WhatsApp posts' });
        return;
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
        await db.update('social_posts', req.params.id, {
          status: 'failed',
          failed_reason: publishData.error?.message || 'Failed to publish WhatsApp message',
          updated_at: now(),
        });
        res.status(400).json({ ok: false, error: publishData.error?.message || 'Failed to publish' });
        return;
      }

      await db.update('social_posts', req.params.id, {
        status: 'published',
        external_post_id: publishData.messages[0].id,
        published_at: new Date().toISOString(),
        updated_at: now(),
      });
    } else {
      res.status(400).json({ ok: false, error: `Publishing to ${post.platform} not supported yet` });
      return;
    }

    res.json({ ok: true, status: 'published', external_post_id: post.external_post_id });
  } catch (err: any) {
    await db.update('social_posts', req.params.id, {
      status: 'failed',
      failed_reason: String(err?.message ?? err).slice(0, 500),
      updated_at: now(),
    });
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});

// GET /api/ops/content/approvals - List content approvals
contentCalendarRouter.get('/approvals', async (req: Request, res: Response) => {
  const { status, client_id } = req.query;
  let rows = await db.list('content_approvals', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (client_id) rows = rows.filter((r) => r.client_id === client_id);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, approvals: rows.slice(0, 500), total: rows.length });
});

// POST /api/ops/content/approvals - Create content approval
contentCalendarRouter.post('/approvals', async (req: Request, res: Response) => {
  const parsed = z.object({
    client_id: z.string().trim().min(1),
    project_id: z.string().trim().optional().or(z.literal('')),
    kind: z.string().trim().min(1).max(100).default('creative'),
    title: z.string().trim().min(1).max(200),
    preview_url: z.string().trim().optional(),
    caption: z.string().trim().optional(),
    series: z.string().trim().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid approval' }); return; }
  const d = parsed.data;
  const client = (await db.list('clients', { id: d.client_id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }
  const series = d.series?.trim() || randomUUID();
  const existing = await db.list('content_approvals', { series }, 100);
  const version = existing.reduce((m: number, r: any) => Math.max(m, Number(r.version) || 0), 0) + 1;
  const id = randomUUID();
  await db.insert('content_approvals', {
    id, series, version,
    client_id: d.client_id, project_id: d.project_id || null,
    kind: d.kind, title: d.title.trim(),
    preview_url: d.preview_url?.trim() || null,
    caption: d.caption?.trim() || null,
    status: 'pending', feedback: null, reviewed_at: null, created_at: now(),
  });
  res.json({ ok: true, id, version });
});

// POST /api/ops/content/approvals/:id/review - Approve/reject content
contentCalendarRouter.post('/approvals/:id/review', async (req: Request, res: Response) => {
  const row = (await db.list('content_approvals', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Approval item not found' }); return; }
  const parsed = z.object({
    decision: z.enum(['approved', 'rejected', 'revised']),
    feedback: z.string().trim().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid decision' }); return; }
  const { decision, feedback } = parsed.data;
  const newStatus = decision === 'revised' ? 'pending' : decision;
  const newVersion = decision === 'revised' ? (row.version ?? 1) + 1 : (row.version ?? 1);
  await db.update('content_approvals', req.params.id, {
    status: newStatus,
    version: newVersion,
    feedback: feedback?.trim() || null,
    reviewed_at: now(),
  });
  await db.insert('project_activities', {
    id: randomUUID(), project_id: row.project_id || '', actor: req.user!.id || 'system',
    type: 'approval',
    body: `${decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Revision requested'}: ${row.title} (v${row.version} → v${newVersion})${feedback ? ` — ${feedback}` : ''}`,
    created_at: now(),
  });
  res.json({ ok: true, status: newStatus, version: newVersion });
});

export default contentCalendarRouter;