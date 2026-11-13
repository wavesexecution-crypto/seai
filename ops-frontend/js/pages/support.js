/* SEAI Business Ops — Support page */
import { api } from '../api.js';

export const title = 'Support';
export const subtitle = 'Client support tickets and communication';

let tickets = [];

export async function render(container) {
  container.innerHTML = `
    <div class="row between mt-8">
      <button class="btn-primary" id="btn-new-ticket">+ New Ticket</button>
      <select id="filter-status" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
        <option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
      </select>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Subject</th><th>Client</th><th>Status</th><th>Priority</th><th>Updated</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="tickets-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-ticket').addEventListener('click', () => openTicketEditor());
  document.getElementById('filter-status').addEventListener('change', (e) => {
    const v = e.target.value;
    renderTable(v ? tickets.filter((t) => t.status === v) : tickets);
  });

  await loadTickets();
}

async function loadTickets() {
  try {
    const data = await api.get('/api/ops/support');
    tickets = data.requests || [];
    renderTable(tickets);
  } catch (err) {
    console.error('Load tickets failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('tickets-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="7" class="empty-state">No tickets found.</td></tr>';
    return;
  }
  el.innerHTML = items.map((t) => `
    <tr>
      <td style="font-weight:600;font-size:11px">${escapeHtml(t.subject)}</td>
      <td style="font-size:11px">${t.client_id ? 'Client #' + t.client_id.slice(0, 6) : '—'}</td>
      <td><span class="badge badge-${t.status}">${t.status}</span></td>
      <td><span class="badge badge-new">${t.priority}</span></td>
      <td style="font-size:11px;color:var(--faint)">${t.updated_at ? new Date(t.updated_at).toLocaleDateString() : '—'}</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.openTicket('${t.id}')">View</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.openTicket = async (id) => {
  try {
    const data = await api.get(`/api/ops/support/${id}`);
    const t = data.request;
    const messages = data.messages || [];
    document.getElementById('modal-title').textContent = t.subject;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-row">
        <div style="grid-column:span 2"><label>Subject</label><div style="font-weight:600">${escapeHtml(t.subject)}</div></div>
        <div><label>Status</label><div><span class="badge badge-${t.status}">${t.status}</span></div></div>
        <div><label>Priority</label><div>${t.priority}</div></div>
        <div><label>Client</label><div>${t.client_id ? 'Client #' + t.client_id.slice(0, 6) : '—'}</div></div>
      </div>
      <div class="panel mt-16"><h2>Conversation</h2>
        <div style="border:1px solid var(--line2);border-radius:8px;background:#0a0a0a;max-height:400px;overflow-y:auto;padding:12px;margin-bottom:12px">
          ${messages.map((m) => `
            <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line2)">
              <div style="font-size:10px;color:var(--faint);text-transform:uppercase">${m.sender_role} · ${new Date(m.created_at).toLocaleString()}</div>
              <div style="font-size:12px">${escapeHtml(m.body)}</div>
            </div>
          `).join('') || '<div style="color:var(--faint);font-size:11px">No messages yet.</div>'}
        </div>
        <textarea id="ticket-reply" placeholder="Write a reply..." style="width:100%"></textarea>
      </div>
      <div class="row mt-16" style="gap:8px">
        <button class="btn-primary" onclick="SEAI_OPS_PAGES.sendReply('${t.id}')">Send Reply</button>
        <button class="ghost-btn" onclick="closeLeadModal()">Close</button>
      </div>
    `;
    document.getElementById('lead-modal').style.display = 'block';
  } catch (err) {
    alert('Failed to load ticket: ' + err.message);
  }
};

window.SEAI_OPS_PAGES.sendReply = async (id) => {
  const body = document.getElementById('ticket-reply').value;
  if (!body.trim()) return;
  try {
    await api.post(`/api/ops/support/${id}/messages`, { body });
    closeLeadModal();
    window.SEAI_OPS_PAGES.openTicket(id);
  } catch (err) { alert('Failed: ' + err.message); }
};

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

function openTicketEditor() {
  alert('Ticket creation — use the staff console or API.');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadTickets();
}