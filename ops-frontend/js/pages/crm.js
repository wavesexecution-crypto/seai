/* SEAI Business Ops — CRM & Leads (Phase 2 Complete) */
import { api } from '../api.js';

export const title = 'CRM & Leads';
export const subtitle = 'Leads, prospects, follow-ups and sales pipeline';

const STAGE_ORDER = ['new', 'contacted', 'responded', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost'];
const STAGE_LABEL = {
  new: 'New', contacted: 'Contacted', responded: 'Responded', qualified: 'Qualified',
  proposal_sent: 'Proposal Sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost'
};
const LEAD_SOURCES = ['website', 'instagram', 'whatsapp', 'cold_email', 'referral', 'direct_sales', 'paid_ads', 'manual'];
const LEAD_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

let leads = [];
let currentFilter = { q: '', stage: '', source: '', priority: '', follow_up_due: false };

export async function render(container) {
  container.innerHTML = `
    <div class="row between mt-8">
      <div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <input type="text" id="lead-search" placeholder="Search business, contact, email, phone..." style="width:320px;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
          <select id="filter-stage" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
            <option value="">All stages</option>
            ${STAGE_ORDER.map(s => `<option value="${s}">${STAGE_LABEL[s]}</option>`).join('')}
          </select>
          <select id="filter-source" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
            <option value="">All sources</option>
            ${LEAD_SOURCES.map(s => `<option value="${s}">${s.replace('_', ' ').toUpperCase()}</option>`).join('')}
          </select>
          <select id="filter-priority" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
            <option value="">All priorities</option>
            ${LEAD_PRIORITIES.map(p => `<option value="${p}">${p.toUpperCase()}</option>`).join('')}
          </select>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:0">
            <input type="checkbox" id="filter-followup" style="width:16px;height:16px;" />
            Follow-ups due
          </label>
          <button class="btn-primary" id="btn-new-lead">+ New Lead</button>
        </div>
      </div>
    </div>

    <div class="row between mt-16">
      <div class="panel" style="flex:1;min-width:400px">
        <h2>Pipeline by Stage</h2>
        <div id="pipeline-chips" class="mt-8"></div>
      </div>
      <div class="panel" style="flex:1;min-width:300px">
        <h2>New Leads This Week</h2>
        <div id="new-leads-chart" class="mt-8"></div>
      </div>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th style="width:60px">Ref</th>
              <th>Business</th>
              <th>Contact</th>
              <th style="width:110px">Stage</th>
              <th style="width:100px">Source</th>
              <th style="width:80px">Priority</th>
              <th style="width:110px">Est. Value</th>
              <th style="width:120px">Follow-up</th>
              <th style="width:100px">Actions</th>
            </tr>
          </thead>
          <tbody id="leads-table-body"></tbody>
        </table>
      </div>
    </div>

    <!-- Lead detail modal -->
    <div id="lead-modal" class="modal" style="display:none">
      <div class="modal-backdrop" onclick="closeLeadModal()"></div>
      <div class="modal-content" style="max-width:640px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="modal-title">Lead Detail</h3>
          <button class="ghost-btn" onclick="closeLeadModal()">Close</button>
        </div>
        <div id="modal-body" style="padding:16px 0"></div>
      </div>
    </div>

    <!-- Lead create/edit modal -->
    <div id="lead-editor-modal" class="modal" style="display:none">
      <div class="modal-backdrop" onclick="closeLeadEditor()"></div>
      <div class="modal-content" style="max-width:560px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 id="editor-title">New Lead</h3>
          <button class="ghost-btn" onclick="closeLeadEditor()">Close</button>
        </div>
        <form id="lead-editor-form" style="padding:16px 0;display:grid;gap:14px">
          <input type="hidden" id="editor-lead-id" />
          <div class="form-row">
            <div>
              <label>Business Name <span style="color:#ff6b6b">*</span></label>
              <input type="text" id="e-business-name" required placeholder="e.g. Acme Fitness" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
            <div>
              <label>Contact Person</label>
              <input type="text" id="e-contact-person" placeholder="Owner name" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Email</label>
              <input type="email" id="e-email" placeholder="contact@acme.com" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
            <div>
              <label>Phone</label>
              <input type="tel" id="e-phone" placeholder="+91 98765 43210" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Industry</label>
              <input type="text" id="e-industry" placeholder="Fitness, Retail, etc." style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
            <div>
              <label>Location</label>
              <input type="text" id="e-location" placeholder="City, State" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Website</label>
              <input type="url" id="e-website" placeholder="https://acme.com" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
            <div>
              <label>Source</label>
              <select id="e-source" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
                ${LEAD_SOURCES.map(s => `<option value="${s}">${s.replace('_', ' ').toUpperCase()}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Priority</label>
              <select id="e-priority" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
                ${LEAD_PRIORITIES.map(p => `<option value="${p}">${p.toUpperCase()}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Stage</label>
              <select id="e-stage" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
                ${STAGE_ORDER.map(s => `<option value="${s}">${STAGE_LABEL[s]}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div style="grid-column:span 2">
              <label>Estimated Deal Value (₹)</label>
              <input type="number" id="e-budget" min="0" placeholder="0" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
          </div>
          <div class="form-row">
            <div style="grid-column:span 2">
              <label>Next Follow-up Date</label>
              <input type="date" id="e-follow-up" style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff" />
            </div>
          </div>
          <div class="form-row">
            <div style="grid-column:span 2">
              <label>Notes</label>
              <textarea id="e-notes" rows="3" placeholder="Initial notes about this lead..." style="width:100%;padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff"></textarea>
            </div>
          </div>
          <div id="editor-dup-warning" style="display:none;padding:10px;background:#2a1a1a;border:1px solid #5a2a2a;border-radius:8px;color:#ff6b6b;font-size:12px">
            ⚠️ Possible duplicate lead detected. Review before saving.
          </div>
          <div class="row mt-8" style="gap:8px;justify-content:flex-end">
            <button type="button" class="ghost-btn" onclick="closeLeadEditor()">Cancel</button>
            <button type="submit" class="btn-primary">Save Lead</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Wire up filters
  document.getElementById('lead-search').addEventListener('input', (e) => { currentFilter.q = e.target.value; loadLeads(); });
  document.getElementById('filter-stage').addEventListener('change', (e) => { currentFilter.stage = e.target.value; loadLeads(); });
  document.getElementById('filter-source').addEventListener('change', (e) => { currentFilter.source = e.target.value; loadLeads(); });
  document.getElementById('filter-priority').addEventListener('change', (e) => { currentFilter.priority = e.target.value; loadLeads(); });
  document.getElementById('filter-followup').addEventListener('change', (e) => { currentFilter.follow_up_due = e.target.checked; loadLeads(); });

  // New lead
  document.getElementById('btn-new-lead').addEventListener('click', () => openLeadEditor());

  // Lead editor form submit
  const form = document.getElementById('lead-editor-form');
  const dupWarning = document.getElementById('editor-dup-warning');
  let debounceTimer = null;
  const checkFields = ['e-business-name', 'e-email', 'e-phone'];
  checkFields.forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkDuplicate, 600);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editor-lead-id').value;
    const payload = {
      business_name: document.getElementById('e-business-name').value.trim(),
      contact_person: document.getElementById('e-contact-person').value.trim() || null,
      email: document.getElementById('e-email').value.trim() || null,
      phone: document.getElementById('e-phone').value.trim() || null,
      industry: document.getElementById('e-industry').value.trim() || null,
      location: document.getElementById('e-location').value.trim() || null,
      website: document.getElementById('e-website').value.trim() || null,
      source: document.getElementById('e-source').value,
      priority: document.getElementById('e-priority').value,
      stage: document.getElementById('e-stage').value,
      estimated_budget_inr: document.getElementById('e-budget').value ? Number(document.getElementById('e-budget').value) : null,
      next_follow_up_at: document.getElementById('e-follow-up').value || null,
      notes: document.getElementById('e-notes').value.trim() || null,
    };
    if (!payload.business_name) { alert('Business name is required'); return; }

    try {
      if (id) {
        await api.patch(`/staff/leads/${id}`, payload);
      } else {
        await api.post('/staff/leads', payload);
      }
      closeLeadEditor();
      loadLeads();
    } catch (err) {
      alert('Failed to save lead: ' + err.message);
    }
  });

  await loadLeads();
}

