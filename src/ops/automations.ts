import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const automationsRouter = Router();
automationsRouter.use(requireStaffRole('owner', 'administrator', 'admin'));

// Registered task types (mirrors the Python registry)
const TASK_TYPES = [
  { key: 'lead_research', type: 'research', description: 'Research businesses from public sources and save leads to CRM' },
  { key: 'website_research', type: 'research', description: 'Visit a website and extract structured business information' },
  { key: 'competitor_monitor', type: 'monitor', description: 'Monitor competitor websites for changes' },
  { key: 'crm_automation', type: 'crm', description: 'Import, deduplicate, and update lead statuses' },
  { key: 'social_media', type: 'social', description: 'Social media analytics and content preparation' },
  { key: 'business_monitor', type: 'monitor', description: 'Check website/API health and report overdue items' },
];

const createTaskSchema = z.object({
  script_name: z.enum([...TASK_TYPES.map((t) => t.key)] as [string, ...string[]]),
  input_params: z.record(z.any()).optional().default({}),
  max_retries: z.coerce.number().min(0).max(10).default(3),
  timeout_seconds: z.coerce.number().min(30).max(3600).default(300),
});

// GET /api/ops/automations/types — list available task types
automationsRouter.get('/types', async (_req: Request, res: Response) => {
  res.json({ ok: true, task_types: TASK_TYPES });
});

// GET /api/ops/automations — list tasks
automationsRouter.get('/', async (req: Request, res: Response) => {
  const { status, limit } = req.query;
  let rows = await db.list('automation_tasks', {}, 500);
  if (status) rows = rows.filter((r) => r.status === status);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  const lim = limit ? Math.min(200, Math.max(1, Number(limit))) : 100;
  res.json({ ok: true, tasks: rows.slice(0, lim), total: rows.length });
});

// GET /api/ops/automations/:id — get task details
automationsRouter.get('/:id', async (req: Request, res: Response) => {
  const task = await db.list('automation_tasks', { id: req.params.id }, 1);
  if (!task[0]) { res.status(404).json({ ok: false, error: 'Task not found' }); return; }
  const logs = await db.list('automation_logs', { task_id: req.params.id }, 100);
  logs.sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
  res.json({ ok: true, task: task[0], logs });
});

// POST /api/ops/automations — create a task
automationsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid task' });
    return;
  }
  const d = parsed.data;
  const id = randomUUID();
  const taskType = TASK_TYPES.find((t) => t.key === d.script_name);
  await db.insert('automation_tasks', {
    id, script_name: d.script_name, task_type: taskType?.type ?? 'custom',
    input_params: JSON.stringify(d.input_params), status: 'pending',
    max_retries: d.max_retries, timeout_seconds: d.timeout_seconds,
    created_by: req.user!.id, created_at: now(), updated_at: now(),
  });
  await db.insert('automation_logs', {
    id: randomUUID(), task_id: id, level: 'info',
    message: `Task created: ${d.script_name}`,
    details: JSON.stringify({ input_params: d.input_params }),
    created_at: now(),
  });
  res.json({ ok: true, id, script_name: d.script_name, status: 'pending' });
});

// PATCH /api/ops/automations/:id/cancel — cancel a pending/running task
automationsRouter.patch('/:id/cancel', async (req: Request, res: Response) => {
  const task = await db.list('automation_tasks', { id: req.params.id }, 1);
  if (!task[0]) { res.status(404).json({ ok: false, error: 'Task not found' }); return; }
  if (!['pending', 'running'].includes(task[0].status)) {
    res.status(400).json({ ok: false, error: `Cannot cancel a ${task[0].status} task` });
    return;
  }
  await db.update('automation_tasks', req.params.id, { status: 'cancelled', updated_at: now() });
  await db.insert('automation_logs', {
    id: randomUUID(), task_id: req.params.id, level: 'info',
    message: 'Task cancelled by user',
    created_at: now(),
  });
  res.json({ ok: true, status: 'cancelled' });
});

// POST /api/ops/automations/:id/retry — retry a failed task
automationsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  const task = await db.list('automation_tasks', { id: req.params.id }, 1);
  if (!task[0]) { res.status(404).json({ ok: false, error: 'Task not found' }); return; }
  if (task[0].status !== 'failed') {
    res.status(400).json({ ok: false, error: `Cannot retry a ${task[0].status} task` });
    return;
  }

  await db.update('automation_tasks', req.params.id, {
    status: 'pending',
    retry_count: 0,
    error: null,
    updated_at: now(),
  });
  await db.insert('automation_logs', {
    id: randomUUID(), task_id: req.params.id, level: 'info',
    message: 'Task retried by user',
    created_at: now(),
  });
  res.json({ ok: true, status: 'pending' });
});

// DELETE /api/ops/automations/:id — delete a task
automationsRouter.delete('/:id', async (req: Request, res: Response) => {
  await db.deleteWhere('automation_logs', { task_id: req.params.id });
  await db.deleteWhere('automation_tasks', { id: req.params.id });
  res.json({ ok: true });
});
