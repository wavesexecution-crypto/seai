import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { WORKFLOW_TEMPLATES } from './workflows.js';
import { now } from './service.js';

export async function createProjectFromWorkflow(input: {
  client_id: string; service_category: string; name?: string; assigned_to?: string | null;
  agreement_id?: string | null; start_date?: string | null; due_date?: string | null; brief?: string | null;
}, actor: string | null) {
  const client = (await db.list('clients', { id: input.client_id }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const template = WORKFLOW_TEMPLATES[input.service_category];
  if (!template) return { ok: false as const, error: `Unknown service category. Expected one of: ${Object.keys(WORKFLOW_TEMPLATES).join(', ')}` };
  const projectId = randomUUID();
  await db.insert('projects', {
    id: projectId, client_id: input.client_id,
    agreement_id: input.agreement_id ?? null,
    service_category: input.service_category,
    name: input.name?.trim() || `${input.service_category.replace('_', ' ')} — ${client.brand_name}`,
    brief: input.brief?.trim() || null,
    status: 'planned', assigned_to: input.assigned_to || client.account_manager_id || null,
    start_date: input.start_date || null, due_date: input.due_date || null,
    created_at: now(), updated_at: now(),
  });
  const stepIds: string[] = [];
  for (let i = 0; i < template.length; i += 1) {
    const step = template[i];
    const id = randomUUID();
    stepIds.push(id);
    await db.insert('project_tasks', {
      id, project_id: projectId, seq: i, kind: step.kind,
      title: step.title, detail: step.detail ?? null,
      owner_id: input.assigned_to || client.account_manager_id || null,
      due_date: null, status: 'pending',
      depends_on: step.deps?.length ? JSON.stringify(step.deps.map((d) => stepIds[d])) : null,
      approval_required: Boolean(step.gate), is_gate: Boolean(step.gate),
      created_at: now(),
    });
  }
  await addProjectActivity(projectId, actor, 'created', `Project created from ${input.service_category} workflow (${template.length} steps)`);
  return { ok: true as const, id: projectId, tasks: stepIds.length };
}

export async function addProjectActivity(projectId: string, actor: string | null, type: string, body: string) {
  await db.insert('project_activities', { id: randomUUID(), project_id: projectId, actor: actor ?? 'system', type, body, created_at: now() });
}

export async function updateTask(taskId: string, patch: Record<string, unknown>, actor: string | null) {
  const task = (await db.list('project_tasks', { id: taskId }, 1))[0];
  if (!task) return { ok: false as const, error: 'Task not found' };
  const clean: Record<string, unknown> = {};
  if ('status' in patch) {
    const s = String(patch.status);
    if (!['pending', 'in_progress', 'blocked', 'done', 'skipped'].includes(s)) return { ok: false as const, error: 'Invalid status' };
    if (s === 'done' && task.approval_required && !task.approved_at) {
      return { ok: false as const, error: 'This step requires approval before it can be completed' };
    }
    clean.status = s;
    if (s === 'done') clean.completed_at = now();
  }
  if ('owner_id' in patch) clean.owner_id = patch.owner_id ? String(patch.owner_id) : null;
  if ('due_date' in patch) clean.due_date = patch.due_date ? String(patch.due_date) : null;
  if ('title' in patch && String(patch.title).trim()) clean.title = String(patch.title).trim().slice(0, 300);
  await db.update('project_tasks', taskId, clean);
  if (clean.status === 'done') await addProjectActivity(task.project_id, actor, 'task_done', `Done: ${task.title}`);
  if (clean.status === 'blocked') await addProjectActivity(task.project_id, actor, 'task_blocked', `Blocked: ${task.title}`);
  return { ok: true as const, id: taskId };
}

export async function approveTask(taskId: string, approver: string | null, approve: boolean, feedback?: string) {
  const task = (await db.list('project_tasks', { id: taskId }, 1))[0];
  if (!task) return { ok: false as const, error: 'Task not found' };
  if (!task.approval_required) return { ok: false as const, error: 'This task does not require approval' };
  const patch = approve
    ? { approved_by: approver ?? 'staff', approved_at: now() }
    : { approved_by: null, approved_at: null, status: 'blocked' };
  await db.update('project_tasks', taskId, patch);
  await addProjectActivity(task.project_id, approver, 'approval', `${approve ? 'Approved' : 'Rejected'}: ${task.title}${feedback ? ` — ${feedback.slice(0, 300)}` : ''}`);
  return { ok: true as const, id: taskId, approved: approve };
}

export async function getProjectDetail(projectId: string) {
  const project = (await db.list('projects', { id: projectId }, 1))[0];
  if (!project) return null;
  const [tasks, activities] = await Promise.all([
    db.list('project_tasks', { project_id: projectId }, 500),
    db.list('project_activities', { project_id: projectId }, 500),
  ]);
  tasks.sort((a, b) => Number(a.seq) - Number(b.seq));
  return { project, tasks, activities: activities.reverse() };
}

// ---------------- Content approvals ----------------
export async function createApproval(input: {
  client_id: string; project_id?: string | null; kind?: string; title: string;
  preview_url?: string | null; caption?: string | null; series?: string | null;
}, _actor: string | null) {
  const client = (await db.list('clients', { id: input.client_id }, 1))[0];
  if (!client) return { ok: false as const, error: 'Client not found' };
  const series = input.series?.trim() || randomUUID();
  const existing = await db.list('content_approvals', { series }, 100);
  const version = existing.reduce((m, r) => Math.max(m, Number(r.version) || 0), 0) + 1;
  const id = randomUUID();
  await db.insert('content_approvals', {
    id, series, version,
    client_id: input.client_id, project_id: input.project_id ?? null,
    kind: input.kind || 'creative', title: input.title.trim(),
    preview_url: input.preview_url?.trim() || null,
    caption: input.caption?.trim() || null,
    status: 'pending', feedback: null, reviewed_at: null, created_at: now(),
  });
  return { ok: true as const, id, version };
}

export async function reviewApproval(id: string, decision: 'approved' | 'rejected', feedback: string | undefined, actor: string | null) {
  const row = (await db.list('content_approvals', { id }, 1))[0];
  if (!row) return { ok: false as const, error: 'Approval item not found' };
  await db.update('content_approvals', id, { status: decision, feedback: feedback?.trim() || null, reviewed_at: now() });
  if (row.project_id) await addProjectActivity(row.project_id, actor, 'approval', `${decision === 'approved' ? 'Approved' : 'Rejected'}: ${row.title} (v${row.version})${feedback ? ` — ${feedback.slice(0, 300)}` : ''}`);
  return { ok: true as const, id, status: decision };
}

// ---------------- Notifications ----------------
export async function notify(userId: string, title: string, body?: string, link?: string) {
  if (!userId) return;
  await db.insert('notifications', { id: randomUUID(), user_id: userId, title: title.slice(0, 200), body: body?.slice(0, 1000) ?? null, link: link ?? null, read_at: null, created_at: now() });
}
