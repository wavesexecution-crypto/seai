/* SEAI Business Ops — Projects page */
import { api } from '../api.js';

export const title = 'Projects';
export const subtitle = 'Service delivery projects, tasks, and milestones';

const STATUS_ORDER = ['pending', 'onboarding', 'in_progress', 'review', 'awaiting_client', 'completed', 'on_hold'];
const STATUS_LABEL = {
  pending: 'Pending', onboarding: 'Onboarding', in_progress: 'In Progress', review: 'Review',
  awaiting_client: 'Awaiting Client', completed: 'Completed', on_hold: 'On Hold'
};

let projects = [];

export async function render(container) {
  container.innerHTML = `
    <div class="row between mt-8">
      <button class="btn-primary" id="btn-new-project">+ New Project</button>
      <select id="filter-status" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
        <option value="">All statuses</option>
        ${STATUS_ORDER.map(s => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}
      </select>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Project</th><th>Client</th><th>Category</th><th>Status</th><th>Assigned</th><th>Due</th><th>Progress</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="projects-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-project').addEventListener('click', openProjectEditor);
  document.getElementById('filter-status').addEventListener('change', (e) => {
    const v = e.target.value;
    renderTable(v ? projects.filter((p) => p.status === v) : projects);
  });

  await loadProjects();
}

async function loadProjects() {
  try {
    const data = await api.get('/projects');
    projects = data.projects || [];
    renderTable(projects);
  } catch (err) {
    console.error('Load projects failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('projects-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="8" class="empty-state">No projects found.</td></tr>';
    return;
  }
  el.innerHTML = items.map((p) => {
    const progress = p.progress != null ? p.progress : 0;
    return `
    <tr>
      <td style="font-weight:600">${escapeHtml(p.name)}</td>
      <td style="font-size:11px;color:var(--faint)">${p.client_id ? 'Client #' + p.client_id.slice(0, 6) : '—'}</td>
      <td style="font-size:11px">${escapeHtml(p.service_category)}</td>
      <td><span class="badge badge-${p.status}">${p.status}</span></td>
      <td style="font-size:11px;color:var(--faint)">${escapeHtml(p.assigned_to || '—')}</td>
      <td style="font-size:11px;color:var(--faint)">${p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}</td>
      <td><div style="width:60px;background:#1a1a1a;border-radius:4px;overflow:hidden"><div style="width:${progress}%;background:#fff;height:8px"></div></div> ${progress}%</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.openProject('${p.id}')">View</button></td>
    </tr>
  `).join('');
}

async function loadProjects() {
  try {
    const data = await api.get('/projects');
    projects = data.projects || [];
    renderTable(projects);
  } catch (err) {
    console.error('Load projects failed:', err);
  }
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.openProject = async (id) => {
  try {
    const data = await api.get(`/api/ops/projects/${id}`);
    const p = data.project;
    const tasks = data.tasks || [];
    document.getElementById('modal-title').textContent = p.name;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-row">
        <div style="grid-column:span 2"><label>Category</label><div>${escapeHtml(p.service_category)}</div></div>
        <div><label>Status</label><div><span class="badge badge-${p.status}">${p.status}</span></div></div>
        <div><label>Assigned</label><div>${escapeHtml(p.assigned_to || '—')}</div></div>
        <div><label>Progress</label><div style="font-weight:600">${data.progress || 0}%</div></div>
      </div>
      <div class="panel mt-16"><h2>Tasks (${tasks.length})</h2>
        <table style="margin-top:8px"><thead><tr><th>Title</th><th>Owner</th><th>Status</th><th>Due</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${tasks.map((t) => `
            <tr>
              <td style="font-size:11px">${escapeHtml(t.title)}</td>
              <td style="font-size:11px">${escapeHtml(t.owner_id || '—')}</td>
              <td style="font-size:11px"><span class="badge badge-${t.status}">${t.status}</span></td>
              <td style="font-size:11px">${t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</td>
              <td style="text-align:right"><button class="ghost-btn" style="width:auto">${t.status === 'done' ? 'Done' : t.status}</button></td>
            </tr>
          `).join('')}
        </tbody></table>
      </div>
      <div class="row mt-16" style="gap:8px"><button class="ghost-btn" onclick="closeLeadModal()">Close</button></div>
    `;
    document.getElementById('lead-modal').style.display = 'block';
  } catch (err) {
    alert('Failed to load project: ' + err.message);
  }
};

window.SEAI_OPS_PAGES.openProject = window.SEAI_OPS_PAGES.openProject;

function openProjectEditor() {
  alert('Project creation — use the staff console or API.');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadProjects();
}