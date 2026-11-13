import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';

export const websitesRouter = Router();
websitesRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'account_manager', 'project_manager', 'sales', 'developer', 'designer'));

const websiteSchema = z.object({
  client_id: z.string().trim().min(1),
  agreement_id: z.string().trim().optional().or(z.literal('')),
  service_category: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(200),
  domain: z.string().trim().min(1).max(200).optional(),
  brief: z.string().trim().max(4000).optional(),
  assigned_to: z.string().trim().max(64).optional(),
  start_date: z.string().trim().max(30).optional(),
  due_date: z.string().trim().max(30).optional(),
  status: z.enum(['planned', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
});

// GET /api/ops/websites — List all website projects
websitesRouter.get('/', async (req: Request, res: Response) => {
  const { status, client_id } = req.query;
  let rows = await db.list('projects', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (client_id) rows = rows.filter((r) => r.client_id === client_id);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, websites: rows.slice(0, 500), total: rows.length });
});

// GET /api/ops/websites/:id — Get website project details with tasks
websitesRouter.get('/:id', async (req: Request, res: Response) => {
  const project = (await db.list('projects', { id: req.params.id }, 1))[0];
  if (!project) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  const [tasks, activities, client, agreements] = await Promise.all([
    db.list('project_tasks', { project_id: project.id }, 500),
    db.list('project_activities', { project_id: project.id }, 500),
    db.list('clients', { id: project.client_id }, 1),
    db.list('service_agreements', { id: project.agreement_id }, 1),
  ]);
  tasks.sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
  const done = tasks.filter((t) => t.status === 'done').length;
  res.json({
    ok: true,
    project: { ...project, progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    tasks,
    activities: activities.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))),
    client: client[0] ?? null,
    agreement: agreements[0] ?? null,
  });
});

// POST /api/ops/websites — Create a website project
websitesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = websiteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid project' }); return; }
  const d = parsed.data;
  const client = (await db.list('clients', { id: d.client_id }, 1))[0];
  if (!client) { res.status(404).json({ ok: false, error: 'Client not found' }); return; }

  const id = randomUUID();
  await db.insert('projects', {
    id, client_id: d.client_id, agreement_id: d.agreement_id || null,
    service_category: d.service_category, name: d.name, brief: d.brief || null,
    assigned_to: d.assigned_to || client.account_manager_id || null,
    start_date: d.start_date || null, due_date: d.due_date || null,
    status: d.status || 'planned',
    created_at: now(), updated_at: now(),
  });

  // Create standard website workflow tasks
  const steps = [
    { title: 'Requirements & sitemap', kind: 'task', seq: 0, gate: false, deps: [] },
    { title: 'Wireframes / design direction', kind: 'deliverable', seq: 1, gate: true, deps: [0] },
    { title: 'Client approval — design', kind: 'milestone', seq: 2, gate: true, deps: [1] },
    { title: 'Development build', kind: 'task', seq: 3, gate: false, deps: [2] },
    { title: 'Content integration', kind: 'task', seq: 4, gate: false, deps: [3] },
    { title: 'Testing (forms, speed, mobile, SSL)', kind: 'task', seq: 5, gate: false, deps: [4] },
    { title: 'Client sign-off', kind: 'milestone', seq: 6, gate: true, deps: [5] },
    { title: 'Deploy & handover', kind: 'task', seq: 7, gate: false, deps: [6] },
    { title: 'Maintenance plan offer', kind: 'task', seq: 8, gate: false, deps: [7] },
  ];

  const stepIds: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = randomUUID();
    stepIds.push(stepId);
    await db.insert('project_tasks', {
      id: stepId, project_id: id, seq: step.seq, kind: step.kind,
      title: step.title,
      detail: `Website: ${d.name}`,
      owner_id: d.assigned_to || client.account_manager_id || null,
      due_date: null, status: 'pending',
      depends_on: step.deps?.length ? JSON.stringify(step.deps.map((d: number) => stepIds[d])) : null,
      approval_required: step.gate, is_gate: step.gate,
      created_at: now(),
    });
  }

  await db.insert('project_activities', {
    id: randomUUID(), project_id: id, actor: req.user!.id || 'system',
    type: 'created', body: `Website project created: ${d.name}`, created_at: now(),
  });

  res.json({ ok: true, id, name: d.name, tasks: stepIds.length });
});