async function loadLeads() {
  try {
    const params = new URLSearchParams();
    if (currentFilter.q) params.set('q', currentFilter.q);
    if (currentFilter.stage) params.set('stage', currentFilter.stage);
    if (currentFilter.source) params.set('source', currentFilter.source);
    if (currentFilter.priority) params.set('priority', currentFilter.priority);
    if (currentFilter.follow_up_due) params.set('follow_up_due', '1');
    params.set('limit', '500');

    const data = await api.get(`/staff/leads?${params}`);
    leads = data.leads || [];
    renderTable(leads);
    renderPipelineChips(leads);
  } catch (err) {
    console.error('Load leads failed:', err);
  }
}

function renderPipelineChips(items) {
  const el = document.getElementById('pipeline-chips');
  if (!el) return;
  const counts = {};
  STAGE_ORDER.forEach(s => counts[s] = 0);
  for (const l of items) counts[String(l.stage)] = (counts[String(l.stage)] ?? 0) + 1;
  el.innerHTML = STAGE_ORDER.map(s => {
    const c = counts[s] ?? 0;
    return `<span class="badge badge-${s}" style="padding:6px 12px;font-size:11px">${STAGE_LABEL[s]}: <b>${c}</b></span>`;
  }).join('');
}

function renderTable(items) {
  const el = document.getElementById('leads-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="9" class="empty-state">No leads found.</td></tr>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = items.map((l) => {
    const overdue = l.next_follow_up_at && String(l.next_follow_up_at).slice(0, 10) < today && !['won', 'lost'].includes(String(l.stage));
    return `
    <tr>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(l.lead_ref || l.id.slice(0, 6))}</td>
      <td style="font-weight:600">${escapeHtml(l.business_name)}</td>
      <td>${escapeHtml(l.contact_person || '—')}</td>
      <td><span class="badge badge-${l.stage}">${STAGE_LABEL[l.stage] || l.stage}</span></td>
      <td style="font-size:11px"><span class="badge badge-new">${escapeHtml(l.source || 'manual')}</span></td>
      <td style="font-size:11px"><span class="badge badge-new">${escapeHtml(l.priority || 'normal')}</span></td>
      <td>${l.estimated_budget_inr != null ? '₹' + Number(l.estimated_budget_inr).toLocaleString() : '—'}</td>
      <td style="font-size:11px;color:${overdue ? '#ff6b6b' : 'var(--faint)'}">${l.next_follow_up_at ? new Date(l.next_follow_up_at).toLocaleDateString() : '—'}${overdue ? ' (OVERDUE)' : ''}</td>
      <td style="text-align:right">
        <button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.openLead('${l.id}')">View</button>
        <button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.editLead('${l.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}