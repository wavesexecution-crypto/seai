import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { ALL_ROLES, normalizeRole, isSuperRole } from '../auth/roles.js';
import { now } from '../growth/service.js';

export const teamRouter = Router();
teamRouter.use(requireStaffRole('owner', 'administrator', 'admin'));

const roleSchema = z.object({
  role: z.enum([...ALL_ROLES] as [string, ...string[]]),
});

// GET /api/ops/team
teamRouter.get('/', async (_req: Request, res: Response) => {
  const users = await db.list('users', {}, 10000);
  res.json({
    ok: true,
    users: users.map((u) => ({
      id: u.id, full_name: u.full_name, email: u.email,
      role: normalizeRole(u.role), email_verified: u.email_verified,
      created_at: u.created_at, updated_at: u.updated_at,
    })),
    roles: ALL_ROLES,
  });
});

// PATCH /api/ops/team/:id/role
teamRouter.patch('/:id/role', async (req: Request, res: Response) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: 'Invalid role' }); return; }
  const target = (await db.list('users', { id: req.params.id }, 1))[0];
  if (!target) { res.status(404).json({ ok: false, error: 'User not found' }); return; }
  if (target.id === req.user!.id && parsed.data.role !== 'owner' && !isSuperRole(target.role)) {
    res.status(400).json({ ok: false, error: 'You cannot change your own super-role' }); return;
  }
  await db.update('users', target.id, { role: parsed.data.role, updated_at: now() });
  res.json({ ok: true, id: target.id, role: parsed.data.role });
});
