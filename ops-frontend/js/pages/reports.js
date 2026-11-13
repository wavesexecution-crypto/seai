/* SEAI Business Ops â€” Reports (Phase 10) */
import { api } from '../api.js';

export const title = 'Reports';
export const subtitle = 'Business performance and growth analysis';

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <h2>Business Reports</h2>
      <p class="muted">Analyse SEAI performance across leads, clients, revenue, and delivery.</p>
    </div>

    <div class="grid cards" id="report-cards">
      <div class="card"><div class="k">Conversion Rate</div><div class="v" id="rep-conversion">â€”</div></div>
      <div class="card"><div class="k">Client Retention</div><div class="v" id="rep-retention">â€”</div></div>
      <div class="card"><div class="k">Avg Deal Value</div><div class="v" id="rep-dealvalue">â€”</div></div>
      <div class="card"><div class="k">Revenue Trend</div><div class="v" id="rep-trend">â€”</div></div>
    </div>

    <div class="panel mt-16">
      <h2>Report Export</h2>
      <div style="display:grid;gap:10px">
        <button class="btn-primary" onclick="SEAI_OPS_PAGES.exportReport('leads')">Export Lead Report</button>
        <button class="btn-primary" onclick="SEAI_OPS_PAGES.exportReport('clients')">Export Client Report</button>
        <button class="btn-primary" onclick="SEAI_OPS_PAGES.exportReport('finance')">Export Finance Report</button>
        <button class="btn-primary" onclick="SEAI_OPS_PAGES.exportReport('projects')">Export Project Report</button>
      </div>
    </div>
  `;

  await loadData();
}

async function loadData() {
  try {
    const [leadData, clientData, invData] = await Promise.all([
      api.get('/leads?limit=10000'),
      api.get('/clients?limit=10000'),
      api.get('/finance/invoices?limit=10000'),
    ]);

    const leads = leadData.leads || [];
    const clients = clientData.clients || [];
    const invoices = invData.invoices || [];

    const won = leads.filter((l) => l.stage === 'won').length;
    const lost = leads.filter((l) => l.stage === 'lost').length;
    const closed = won + lost;
    document.getElementById('rep-conversion').textContent = closed ? Math.round((won / closed) * 100) + '%' : 'â€”';

    const active = clients.filter((c) => c.status === 'active').length;
    document.getElementById('rep-retention').textContent = clients.length ? Math.round((active / clients.length) * 100) + '%' : 'â€”';

    const dealValues = leads.filter((l) => l.estimated_budget_inr).map((l) => Number(l.estimated_budget_inr));
    document.getElementById('rep-dealvalue').textContent = dealValues.length ? 'â‚¹' + Math.round(dealValues.reduce((a, b) => a + b, 0) / dealValues.length).toLocaleString() : 'â€”';

    const revenue = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total_inr || 0), 0);
    document.getElementById('rep-trend').textContent = 'â‚¹' + revenue.toLocaleString();
  } catch (err) {
    console.error('Load reports failed:', err);
  }
  return container;
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};
window.SEAI_OPS_PAGES.exportReport = (type) => {
  const url = `/api/ops/${type === 'leads' ? 'leads/export' : type === 'clients' ? 'clients' : type === 'finance' ? 'finance/invoices' : 'projects'}`;
  window.location.href = url;
};

export async function onEnter() {
  await loadData();
}

