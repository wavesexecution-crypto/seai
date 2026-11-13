/* SEAI Business Ops — Marketing page */
import { api } from '../api.js';

export const title = 'Marketing';
export const subtitle = 'Campaigns, advertising, and spend tracking';

let campaigns = [];

export async function render(container) {
  container.innerHTML = `
    <div class="grid cards" id="marketing-cards">
      <div class="card"><div class="k">Active Campaigns</div><div class="v" id="m-active">—</div></div>
      <div class="card"><div class="k">Pending Approval</div><div class="v" id="m-pending">—</div></div>
      <div class="card"><div class="k">Total Budget</div><div class="v" id="m-budget">—</div></div>
      <div class="card"><div class="k">Spent</div><div class="v" id="m-spent">—</div></div>
    </div>

    <div class="row between mt-16">
      <button class="btn-primary" id="btn-new-campaign">+ New Campaign</button>
      <select id="filter-status" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
        <option value="">All statuses</option><option value="draft">Draft</option><option value="pending_approval">Pending Approval</option><option value="approved">Approved</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
      </select>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Campaign</th><th>Platform</th><th>Objective</th><th>Status</th><th>Budget</th><th>Spent</th><th>Approved</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="campaigns-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-campaign').addEventListener('click', openCampaignEditor);
  document.getElementById('filter-status').addEventListener('change', (e) => {
    const v = e.target.value;
    renderTable(v ? campaigns.filter((c) => c.status === v) : campaigns);
  });

  await loadCampaigns();
}

async function loadCampaigns() {
  try {
    const data = await api.get('/api/ops/marketing/campaigns');
    campaigns = data.campaigns || [];
    document.getElementById('m-active').textContent = campaigns.filter((c) => c.status === 'active').length;
    document.getElementById('m-pending').textContent = campaigns.filter((c) => c.status === 'pending_approval').length;
    document.getElementById('m-budget').textContent = '₹' + campaigns.reduce((s, c) => s + Number(c.budget_total_inr || 0), 0).toLocaleString();
    document.getElementById('m-spent').textContent = '₹' + campaigns.reduce((s, c) => s + Number(c.budget_spent_inr || 0), 0).toLocaleString();
    renderTable(campaigns);
  } catch (err) {
    console.error('Load campaigns failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('campaigns-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="8" class="empty-state">No campaigns found.</td></tr>';
    return;
  }
  el.innerHTML = items.map((c) => `
    <tr>
      <td style="font-weight:600;font-size:11px">${escapeHtml(c.name)}</td>
      <td style="font-size:11px">${escapeHtml(c.platform)}</td>
      <td style="font-size:11px">${escapeHtml(c.objective)}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td style="font-size:11px">₹${c.budget_total_inr != null ? Number(c.budget_total_inr).toLocaleString() : '0'}</td>
      <td style="font-size:11px">₹${c.budget_spent_inr != null ? Number(c.budget_spent_inr).toLocaleString() : '0'}</td>
      <td style="font-size:11px">${c.approved_at ? new Date(c.approved_at).toLocaleDateString() : '—'}</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.openCampaign('${c.id}')">View</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.openCampaign = async (id) => {
  try {
    const data = await api.get(`/api/ops/marketing/campaigns/${id}`);
    const c = data.campaign;
    const creatives = data.creatives || [];
    document.getElementById('modal-title').textContent = c.name;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-row">
        <div style="grid-column:span 2"><label>Objective</label><div style="font-weight:600">${escapeHtml(c.objective)}</div></div>
        <div><label>Platform</label><div>${escapeHtml(c.platform)}</div></div>
        <div><label>Status</label><div><span class="badge badge-${c.status}">${c.status}</span></div></div>
        <div><label>Budget</label><div>₹${c.budget_total_inr}</div></div>
        <div><label>Spent</label><div>₹${c.budget_spent_inr}</div></div>
        <div><label>Approved</label><div>${c.approved_at ? new Date(c.approved_at).toLocaleDateString() : '—'}</div></div>
      </div>
      <div class="panel mt-16"><h2>Creatives (${creatives.length})</h2>
        <table style="margin-top:8px"><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Spend</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${creatives.map((cr) => `
            <tr>
              <td style="font-size:11px">${escapeHtml(cr.name)}</td>
              <td style="font-size:11px">${escapeHtml(cr.type)}</td>
              <td style="font-size:11px">${cr.status}</td>
              <td style="font-size:11px">₹${cr.spend_inr}</td>
              <td style="text-align:right"><button class="ghost-btn" style="width:auto">${cr.status}</button></td>
            </tr>
          `).join('')}
        </tbody></table>
      </div>
      <div class="row mt-16" style="gap:8px">
        ${c.status === 'pending_approval' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.approveCampaign('${c.id}')">Approve Campaign</button>` : ''}
        ${c.status === 'approved' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.launchCampaign('${c.id}')">Launch Campaign</button>` : ''}
        <button class="ghost-btn" onclick="closeLeadModal()">Close</button>
      </div>
    `;
    document.getElementById('lead-modal').style.display = 'block';
  } catch (err) {
    alert('Failed to load campaign: ' + err.message);
  }
};

window.SEAI_OPS_PAGES.approveCampaign = async (id) => {
  try {
    await api.post(`/api/ops/marketing/campaigns/${id}/approve`);
    closeLeadModal();
    loadCampaigns();
  } catch (err) { alert('Failed: ' + err.message); }
};

window.SEAI_OPS_PAGES.launchCampaign = async (id) => {
  try {
    await api.post(`/api/ops/marketing/campaigns/${id}/launch`);
    closeLeadModal();
    loadCampaigns();
  } catch (err) { alert('Failed: ' + err.message); }
};

function openCampaignEditor() {
  alert('Campaign creation — use the staff console or API.');
}

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadCampaigns();
}