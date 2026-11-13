/* SEAI Business Ops — Proposals page */
import { api } from '../api.js';

export const title = 'Proposals';
export const subtitle = 'Create, send, and track client proposals';

let proposals = [];

export async function render(container) {
  container.innerHTML = `
    <div class="row between mt-8">
      <button class="btn-primary" id="btn-new-proposal">+ New Proposal</button>
      <select id="filter-status" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
        <option value="">All statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="viewed">Viewed</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="expired">Expired</option>
      </select>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Ref</th><th>Title</th><th>Client / Lead</th><th>Status</th><th>Total</th><th>Sent</th><th>Decision</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="proposals-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-proposal').addEventListener('click', openProposalEditor);
  document.getElementById('filter-status').addEventListener('change', (e) => {
    const v = e.target.value;
    renderTable(v ? proposals.filter((p) => p.status === v) : proposals);
  });

  await loadProposals();
}

async function loadProposals() {
  try {
    const data = await api.get('/proposals');
    proposals = data.proposals || [];
    renderTable(proposals);
  } catch (err) {
    console.error('Load proposals failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('proposals-table-body');
  if (!el) return;
  el.innerHTML = items.map((p) => `
    <tr>
      <td style="font-family:var(--mono)">${escapeHtml(p.proposal_ref || p.id.slice(0, 6))}</td>
      <td style="font-weight:600">${escapeHtml(p.title)}</td>
      <td style="font-size:11px;color:var(--faint)">${p.client_id ? 'Client' : p.lead_id ? 'Lead' : '—'}</td>
      <td><span class="badge badge-${p.status}">${p.status}</span></td>
      <td>${p.total_inr != null ? '₹' + Number(p.total_inr).toLocaleString() : '—'}</td>
      <td style="font-size:11px;color:var(--faint)">${p.sent_at ? new Date(p.sent_at).toLocaleDateString() : '—'}</td>
      <td style="font-size:11px;color:var(--faint)">${p.decided_at ? new Date(p.decided_at).toLocaleDateString() : '—'}</td>
      <td style="text-align:right">
        <button class="ghost-btn" onclick="SEAI_OPS_PAGES.openProposal('${p.id}')">View</button>
      </td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};
