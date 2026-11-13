/* SEAI Business Ops — Team page */
import { api } from '../api.js';

export const title = 'Team';
export const subtitle = 'Staff directory and role management';

let users = [];

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Verified</th><th>Created</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="team-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  await loadTeam();
}

async function loadTeam() {
  try {
    const data = await api.get('/api/ops/team');
    users = data.users || [];
    renderTable(users);
  } catch (err) {
    console.error('Load team failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('team-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="7" class="empty-state">No staff found.</td></tr>';
    return;
  }
  el.innerHTML = items.map((u) => `
    <tr>
      <td style="font-weight:600">${escapeHtml(u.full_name)}</td>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(u.email)}</td>
      <td style="font-size:11px">${escapeHtml(u.role)}</td>
      <td style="font-size:11px">${u.email_verified ? 'Yes' : 'No'}</td>
      <td style="font-size:11px;color:var(--faint)">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
      <td style="text-align:right">
        <select onchange="SEAI_OPS_PAGES.changeRole('${u.id}', this.value)" style="padding:4px 8px;border-radius:6px;background:#0e0e10;color:#fff;border:1px solid var(--line2)">
          ${['owner', 'administrator', 'admin', 'sales', 'account_manager', 'project_manager', 'marketing', 'designer', 'developer', 'finance', 'support', 'customer'].map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.changeRole = async (id, role) => {
  try {
    await api.patch(`/api/ops/team/${id}/role`, { role });
    loadTeam();
  } catch (err) { alert('Failed: ' + err.message); loadTeam(); }
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadTeam();
}