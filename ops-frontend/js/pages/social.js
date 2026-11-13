/* SEAI Business Ops — Social Integrations page */
import { api } from '../api.js';

export const title = 'Social Integrations';
export const subtitle = 'Connect Meta, WhatsApp, Google, and other platform accounts';

let integrations = [];

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Platform</th><th>Account</th><th>Account ID</th><th>Health</th><th>Active</th><th>Workspace</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="integrations-table-body"></tbody>
        </table>
      </div>
    </div>
    <div class="mt-16">
      <p class="muted">Tokens are encrypted at rest. Connect accounts via the settings console or OAuth flow.</p>
    </div>
  `;

  await loadIntegrations();
}

async function loadIntegrations() {
  try {
    const data = await api.get('/api/ops/social/integrations');
    integrations = data.integrations || [];
    renderTable(integrations);
  } catch (err) {
    console.error('Load integrations failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('integrations-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="7" class="empty-state">No integrations connected.</td></tr>';
    return;
  }
  el.innerHTML = items.map((i) => `
    <tr>
      <td style="font-weight:600;font-size:11px">${escapeHtml(i.platform)}</td>
      <td style="font-size:11px">${escapeHtml(i.account_name)}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--faint)">${escapeHtml(i.account_id)}</td>
      <td><span class="badge badge-${i.health_status}">${i.health_status}</span></td>
      <td><span class="badge badge-${i.is_active ? 'active' : 'cancelled'}">${i.is_active ? 'Yes' : 'No'}</span></td>
      <td style="font-size:11px">${i.workspace_type}${i.workspace_id ? ' #' + i.workspace_id.slice(0, 6) : ''}</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.refreshIntegration('${i.id}')">Refresh Token</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.refreshIntegration = async (id) => {
  try {
    await api.post(`/api/ops/social/integrations/${id}/refresh`);
    loadIntegrations();
  } catch (err) { alert('Failed: ' + err.message); }
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadIntegrations();
}