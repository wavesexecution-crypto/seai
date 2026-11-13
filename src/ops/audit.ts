import { Router, type Request, type Response } from 'express';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';

export const auditRouter = Router();
auditRouter.use(requireStaffRole('owner', 'administrator', 'admin'));

// GET /api/ops/audit/logs - View audit log entries
auditRouter.get('/logs', async (req: Request, res: Response) => {
  const { actor, action, limit } = req.query;
  let rows = await db.list('audit_logs', {}, 10000);
  if (actor) rows = rows.filter((r) => r.actor === actor);
  if (action) rows = rows.filter((r) => String(r.action ?? '').includes(String(action)));
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  const lim = limit ? Math.min(500, Math.max(1, Number(limit))) : 100;
  res.json({ ok: true, logs: rows.slice(0, lim), total: rows.length });
});
