import { Router, type Request, type Response } from 'express';import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const whatsappRouter = Router();
whatsappRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'marketing', 'support'));

// ---------- WhatsApp Templates ----------

const templateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  language: z.string().trim().min(1).max(10).default('en'),
  category: z.enum(['utility', 'marketing', 'authentication']).default('utility'),
  components: z.array(z.any()).optional().default([]),
  status: z.enum(['pending', 'approved', 'rejected', 'disabled']).default('pending'),
});

// GET /api/ops/whatsapp/templates - List templates
whatsappRouter.get('/templates', async (_req: Request, res: Response) => {
  const { status } = _req.query;
  let rows = await db.list('whatsapp_templates', {}, 1000);
  if (status) rows = rows.filter((r) => r.status === status);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, templates: rows, total: rows.length });
});

// GET /api/ops/whatsapp/templates/:id - Get a single template
whatsappRouter.get('/templates/:id', async (req: Request, res: Response) => {
  const row = (await db.list('whatsapp_templates', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Template not found' }); return; }
  res.json({ ok: true, template: row });
});

// POST /api/ops/whatsapp/templates - Create a template
whatsappRouter.post('/templates', async (req: Request, res: Response) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid template' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('whatsapp_templates', {
    id,
    name: d.name,
    language: d.language,
    category: d.category,
    components: JSON.stringify(d.components || []),
    status: d.status,
    created_by: req.user!.id,
    created_at: now(),
    updated_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/whatsapp/templates/:id - Update a template
whatsappRouter.patch('/templates/:id', async (req: Request, res: Response) => {
  const row = (await db.list('whatsapp_templates', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Template not found' }); return; }
  const allowed = ['name', 'language', 'category', 'components', 'status'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (k === 'components') patch[k] = JSON.stringify(req.body[k]);
      else patch[k] = req.body[k];
    }
  }
  patch.updated_at = now();
  await db.update('whatsapp_templates', req.params.id, patch);
  res.json({ ok: true });
});

// DELETE /api/ops/whatsapp/templates/:id - Delete a template
whatsappRouter.delete('/templates/:id', async (req: Request, res: Response) => {
  await db.deleteWhere('whatsapp_templates', { id: req.params.id });
  res.json({ ok: true });
});

// ---------- WhatsApp Messages ----------

// GET /api/ops/whatsapp/messages - List messages (with optional conversation filter)
whatsappRouter.get('/messages', async (req: Request, res: Response) => {
  const { conversation_id, direction, integration_id } = req.query;
  let rows = await db.list('whatsapp_messages', {}, 5000);
  if (conversation_id) rows = rows.filter((r) => r.conversation_id === conversation_id);
  if (direction) rows = rows.filter((r) => r.direction === direction);
  if (integration_id) rows = rows.filter((r) => r.integration_id === integration_id);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, messages: rows.slice(0, 1000), total: rows.length });
});

// GET /api/ops/whatsapp/messages/:id - Get a single message
whatsappRouter.get('/messages/:id', async (req: Request, res: Response) => {
  const row = (await db.list('whatsapp_messages', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Message not found' }); return; }
  res.json({ ok: true, message: row });
});

// GET /api/ops/whatsapp/conversations - List unique conversations
whatsappRouter.get('/conversations', async (req: Request, res: Response) => {
  const { integration_id } = req.query;
  let rows = await db.list('whatsapp_messages', {}, 5000);
  if (integration_id) rows = rows.filter((r) => r.integration_id === integration_id);
  // Group by conversation_id, get latest message per conversation
  const byConv: Record<string, any> = {};
  for (const r of rows) {
    const existing = byConv[r.conversation_id];
    if (!existing || String(r.created_at) > String(existing.created_at)) {
      byConv[r.conversation_id] = r;
    }
  }
  const conversations = Object.values(byConv).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, conversations: conversations.slice(0, 100), total: conversations.length });
});

// GET /api/ops/whatsapp/conversations/:conversation_id/messages - Messages in a conversation
whatsappRouter.get('/conversations/:conversation_id/messages', async (req: Request, res: Response) => {
  const { conversation_id } = req.params;
  const rows = await db.list('whatsapp_messages', {}, 5000);
  const convMessages = rows.filter((r) => r.conversation_id === conversation_id);
  convMessages.sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
  res.json({ ok: true, messages: convMessages, total: convMessages.length });
});

// POST /api/ops/whatsapp/send - Send a WhatsApp message via approved template or text
const sendSchema = z.object({
  integration_id: z.string().trim().min(1),
  to: z.string().trim().min(1).max(100),
  type: z.enum(['text', 'template']).default('text'),
  body: z.string().trim().optional(),
  template_name: z.string().trim().optional(),
  template_language: z.string().trim().optional().default('en'),
  template_components: z.array(z.any()).optional().default([]),
});

whatsappRouter.post('/send', async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' }); return; }
  const d = parsed.data;

  const integration = (await db.list('social_integrations', { id: d.integration_id }, 1))[0];
  if (!integration) { res.status(404).json({ ok: false, error: 'Integration not found' }); return; }
  if (integration.platform !== 'whatsapp') { res.status(400).json({ ok: false, error: 'Integration is not a WhatsApp account' }); return; }

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

  try {
    let publishData: any;
    let publishResp: any = null;
    if (d.type === 'template') {
      if (!d.template_name) { res.status(400).json({ ok: false, error: 'template_name required for template messages' }); return; }
      publishResp = await fetch(`https://graph.facebook.com/v21.0/${integration.account_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: d.to,
          type: 'template',
          template: {
            name: d.template_name,
            language: { code: d.template_language },
            components: d.template_components,
          },
        }),
      });
      publishData = await publishResp.json();
    } else {
      if (!d.body) { res.status(400).json({ ok: false, error: 'body required for text messages' }); return; }
      publishResp = await fetch(`https://graph.facebook.com/v21.0/${integration.account_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: d.to,
          type: 'text',
          text: { body: d.body },
        }),
      });
      publishData = await publishResp.json();
    }

    if (!publishResp.ok || !publishData.messages?.[0]?.id) {
      await db.insert('whatsapp_messages', {
        id: randomUUID(),
        integration_id: d.integration_id,
        wa_message_id: null,
        conversation_id: d.to,
        direction: 'outbound',
        type: d.type,
        body: d.body,
        status: 'failed',
        timestamp: new Date().toISOString(),
        raw_payload: JSON.stringify(publishData),
        created_at: now(),
      });
      res.status(400).json({ ok: false, error: publishData.error?.message || 'Failed to send message' });
      return;
    }

    await db.insert('whatsapp_messages', {
      id: randomUUID(),
      integration_id: d.integration_id,
      wa_message_id: publishData.messages[0].id,
      conversation_id: d.to,
      direction: 'outbound',
      type: d.type,
      body: d.body,
      status: 'sent',
      timestamp: new Date().toISOString(),
      raw_payload: JSON.stringify(publishData),
      created_at: now(),
    });

    res.json({ ok: true, message_id: publishData.messages[0].id, status: 'sent' });
  } catch (err: any) {
    await db.insert('whatsapp_messages', {
      id: randomUUID(),
      integration_id: d.integration_id,
      wa_message_id: null,
      conversation_id: d.to,
      direction: 'outbound',
      type: d.type,
      body: d.body,
      status: 'failed',
      timestamp: new Date().toISOString(),
      raw_payload: JSON.stringify({ error: String(err?.message ?? err) }),
      created_at: now(),
    });
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});

export default whatsappRouter;
