/* SEAI Business Ops — Social Integrations page */
import { api } from '../api.js';

export const title = 'Social Integrations';
export const subtitle = 'Connect Meta, WhatsApp, Google, and other platform accounts';

let integrations = [];

export async function render(container) {
  // Show transient result from OAuth callback redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get('google') === 'connected') {
    params.delete('google');
    window.history.replaceState({}, '', window.location.pathname);
    showMessage('Google account connected successfully.', 'ok');
  } else if (params.get('error')) {
    const error = params.get('error');
    params.delete('error');
    window.history.replaceState({}, '', window.location.pathname);
    showMessage('Google connection failed: ' + escapeHtml(error), 'err');
  }

  container.innerHTML = `
    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Platform</th><th>Account</th><th>Account ID</th><th>Health</th><th>Active</th><th>Workspace</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="integrations-table-body"></tbody>
        </div>
      </div>
    </div>
    <div class="mt-16">
      <p class="muted">Tokens are encrypted at rest. Connect accounts via the settings console or OAuth flow.</p>
      <button class="btn btn-primary" id="connect-google">Connect Google Account</button>
    </div>
    <div id="oauth-message" class="mt-8"></div>
  `;

  document.getElementById('connect-google').addEventListener('click', connectGoogle);

  await loadIntegrations();
}

function showMessage(text, kind) {
  const el = document.getElementById('oauth-message');
  if (!el) return;
  el.innerHTML = `<p class="${kind === 'ok' ? 'ok' : 'err'}">${text}</p>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

async function connectGoogle() {
  try {
    const data = await api.get('/api/ops/social/oauth/google/url');
    if (data.auth_url) {
      window.location.href = data.auth_url;
    } else {
      throw new Error(data.error || 'No auth URL returned');
    }
  } catch (err) {
    alert('Failed to start Google connection: ' + err.message);
  }
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