/* SEAI Business Ops — Sales Pipeline page */
import { api } from '../api.js';

export const title = 'Sales Pipeline';
export const subtitle = 'Visual pipeline: NEW → CONTACTED → QUALIFIED → PROPOSAL → NEGOTIATION → WON / LOST';

const STAGE_ORDER = ['new', 'contacted', 'responded', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost'];
const STAGE_LABEL = {
  new: 'New', contacted: 'Contacted', responded: 'Responded', qualified: 'Qualified',
  proposal_sent: 'Proposal Sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost'
};

let leads = [];

export async function render(container) {
  container.innerHTML = `
    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;" id="pipeline-columns"></div>
    <div class="mt-16 panel">
      <h2>All Leads</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Ref</th><th>Business</th><th>Contact</th><th>Stage</th><th>Source</th><th>Est. Value</th><th>Next Follow-up</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="pipeline-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  await loadLeads();
}

async function loadLeads() {
  try {
    const data = await api.get('/leads?limit=500');
    leads = data.leads || [];
    renderPipeline();
    renderTable(leads);
  } catch (err) {
    console.error('Load pipeline failed:', err);
  }
}

function renderPipeline() {
  const el = document.getElementById('pipeline-columns');
  if (!el) return;
  el.innerHTML = STAGE_ORDER.map(stage => {
    const stageLeads = leads.filter((l) => l.stage === stage);
    const totalValue = stageLeads.reduce((s, l) => s + Number(l.estimated_budget_inr || 0), 0);
    return `
      <div class="card" style="height:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:11px">${STAGE_LABEL[stage]}</div>
          <div style="font-size:11px;color:var(--faint)">₹${totalValue.toLocaleString()}</div>
        </div>
        <div style="min-height:200px;display:flex;flex-direction:column;gap:6px">
          ${stageLeads.map((l) => `
            <div style="background:#0e0e10;border:1px solid var(--line2);border-radius:7px;padding:8px 10px;font-size:12px;cursor:pointer" onclick="SEAI_OPS_PAGES.openLead('${l.id}')">
              <div style="font-weight:600">${escapeHtml(l.business_name)}</div>
              <div style="font-size:11px;color:var(--faint)">${escapeHtml(l.contact_person || '')} · ${escapeHtml(l.source || 'manual')}</div>
              ${l.estimated_budget_inr != null ? `<div style="font-size:11px;color:var(--sub)">₹${Number(l.estimated_budget_inr).toLocaleString()}</div>` : ''}
            </div>
          `).join('') || '<div style="font-size:11px;color:var(--faint);padding:8px">No leads</div>'}
        </div>
      </div>
    `;
  }).join('');
}

function renderTable(items) {
  const el = document.getElementById('pipeline-table-body');
  if (!el) return;
  el.innerHTML = items.map((l) => `
    <tr>
      <td style="font-family:var(--mono)">${escapeHtml(l.lead_ref || l.id.slice(0, 6))}</td>
      <td style="font-weight:600">${escapeHtml(l.business_name)}</td>
      <td>${escapeHtml(l.contact_person || '—')}</td>
      <td><span class="badge badge-${l.stage}">${l.stage}</span></td>
      <td><span class="badge badge-new">${escapeHtml(l.source || 'manual')}</span></td>
      <td>${l.estimated_budget_inr != null ? '₹' + Number(l.estimated_budget_inr).toLocaleString() : '—'}</td>
      <td style="font-size:11px;color:var(--faint)">${l.next_follow_up_at ? new Date(l.next_follow_up_at).toLocaleDateString() : '—'}</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.openLead('${l.id}')">View</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};
window.SEAI_OPS_PAGES.openLead = (id) => {
  const lead = leads.find((l) => l.id === id);
  if (!lead) return;
  document.getElementById('modal-title').textContent = lead.business_name;
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div><label>Business</label><div style="font-weight:600">${escapeHtml(lead.business_name)}</div></div>
      <div><label>Contact</label><div>${escapeHtml(lead.contact_person || '—')}</div></div>
      <div><label>Email</label><div>${escapeHtml(lead.email || '—')}</div></div>
      <div><label>Phone</label><div>${escapeHtml(lead.phone || '—')}</div></div>
      <div><label>Industry</label><div>${escapeHtml(lead.industry || '—')}</div></div>
      <div><label>Location</label><div>${escapeHtml(lead.location || '—')}</div></div>
      <div><label>Website</label><div>${escapeHtml(lead.website || '—')}</div></div>
      <div><label>Source</label><div>${escapeHtml(lead.source || '—')}</div></div>
    </div>
    <div class="form-row mt-16">
      <div><label>Est. Budget</label><div>${lead.estimated_budget_inr != null ? '₹' + Number(lead.estimated_budget_inr).toLocaleString() : '—'}</div></div>
      <div><label>Est. MRR</label><div>${lead.estimated_mrr_inr != null ? '₹' + Number(lead.estimated_mrr_inr).toLocaleString() : '—'}</div></div>
      <div><label>Priority</label><div>${escapeHtml(lead.priority || '—')}</div></div>
      <div><label>Stage</label><div><span class="badge badge-${lead.stage}">${lead.stage}</span></div></div>
    </div>
    <div class="mt-16">
      <label style="display:block;margin-bottom:6px">Update Stage</label>
      <select id="lead-stage-select" style="width:100%"></select>
    </div>
    <div class="mt-16">
      <label style="display:block;margin-bottom:6px">Notes / Activity</label>
      <textarea id="lead-note-text" placeholder="Add a note or log a call..."></textarea>
    </div>
    <div class="row mt-16" style="gap:8px">
      <button class="btn-primary" onclick="SEAI_OPS_PAGES.saveLeadUpdate('${lead.id}')">Save Changes</button>
      <button class="ghost-btn" onclick="closeLeadModal()">Cancel</button>
    </div>
  `;
  const sel = document.getElementById('lead-stage-select');
  STAGE_ORDER.forEach((s) => {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = STAGE_LABEL[s];
    if (s === lead.stage) o.selected = true;
    sel.appendChild(o);
  });
  document.getElementById('lead-modal').style.display = 'block';
};

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

window.SEAI_OPS_PAGES.saveLeadUpdate = async (id) => {
  const sel = document.getElementById('lead-stage-select');
  const note = document.getElementById('lead-note-text');
  const patch = { stage: sel.value };
  if (note.value.trim()) {
    try { await api.post(`/leads/${id}/activity`, { type: 'note', body: note.value.trim() }); } catch (e) { console.error('Activity failed:', e); }
  }
  try {
    await api.patch(`/leads/${id}`, patch);
    closeLeadModal();
    loadLeads();
  } catch (err) { alert('Failed to save: ' + err.message); }
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadLeads();
}
