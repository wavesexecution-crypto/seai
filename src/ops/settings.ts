import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { config } from '../config.js';
import { now } from '../growth/service.js';

export const settingsRouter = Router();
settingsRouter.use(requireStaffRole('owner', 'administrator', 'admin'));

// GET /api/ops/settings/integrations - Integration health status
settingsRouter.get('/integrations', async (_req: Request, res: Response) => {
  const integrations = await db.list('social_integrations', {}, 1000);
  const nowIso = new Date().toISOString();
  const healthy = integrations.filter((r) => r.health_status === 'healthy').length;
  const expired = integrations.filter((r) => {
    if (!r.token_expires_at) return false;
    return new Date(r.token_expires_at) < new Date(nowIso);
  }).length;
  res.json({
    ok: true,
    total: integrations.length,
    healthy,
    expired,
    by_platform: integrations.reduce((acc: Record<string, number>, r) => {
      acc[String(r.platform)] = (acc[String(r.platform)] ?? 0) + 1;
      return acc;
    }, {}),
    integrations: integrations.map((r) => ({
      id: r.id,
      platform: r.platform,
      account_name: r.account_name,
      health_status: r.health_status,
      token_expires_at: r.token_expires_at,
      is_active: r.is_active,
    })),
  });
});

// GET /api/ops/settings/health - System health check
settingsRouter.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let allOk = true;

  // Database connectivity
  try {
    await db.query('SELECT 1');
    checks.database = { ok: true, detail: 'Neon PostgreSQL reachable' };
  } catch (err: any) {
    checks.database = { ok: false, detail: String(err?.message ?? err) };
    allOk = false;
  }

  // Encryption key configured
  checks.encryption_key = {
    ok: Boolean(config.encryptionKey),
    detail: config.encryptionKey ? 'Configured' : 'Missing — token encryption will fail',
  };
  if (!config.encryptionKey) allOk = false;

  // Staff API key
  checks.staff_api_key = {
    ok: Boolean(config.staffApiKey),
    detail: config.staffApiKey ? 'Configured' : 'Missing — staff-only operations disabled',
  };
  if (!config.staffApiKey) allOk = false;

  // Razorpay / payments control plane
  checks.payments = {
    ok: Boolean(config.paymentsServiceKey),
    detail: config.paymentsServiceKey ? 'Configured' : 'Missing — Razorpay payments unavailable',
  };
  if (!config.paymentsServiceKey) allOk = false;

  // Meta OAuth
  checks.meta_oauth = {
    ok: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    detail: process.env.META_APP_ID && process.env.META_APP_SECRET ? 'Configured' : 'Missing — Meta social connect unavailable',
  };
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) allOk = false;

  // Google Ads developer token
  checks.google_ads = {
    ok: Boolean(config.googleAdsDeveloperToken),
    detail: config.googleAdsDeveloperToken ? 'Configured' : 'Missing — Google Ads API unavailable',
  };
  if (!config.googleAdsDeveloperToken) allOk = false;

  // Google OAuth
  checks.google_oauth = {
    ok: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    detail: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? 'Configured' : 'Missing — Google connect unavailable',
  };
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) allOk = false;

  res.json({
    ok: allOk,
    checks,
  });
});

// GET /api/ops/settings/services - Service catalogue (read-only)
settingsRouter.get('/services', async (_req: Request, res: Response) => {
  const rows = await db.list('services', {}, 1000);
  rows.sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
  res.json({ ok: true, services: rows });
});

// ---------- Notifications ----------

// GET /api/ops/settings/notifications - List notifications
settingsRouter.get('/notifications', async (req: Request, res: Response) => {
  const { user_id, unread_only } = req.query;
  let rows = await db.list('notifications', {}, 1000);
  if (user_id) rows = rows.filter((r) => r.user_id === user_id);
  if (unread_only === 'true') rows = rows.filter((r) => !r.read_at);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, notifications: rows.slice(0, 100), total: rows.length });
});

// POST /api/ops/settings/notifications - Create a notification
settingsRouter.post('/notifications', async (req: Request, res: Response) => {
  const parsed = z.object({
    user_id: z.string().trim().min(1),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().optional(),
    link: z.string().trim().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid notification' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('notifications', {
    id, user_id: d.user_id, title: d.title, body: d.body || null, link: d.link || null,
    created_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/settings/notifications/:id/read - Mark notification as read
settingsRouter.patch('/notifications/:id/read', async (req: Request, res: Response) => {
  const row = (await db.list('notifications', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Notification not found' }); return; }
  await db.update('notifications', req.params.id, { read_at: now() });
  res.json({ ok: true });
});