// PATCH /api/ops/websites/:id — Update website project
websitesRouter.patch('/:id', async (req: Request, res: Response) => {
  const project = (await db.list('projects', { id: req.params.id }, 1))[0];
  if (!project) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  const allowed = ['name', 'brief', 'status', 'assigned_to', 'start_date', 'due_date', 'domain'];
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

// GET /api/ops/websites/:id/tasks — Get project tasks
websitesRouter.get('/:id/tasks', async (req: Request, res: Response) => {
  const tasks = await db.list('project_tasks', { project_id: req.params.id }, 500);
  tasks.sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
  res.json({ ok: true, tasks });
});

// POST /api/ops/websites/:id/tasks — Add task to project
websitesRouter.post('/:id/tasks', async (req: Request, res: Response) => {
  const project = (await db.list('projects', { id: req.params.id }, 1))[0];
  if (!project) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  const parsed = z.object({
    title: z.string().min(1).max(200),
    detail: z.string().trim().max(4000).optional(),
    kind: z.enum(['task', 'deliverable', 'milestone']).default('task'),
    seq: z.coerce.number().min(0).default(0),
    owner_id: z.string().trim().max(64).optional(),
    due_date: z.string().trim().max(30).optional(),
    status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'skipped']).optional(),
    approval_required: z.boolean().optional(),
    is_gate: z.boolean().optional(),
    depends_on: z.array(z.string()).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid task' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('project_tasks', {
    id, project_id: project.id, seq: d.seq, kind: d.kind, title: d.title,
    detail: d.detail || null, owner_id: d.owner_id || null,
    due_date: d.due_date || null, status: d.status || 'pending',
    approval_required: Boolean(d.approval_required), is_gate: Boolean(d.is_gate),
    depends_on: d.depends_on ? JSON.stringify(d.depends_on) : null,
    created_at: now(),
  });
  res.json({ ok: true, id });
});

// PATCH /api/ops/websites/tasks/:id — Update task
websitesRouter.patch('/tasks/:id', async (req: Request, res: Response) => {
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

// POST /api/ops/content/approvals — Create content approval request
websitesRouter.post('/approvals', async (req: Request, res: Response) => {
  const parsed = z.object({
    client_id: z.string().trim().min(1),
    project_id: z.string().trim().optional().or(z.literal('')),
    kind: z.string().trim().min(1).max(100).default('creative'),
    title: z.string().trim().min(1).max(200),
    preview_url: z.string().trim().optional(),
    caption: z.string().trim().max(500).optional(),
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

// PATCH /api/ops/content/approvals/:id/review — Client approves/rejects
websitesRouter.post('/approvals/:id/review', async (req: Request, res: Response) => {
  const row = (await db.list('content_approvals', { id: req.params.id }, 1))[0];
  if (!row) { res.status(404).json({ ok: false, error: 'Approval item not found' }); return; }
  const parsed = z.object({
    decision: z.enum(['approved', 'rejected']),
    feedback: z.string().trim().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid decision' }); return; }
  const { decision, feedback } = parsed.data;
  await db.update('content_approvals', req.params.id, { status: decision, feedback: feedback?.trim() || null, reviewed_at: now() });
  await db.insert('project_activities', {
    id: randomUUID(), project_id: row.project_id || '', actor: req.user!.id || 'system',
    type: 'approval',
    body: `${decision === 'approved' ? 'Approved' : 'Rejected'}: ${row.title} (v${row.version})${feedback ? ` — ${feedback}` : ''}`,
    created_at: now(),
  });
  res.json({ ok: true, status: decision });
});

export default websitesRouter;