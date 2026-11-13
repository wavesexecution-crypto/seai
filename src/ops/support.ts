import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const supportRouter = Router();
supportRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'account_manager', 'support'));

const ticketSchema = z.object({
  client_id: z.string().trim().min(1),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(4000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

// GET /api/ops/support
supportRouter.get('/', async (req: Request, res: Response) => {
  const { status } = req.query;
  let rows = await db.list('support_requests', {}, 2000);
  if (status) rows = rows.filter((r) => r.status === status);
  rows.sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const withMessages = await Promise.all(rows.slice(0, 200).map(async (r) => ({
    ...r,
    messages: (await db.list('support_messages', { request_id: r.id }, 200)).reverse(),
  })));
  res.json({ ok: true, requests: withMessages });
});

// GET /api/ops/support/:id
supportRouter.get('/:id', async (req: Request, res: Response) => {
  const r = (await db.list('support_requests', { id: req.params.id }, 1))[0];
  if (!r) { res.status(404).json({ ok: false, error: 'Request not found' }); return; }
  const messages = await db.list('support_messages', { request_id: r.id }, 200);
  res.json({ ok: true, request: r, messages: messages.reverse() });
});

// POST /api/ops/support
supportRouter.post('/', async (req: Request, res: Response) => {
  const parsed = ticketSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid ticket' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('support_requests', { id, client_id: d.client_id, subject: d.subject, body: d.body, status: 'open', priority: d.priority, created_at: now(), updated_at: now() });
  await db.insert('support_messages', { id: randomUUID(), request_id: id, sender_id: req.user!.id, sender_role: 'seai', body: d.body, created_at: now() });
  res.json({ ok: true, id });
});

// POST /api/ops/support/:id/messages
supportRouter.post('/:id/messages', async (req: Request, res: Response) => {
  const r = (await db.list('support_requests', { id: req.params.id }, 1))[0];
  if (!r) { res.status(404).json({ ok: false, error: 'Request not found' }); return; }
  const body = String(req.body?.body ?? '').trim().slice(0, 4000);
  if (!body) { res.status(400).json({ ok: false, error: 'Message is required' }); return; }
  await db.insert('support_messages', { id: randomUUID(), request_id: r.id, sender_id: req.user!.id, sender_role: 'seai', body, created_at: now() });
  await db.update('support_requests', r.id, { status: 'in_progress', updated_at: now() });
  res.json({ ok: true });
});

// PATCH /api/ops/support/:id
supportRouter.patch('/:id', async (req: Request, res: Response) => {
  const status = String(req.body?.status ?? '');
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) { res.status(400).json({ ok: false, error: 'Invalid status' }); return; }
  await db.update('support_requests', req.params.id, { status, updated_at: now() });
  res.json({ ok: true });
});
