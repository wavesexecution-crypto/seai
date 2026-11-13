/* SEAI Business Ops — Overview page */
import { api } from '../api.js';

export const title = 'Overview';
export const subtitle = 'Key business metrics from live records';

export async function render(container) {
  container.innerHTML = `
    <div class="grid cards" id="metrics-grid">
      <div class="card"><div class="k">Total Leads</div><div class="v" id="m-total-leads">—</div><div class="d" id="m-total-leads-d"></div></div>
      <div class="card"><div class="k">New Leads Today</div><div class="v" id="m-new-leads">—</div><div class="d" id="m-new-leads-d"></div></div>
      <div class="card"><div class="k">Qualified</div><div class="v" id="m-qualified">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Active Prospects</div><div class="v" id="m-prospects">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Pending Proposals</div><div class="v" id="m-proposals">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Won Deals</div><div class="v" id="m-won">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Active Clients</div><div class="v" id="m-clients">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Active Projects</div><div class="v" id="m-projects">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Monthly Recurring Revenue</div><div class="v" id="m-mrr">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Total Revenue</div><div class="v" id="m-revenue">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Outstanding Payments</div><div class="v" id="m-outstanding">—</div><div class="d"></div></div>
      <div class="card"><div class="k">Follow-ups Due</div><div class="v" id="m-followups">—</div><div class="d"></div></div>
    </div>

    <div class="row between mt-16">
      <div class="panel" style="flex:1;min-width:300px">
        <h2>Leads by Stage</h2>
        <div id="leads-by-stage" class="mt-8"></div>
      </div>
      <div class="panel" style="flex:1;min-width:300px">
        <h2>Proposals by Status</h2>
        <div id="proposals-by-status" class="mt-8"></div>
      </div>
    </div>

    <div class="panel mt-16">
      <h2>Upcoming Deadlines</h2>
      <div id="upcoming-deadlines" class="mt-8"></div>
    </div>

    <div class="panel mt-16">
      <h2>Recent Business Activity</h2>
      <div id="recent-activity" class="mt-8"></div>
    </div>
  `;

  await loadData();
  return container;
}

async function loadData() {
  try {
    const data = await api.get('/dashboard');
    const m = data.metrics;

    setText('m-total-leads', m.total_leads);
    setText('m-new-leads', m.new_leads_today);
    setText('m-qualified', m.qualified_leads);
    setText('m-prospects', m.active_prospects);
    setText('m-proposals', m.pending_proposals);
    setText('m-won', m.won_deals);
    setText('m-clients', m.active_clients);
    setText('m-projects', m.active_projects);
    setText('m-mrr', formatINR(m.monthly_recurring_revenue));
    setText('m-revenue', formatINR(m.total_revenue));
    setText('m-outstanding', formatINR(m.outstanding_payments));
    setText('m-followups', m.follow_up_due);

    renderList('leads-by-stage', m.leads_by_stage, (k, v) => `<div class="row"><span>${k}</span><span style="margin-left:auto">${v}</span></div>`);
    renderList('proposals-by-status', m.proposals_by_status, (k, v) => `<div class="row"><span>${k}</span><span style="margin-left:auto">${v}</span></div>`);

    renderDeadlines(data.upcoming_deadlines);
    renderActivity(data.recent_activity);
  } catch (err) {
    console.error('Dashboard load failed:', err);
  }
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v ?? '—';
}

function formatINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

function renderList(id, data, rowFn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!data || Object.keys(data).length === 0) {
    el.innerHTML = '<div class="empty-state">No data</div>';
    return;
  }
  el.innerHTML = Object.entries(data).map(([k, v]) => rowFn(k, v)).join('');
}

function renderDeadlines(items) {
  const el = document.getElementById('upcoming-deadlines');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty-state">No upcoming deadlines</div>';
    return;
  }
  el.innerHTML = items.map((p) => `
    <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line2)">
      <div style="flex:1"><div style="font-weight:600">${escapeHtml(p.name)}</div><div style="font-size:11px;color:var(--faint)">Due ${p.due_date}</div></div>
      <div><span class="badge badge-${p.status}">${p.status}</span></div>
    </div>
  `).join('');
}

function renderActivity(items) {
  const el = document.getElementById('recent-activity');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }
  el.innerHTML = items.map((a) => `
    <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line2)">
      <div style="flex:1"><div style="font-weight:600">${escapeHtml(a.title)}</div><div style="font-size:11px;color:var(--faint)">Lead · ${a.status}</div></div>
      <div style="font-size:11px;color:var(--faint)">${new Date(a.updated_at).toLocaleDateString()}</div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadData();
}
