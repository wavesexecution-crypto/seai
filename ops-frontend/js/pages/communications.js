/* SEAI Business Ops — Communications (Phase 8) */
import { api } from '../api.js';

export const title = 'Communications';
export const subtitle = 'WhatsApp, email, and inquiries — all client communication in one place';

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <h2>Unified Inbox</h2>
      <p class="muted">Connect WhatsApp Business and email in Settings to centralise all client communication.</p>
    </div>

    <div class="grid cards" id="comm-cards">
      <div class="card"><div class="k">Open Conversations</div><div class="v" id="comm-open">—</div></div>
      <div class="card"><div class="k">Unread Messages</div><div class="v" id="comm-unread">—</div></div>
      <div class="card"><div class="k">Today's Messages</div><div class="v" id="comm-today">—</div></div>
      <div class="card"><div class="k">Response Time</div><div class="v" id="comm-response">—</div></div>
    </div>

    <div class="panel mt-16">
      <h2>Recent Conversations</h2>
      <div id="comm-list" class="empty-state">Connect messaging platforms in Settings to view conversations.</div>
    </div>
  `;

  await loadData();
  return container;
}

async function loadData() {
  try {
    const data = await api.get('/support');
    const requests = data.requests || [];
    document.getElementById('comm-open').textContent = requests.filter((r) => r.status === 'open').length;
    document.getElementById('comm-unread').textContent = requests.filter((r) => r.status === 'open').length;
    document.getElementById('comm-today').textContent = requests.filter((r) => String(r.created_at).slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    document.getElementById('comm-response').textContent = '—';
    renderList(requests);
  } catch (err) {
    console.error('Load communications failed:', err);
    document.getElementById('comm-list').innerHTML = '<div class="empty-state">No conversation data available.</div>';
  }
}

function renderList(items) {
  const el = document.getElementById('comm-list');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty-state">No conversations yet.</div>';
    return;
  }
  el.innerHTML = items.map((t) => `
    <div style="border-bottom:1px solid var(--line2);padding:10px 0">
      <div style="font-weight:600">${escapeHtml(t.subject)}</div>
      <div style="font-size:11px;color:var(--faint)">${t.client_id ? 'Client #' + t.client_id.slice(0, 6) : '—'} · <span class="badge badge-${t.status}">${t.status}</span></div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadData();
}
