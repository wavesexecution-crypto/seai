import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const projectsRouter = Router();
projectsRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'account_manager', 'project_manager', 'marketing', 'designer', 'developer'));

const projectSchema = z.object({
  client_id: z.string().trim().min(1),
  agreement_id: z.string().trim().optional().or(z.literal('')),
  service_category: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(200),
  brief: z.string().trim().max(4000).optional(),
  assigned_to: z.string().trim().max(64).optional(),
  start_date: z.string().trim().max(30).optional(),
  due_date: z.string().trim().max(30).optional(),
  status: z.enum(['planned', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
});

const taskSchema = z.object({
  project_id: z.string().trim().min(1),
  seq: z.coerce.number().min(0).default(0),
  kind: z.enum(['task', 'deliverable', 'milestone']).default('task'),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).optional(),
  owner_id: z.string().trim().max(64).optional(),
  due_date: z.string().trim().max(30).optional(),
  status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'skipped']).optional(),
  approval_required: z.boolean().optional(),
  is_gate: z.boolean().optional(),
});

// GET /api/ops/projects
projectsRouter.get('/', async (req: Request, res: Response) => {
  const { status, client_id } = req.query;
  let rows = await db.list('projects', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (client_id) rows = rows.filter((r) => r.client_id === client_id);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, projects: rows });
});

// GET /api/ops/projects/:id
projectsRouter.get('/:id', async (req: Request, res: Response) => {
  const project = (await db.list('projects', { id: req.params.id }, 1))[0];
  if (!project) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  const tasks = await db.list('project_tasks', { project_id: project.id }, 500);
  tasks.sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
  const done = tasks.filter((t) => t.status === 'done').length;
  res.json({ ok: true, project, tasks, progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0 });
});

// POST /api/ops/projects
projectsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid project' }); return; }
  const d = parsed.data;
  // Validate service category exists in services catalogue
  const service = (await db.list('services', { key: d.service_category, is_active: true }, 1))[0];
  if (!service) {
    res.status(400).json({ ok: false, error: `Service category '${d.service_category}' is not active or does not exist` });
    return;
  }
  const id = randomUUID();
  await db.insert('projects', {
    id, client_id: d.client_id, agreement_id: d.agreement_id || null,
    service_category: d.service_category, name: d.name, brief: d.brief || null,
    assigned_to: d.assigned_to || null, start_date: d.start_date || null,
    due_date: d.due_date || null,
    status: d.status || 'pending',
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/projects/:id
projectsRouter.patch('/:id', async (req: Request, res: Response) => {
  const project = (await db.list('projects', { id: req.params.id }, 1))[0];
  if (!project) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  const allowed = ['name', 'brief', 'status', 'assigned_to', 'start_date', 'due_date', 'service_category', 'agreement_id'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) patch[k] = req.body[k] === '' ? null : req.body[k];
  }
  if (patch.status && !['planned', 'active', 'on_hold', 'completed', 'cancelled'].includes(String(patch.status))) {
    res.status(400).json({ ok: false, error: 'Invalid status' }); return;
  }
  patch.updated_at = now();
  await db.update('projects', req.params.id, patch);
  res.json({ ok: true });
});

// POST /api/ops/projects/:id/tasks
projectsRouter.post('/:id/tasks', async (req: Request, res: Response) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid task' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('project_tasks', {
    id, project_id: d.project_id, seq: d.seq, kind: d.kind, title: d.title,
    detail: d.detail || null, owner_id: d.owner_id || null, due_date: d.due_date || null,
    status: d.status || 'pending', approval_required: Boolean(d.approval_required),
    is_gate: Boolean(d.is_gate),
    created_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/tasks/:id
projectsRouter.patch('/tasks/:id', async (req: Request, res: Response) => {
  const task = (await db.list('project_tasks', { id: req.params.id }, 1))[0];
  if (!task) { res.status(404).json({ ok: false, error: 'Task not found' }); return; }
  const allowed = ['title', 'detail', 'status', 'owner_id', 'due_date', 'approval_required', 'is_gate', 'approved_by', 'approved_at', 'completed_at'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) patch[k] = req.body[k] === '' ? null : req.body[k];
  }
  if (patch.status === 'done' && !patch.completed_at) patch.completed_at = now();
  patch.updated_at = now();
  await db.update('project_tasks', req.params.id, patch);
  res.json({ ok: true });
});
