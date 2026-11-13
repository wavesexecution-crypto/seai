/* SEAI Business Ops — Clients page */
import { api } from '../api.js';

export const title = 'Clients';
export const subtitle = 'Client accounts, agreements, and onboarding';

let clients = [];

export async function render(container) {
  container.innerHTML = `
    <div class="row between mt-8">
      <input type="text" id="client-search" placeholder="Search client, contact, email..." style="width:300px;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
      <button class="btn-primary" id="btn-new-client">+ New Client</button>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Brand</th><th>Legal Name</th><th>Contact</th><th>Email</th><th>Status</th><th>Account Manager</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="clients-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('client-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderTable(clients.filter((c) => c.brand_name.toLowerCase().includes(q) || c.legal_name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)));
  });
  document.getElementById('btn-new-client').addEventListener('click', openClientEditor);

  await loadClients();
  return container;
}

async function loadClients() {
  try {
    const data = await api.get('/clients');
    clients = data.clients || [];
    renderTable(clients);
  } catch (err) {
    console.error('Load clients failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('clients-table-body');
  if (!el) return;
  el.innerHTML = items.map((c) => `
    <tr>
      <td style="font-weight:600">${escapeHtml(c.brand_name)}</td>
      <td>${escapeHtml(c.legal_name || '—')}</td>
      <td>${escapeHtml(c.primary_contact || '—')}</td>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(c.email || '—')}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td style="font-size:11px;color:var(--faint)">${escapeHtml(c.account_manager_id || '—')}</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.openClient('${c.id}')">View</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};
window.SEAI_OPS_PAGES.openClient = async (id) => {
  const data = await api.get(`/clients/${id}`);
  const c = data.client;
  const agreements = data.agreements || [];
  const projects = data.projects || [];
  document.getElementById('modal-title').textContent = c.brand_name;
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div style="grid-column:span 2"><label>Legal Name</label><div style="font-weight:600">${escapeHtml(c.legal_name || '—')}</div></div>
      <div><label>Industry</label><div>${escapeHtml(c.industry || '—')}</div></div>
      <div><label>Primary Contact</label><div>${escapeHtml(c.primary_contact || '—')}</div></div>
      <div><label>Email</label><div>${escapeHtml(c.email || '—')}</div></div>
      <div><label>Phone</label><div>${escapeHtml(c.phone || '—')}</div></div>
      <div><label>Website</label><div>${escapeHtml(c.website || '—')}</div></div>
      <div><label>Status</label><div><span class="badge badge-${c.status}">${c.status}</span></div></div>
      <div><label>Account Manager</label><div>${escapeHtml(c.account_manager_id || '—')}</div></div>
    </div>
    <div class="panel mt-16"><h2>Agreements (${agreements.length})</h2>
      <table style="margin-top:8px"><thead><tr><th>Plan</th><th>Monthly Fee</th><th>Status</th><th>Renewal</th></tr></thead>
      <tbody>
        ${agreements.map((a) => `<tr><td style="font-size:11px">${escapeHtml(a.plan)}</td><td style="font-size:11px">₹${a.monthly_fee_inr}</td><td style="font-size:11px">${a.status}</td><td style="font-size:11px">${a.renewal_date || '—'}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="panel mt-16"><h2>Projects (${projects.length})</h2>
      <table style="margin-top:8px"><thead><tr><th>Name</th><th>Category</th><th>Status</th></tr></thead>
      <tbody>
        ${projects.map((p) => `<tr><td style="font-size:11px">${escapeHtml(p.name)}</td><td style="font-size:11px">${escapeHtml(p.service_category)}</td><td style="font-size:11px">${p.status}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="row mt-16" style="gap:8px"><button class="ghost-btn" onclick="closeLeadModal()">Close</button></div>
  `;
  document.getElementById('lead-modal').style.display = 'block';
};

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

function openClientEditor() {
  alert('Client creation — use the staff console or API.');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadClients();
}
