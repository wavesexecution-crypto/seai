/* SEAI Business Ops — Automations page */
import { api } from '../api.js';

export const title = 'Automations';
export const subtitle = 'Task execution engine — workflows, execution history, and failures';

let tasks = [];

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <h2>Automation Engine</h2>
      <p class="muted">Manage automation workflows, view execution history, and check for failures.</p>
    </div>

    <div class="grid cards" id="auto-cards">
      <div class="card"><div class="k">Active Workflows</div><div class="v" id="auto-active">—</div></div>
      <div class="card"><div class="k">Executions Today</div><div class="v" id="auto-today">—</div></div>
      <div class="card"><div class="k">Failed</div><div class="v" id="auto-failed">—</div></div>
      <div class="card"><div class="k">Success Rate</div><div class="v" id="auto-success">—</div></div>
    </div>

    <div class="panel mt-16">
      <h2>Recent Executions</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Task</th><th>Script</th><th>Type</th><th>Status</th><th>Started</th><th>Completed</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="automations-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  await loadTasks();
}

async function loadTasks() {
  try {
    const data = await api.get('/api/ops/automations');
    tasks = data.tasks || [];
    document.getElementById('auto-active').textContent = tasks.filter((t) => t.status === 'running').length;
    document.getElementById('auto-today').textContent = tasks.filter((t) => String(t.created_at).slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    document.getElementById('auto-failed').textContent = tasks.filter((t) => t.status === 'failed').length;
    const total = tasks.length;
    const success = tasks.filter((t) => t.status === 'completed').length;
    document.getElementById('auto-success').textContent = total ? Math.round((success / total) * 100) + '%' : '—';
    renderTable(tasks);
  } catch (err) {
    console.error('Load automations failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('automations-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="8" class="empty-state">No tasks found.</td></tr>';
    return;
  }
  el.innerHTML = items.map((t) => {
    const started = t.started_at ? new Date(t.started_at).toLocaleDateString() : '—';
    const completed = t.completed_at ? new Date(t.completed_at).toLocaleDateString() : '—';
    return `
    <tr>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(t.id.slice(0, 8))}</td>
      <td style="font-weight:600;font-size:11px">${escapeHtml(t.script_name)}</td>
      <td style="font-size:11px">${escapeHtml(t.task_type)}</td>
      <td><span class="badge badge-${t.status}">${t.status}</span></td>
      <td style="font-size:11px">${t.retry_count}/${t.max_retries}</td>
      <td style="font-size:11px;color:var(--faint)">${started}</td>
      <td style="font-size:11px;color:var(--faint)">${completed}</td>
      <td style="text-align:right">
        <button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.openTask('${t.id}')">View</button>
        ${t.status === 'failed' ? `<button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.retryTask('${t.id}')">Retry</button>` : ''}
        ${['pending', 'running'].includes(t.status) ? `<button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.cancelTask('${t.id}')">Cancel</button>` : ''}
      </td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.openTask = async (id) => {
  try {
    const data = await api.get(`/api/ops/automations/${id}`);
    const task = data.task;
    const logs = data.logs || [];
    document.getElementById('modal-title').textContent = `${task.script_name} (${task.id.slice(0, 8)})`;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-row">
        <div style="grid-column:span 2"><label>ID</label><div style="font-family:var(--mono);font-size:11px">${escapeHtml(task.id)}</div></div>
        <div><label>Script</label><div style="font-weight:600">${escapeHtml(task.script_name)}</div></div>
        <div><label>Type</label><div>${escapeHtml(task.task_type)}</div></div>
        <div><label>Status</label><div><span class="badge badge-${task.status}">${task.status}</span></div></div>
        <div><label>Retries</label><div>${task.retry_count}/${task.max_retries}</div></div>
        <div><label>Created</label><div>${task.created_at ? new Date(task.created_at).toLocaleString() : '—'}</div></div>
        <div><label>Started</label><div>${task.started_at ? new Date(task.started_at).toLocaleString() : '—'}</div></div>
        <div><label>Completed</label><div>${task.completed_at ? new Date(task.completed_at).toLocaleString() : '—'}</div></div>
      </div>
      ${task.error ? `<div class="panel mt-16"><h2>Error</h2><div style="background:#2a1a1a;border:1px solid #5a2a2a;border-radius:8px;padding:12px;color:#ff6b6b;font-size:12px;white-space:pre-wrap">${escapeHtml(task.error)}</div></div>` : ''}
      ${task.output ? `<div class="panel mt-16"><h2>Output</h2><div style="background:#1a1a1a;border:1px solid var(--line2);border-radius:8px;padding:12px;color:#c5c5ff;font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto">${escapeHtml(JSON.stringify(task.output, null, 2))}</div></div>` : ''}
      <div class="panel mt-16">
        <h2>Execution Logs (${logs.length})</h2>
        <div style="border:1px solid var(--line2);border-radius:8px;background:#0a0a0a;max-height:400px;overflow-y:auto;padding:12px">
          ${logs.map((l) => `
            <div style="border-bottom:1px solid var(--line2);padding:8px 0">
              <div style="font-size:10px;color:var(--faint);text-transform:uppercase">${escapeHtml(l.level)} · ${new Date(l.created_at).toLocaleString()}</div>
              <div style="font-size:12px">${escapeHtml(l.message)}</div>
              ${l.details ? `<div style="font-size:11px;color:var(--faint);margin-top:4px">${escapeHtml(typeof l.details === 'string' ? l.details : JSON.stringify(l.details))}</div>` : ''}
            </div>
          `).join('') || '<div style="color:var(--faint);font-size:11px">No logs yet.</div>'}
        </div>
      </div>
      <div class="row mt-16" style="gap:8px">
        ${task.status === 'failed' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.retryTask('${task.id}')">Retry Task</button>` : ''}
        ${['pending', 'running'].includes(task.status) ? `<button class="ghost-btn" onclick="SEAI_OPS_PAGES.cancelTask('${task.id}')">Cancel Task</button>` : ''}
        <button class="ghost-btn" onclick="closeLeadModal()">Close</button>
      </div>
    `;
    document.getElementById('lead-modal').style.display = 'block';
  } catch (err) {
    alert('Failed to load task: ' + err.message);
  }
};

window.SEAI_OPS_PAGES.retryTask = async (id) => {
  try {
    await api.post(`/api/ops/automations/${id}/retry`);
    closeLeadModal();
    loadTasks();
  } catch (err) { alert('Failed: ' + err.message); }
};

window.SEAI_OPS_PAGES.cancelTask = async (id) => {
  try {
    await api.patch(`/api/ops/automations/${id}/cancel`, {});
    closeLeadModal();
    loadTasks();
  } catch (err) { alert('Failed: ' + err.message); }
};

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadTasks();
}