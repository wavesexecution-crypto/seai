/* SEAI Business Ops — Finance page */
import { api } from '../api.js';

export const title = 'Finance';
export const subtitle = 'Invoices, revenue, expenses and profitability';

let invoices = [];

export async function render(container) {
  container.innerHTML = `
    <div class="grid cards" id="finance-cards">
      <div class="card"><div class="k">Total Revenue</div><div class="v" id="f-revenue">—</div></div>
      <div class="card"><div class="k">Outstanding</div><div class="v" id="f-outstanding">—</div></div>
      <div class="card"><div class="k">Paid Invoices</div><div class="v" id="f-paid">—</div></div>
      <div class="card"><div class="k">Sent/Overdue</div><div class="v" id="f-sent">—</div></div>
    </div>

    <div class="row between mt-16">
      <button class="btn-primary" id="btn-new-invoice">+ New Invoice</button>
      <select id="filter-status" style="padding:8px 10px;border:1px solid var(--line2);border-radius:8px;background:#0e0e10;color:#fff">
        <option value="">All statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option>
      </select>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Number</th><th>Client</th><th>Kind</th><th>Status</th><th>Total</th><th>Issued</th><th>Due</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="invoices-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-invoice').addEventListener('click', openInvoiceEditor);
  document.getElementById('filter-status').addEventListener('change', (e) => {
    const v = e.target.value;
    renderTable(v ? invoices.filter((i) => i.status === v) : invoices);
  });

  await loadData();
}

async function loadData() {
  try {
    const [invData, snapData] = await Promise.all([
      api.get('/api/ops/finance/invoices?limit=1000'),
      api.get('/api/ops/finance/snapshot')
    ]);
    invoices = invData.invoices || [];
    const s = snapData || {};
    document.getElementById('f-revenue').textContent = '₹' + (s.servicePaid ?? 0).toLocaleString();
    document.getElementById('f-outstanding').textContent = '₹' + (s.outstandingService ?? 0).toLocaleString();
    document.getElementById('f-paid').textContent = invoices.filter((i) => i.status === 'paid').length;
    document.getElementById('f-sent').textContent = invoices.filter((i) => ['sent', 'overdue'].includes(i.status)).length;
    renderTable(invoices);
  } catch (err) {
    console.error('Load finance failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('invoices-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="8" class="empty-state">No invoices found.</td></tr>';
    return;
  }
  el.innerHTML = items.map((i) => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px;font-weight:600">${escapeHtml(i.number)}</td>
      <td style="font-size:11px">${i.client_id ? 'Client #' + i.client_id.slice(0, 6) : '—'}</td>
      <td style="font-size:11px">${escapeHtml(i.kind)}</td>
      <td><span class="badge badge-${i.status}">${i.status}</span></td>
      <td>₹${i.total_inr != null ? Number(i.total_inr).toLocaleString() : '0'}</td>
      <td style="font-size:11px">${i.issued_at ? new Date(i.issued_at).toLocaleDateString() : '—'}</td>
      <td style="font-size:11px">${i.due_at ? new Date(i.due_at).toLocaleDateString() : '—'}</td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.openInvoice('${i.id}')">View</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};

window.SEAI_OPS_PAGES.openInvoice = async (id) => {
  try {
    const data = await api.get(`/api/ops/finance/invoices/${id}`);
    const inv = data.invoice;
    document.getElementById('modal-title').textContent = inv.number;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-row">
        <div style="grid-column:span 2"><label>Description</label><div style="font-weight:600">${escapeHtml(inv.description)}</div></div>
        <div><label>Status</label><div><span class="badge badge-${inv.status}">${inv.status}</span></div></div>
        <div><label>Total</label><div style="font-weight:600">₹${inv.total_inr}</div></div>
        <div><label>Issued</label><div>${inv.issued_at}</div></div>
        <div><label>Due</label><div>${inv.due_at}</div></div>
      </div>
      <div class="panel mt-16"><h2>Line Items</h2>
        <table style="margin-top:8px"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
        <tbody>
          ${(inv.line_items || []).map((li) => `<tr><td style="font-size:11px">${escapeHtml(li.label)}</td><td style="font-size:11px">${li.qty}</td><td style="font-size:11px">₹${li.unit_inr}</td><td style="font-size:11px">₹${li.qty * li.unit_inr}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="row mt-16" style="gap:8px">
        ${inv.status === 'draft' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.markSent('${inv.id}')">Mark Sent</button>` : ''}
        ${inv.status === 'sent' || inv.status === 'overdue' ? `<button class="btn-primary" onclick="SEAI_OPS_PAGES.markPaid('${inv.id}')">Mark Paid</button>` : ''}
        <button class="ghost-btn" onclick="closeLeadModal()">Close</button>
      </div>
    `;
    document.getElementById('lead-modal').style.display = 'block';
  } catch (err) {
    alert('Failed to load invoice: ' + err.message);
  }
};

window.SEAI_OPS_PAGES.markSent = async (id) => {
  try {
    await api.patch(`/api/ops/finance/invoices/${id}`, { status: 'sent' });
    closeLeadModal();
    loadData();
  } catch (err) { alert('Failed: ' + err.message); }
};

window.SEAI_OPS_PAGES.markPaid = async (id) => {
  try {
    await api.patch(`/api/ops/finance/invoices/${id}`, { status: 'paid', paid_at: new Date().toISOString() });
    closeLeadModal();
    loadData();
  } catch (err) { alert('Failed: ' + err.message); }
};

function openInvoiceEditor() {
  alert('Invoice creation — use the staff console or API.');
}

function closeLeadModal() {
  document.getElementById('lead-modal').style.display = 'none';
}
window.closeLeadModal = closeLeadModal;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadData();
}