window.SEAI_OPS_PAGES.openProposal = async (id) => {
  const data = await api.get(`/proposals/${id}`);
  const p = data.proposal;
  const items = data.line_items || [];
  document.getElementById('modal-title').textContent = p.proposal_ref;
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div><label>Title</label><div style="font-weight:600">${escapeHtml(p.title)}</div></div>
      <div><label>Status</label><div><span class="badge badge-${p.status}">${p.status}</span></div></div>
      <div><label>Total</label><div style="font-weight:600">${p.total_inr != null ? '₹' + Number(p.total_inr).toLocaleString() : '—'}</div></div>
      <div><label>Payment Terms</label><div>${escapeHtml(p.payment_terms)}</div></div>
    </div>
    <div class="panel mt-16">
      <h2>Line Items</h2>
      <table style="margin-top:8px">
        <thead><tr><th>Service</th><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map((li) => `
            <tr><td style="font-size:11px">${escapeHtml(li.service_label)}</td><td style="font-size:11px">${escapeHtml(li.description)}</td><td style="font-size:11px">${li.qty}</td><td style="font-size:11px">₹${li.unit_price_inr}</td><td style="font-size:11px">₹${li.line_total_inr}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="row mt-16" style="gap:8px">
      ${p.status === 'draft' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.sendProposal('${p.id}')">Send Proposal</button>` : ''}
      ${p.status === 'sent' || p.status === 'viewed' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.decideProposal('${p.id}','accepted')">Mark Accepted</button><button class="ghost-btn" onclick="SEAI_OPS_PAGES.decideProposal('${p.id}','rejected')">Mark Rejected</button>` : ''}
      <button class="ghost-btn" onclick="closeLeadModal()">Close</button>
    </div>
  `;
  document.getElementById('lead-modal').style.display = 'block';
};

window.SEAI_OPS_PAGES.sendProposal = async (id) => {
  try {
    await api.post(`/proposals/${id}/send`);
    closeLeadModal();
    loadProposals();
  } catch (err) { alert('Failed: ' + err.message); }
};

window.SEAI_OPS_PAGES.decideProposal = async (id, decision) => {
  try {
    await api.post(`/proposals/${id}/decide`, { decision });
    closeLeadModal();
    loadProposals();
  } catch (err) { alert('Failed: ' + err.message); }
};

function openProposalEditor() {
  const modal = document.getElementById('lead-modal');
  document.getElementById('modal-title').textContent = 'New Proposal';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div style="grid-column:span 2"><label>Title</label><input type="text" id="prop-title" placeholder="Proposal title" style="width:100%"></div>
      <div style="grid-column:span 2"><label>Description</label><textarea id="prop-desc" placeholder="Proposal description" style="width:100%"></textarea></div>
      <div><label>Lead ID (optional)</label><input type="text" id="prop-lead" style="width:100%"></div>
      <div><label>Client ID (optional)</label><input type="text" id="prop-client" style="width:100%"></div>
      <div><label>Payment Terms</label><input type="text" id="prop-terms" value="Due within 7 days" style="width:100%"></div>
    </div>
    <div class="panel mt-16">
      <h2>Line Items</h2>
      <div id="prop-lines" style="display:grid;gap:8px">
        <div class="row" style="gap:8px">
          <input type="text" placeholder="Service" id="line-service" style="flex:1">
          <input type="text" placeholder="Description" id="line-desc" style="flex:1">
          <input type="number" placeholder="Qty" id="line-qty" style="width:80px" value="1">
          <input type="number" placeholder="Unit ₹" id="line-price" style="width:100px">
          <button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.addLine()">+</button>
        </div>
      </div>
    </div>
    <div class="row mt-16" style="gap:8px">
      <button class="btn-primary" onclick="SEAI_OPS_PAGES.saveProposal()">Create Proposal</button>
      <button class="ghost-btn" onclick="closeLeadModal()">Cancel</button>
    </div>
  `;
  document.getElementById('lead-modal').style.display = 'block';
  window.SEAI_OPS_PAGES.lines = [];
}

window.SEAI_OPS_PAGES.addLine = () => {
  const lines = window.SEAI_OPS_PAGES.lines || [];
  lines.push({
    service_key: document.getElementById('line-service').value,
    service_label: document.getElementById('line-service').value,
    description: document.getElementById('line-desc').value,
    qty: Number(document.getElementById('line-qty').value) || 1,
    unit_price_inr: Number(document.getElementById('line-price').value) || 0,
  });
  renderLines();
};

function renderLines() {
  const el = document.getElementById('prop-lines');
  const lines = window.SEAI_OPS_PAGES.lines || [];
  el.innerHTML = lines.map((l, i) => `
    <div class="row" style="gap:8px">
      <input type="text" value="${l.service_label}" disabled style="flex:1">
      <input type="text" value="${l.description}" disabled style="flex:1">
      <input type="number" value="${l.qty}" disabled style="width:80px">
      <input type="number" value="${l.unit_price_inr}" disabled style="width:100px">
      <span style="margin-left:auto">₹${l.qty * l.unit_price_inr}</span>
      <button class="ghost-btn" style="width:auto" onclick="SEAI_OPS_PAGES.removeLine(${i})">×</button>
    </div>
  `).join('');
}

window.SEAI_OPS_PAGES.removeLine = (i) => {
  const lines = window.SEAI_OPS_PAGES.lines || [];
  lines.splice(i, 1);
  renderLines();
};

window.SEAI_OPS_PAGES.saveProposal = async () => {
  const lines = window.SEAI_OPS_PAGES.lines || [];
  if (!lines.length) { alert('Add at least one line item'); return; }
  try {
    await api.post('/proposals', {
      title: document.getElementById('prop-title').value,
      description: document.getElementById('prop-desc').value,
      lead_id: document.getElementById('prop-lead').value || null,
      client_id: document.getElementById('prop-client').value || null,
      payment_terms: document.getElementById('prop-terms').value,
      line_items: lines,
    });
    closeLeadModal();
    loadProposals();
  } catch (err) { alert('Failed: ' + err.message); }
};

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadProposals();
}
