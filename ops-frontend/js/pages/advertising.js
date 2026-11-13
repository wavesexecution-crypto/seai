/* SEAI Business Ops — Advertising (Phase 6) */
import { api } from '../api.js';

export const title = 'Advertising';
export const subtitle = 'SEAI ad campaigns, spend, and results (Meta Ads & Google Ads)';

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <h2>Advertising Control Centre</h2>
      <p class="muted">Connect Meta Ads and Google Ads accounts in Settings to view live campaign data.</p>
    </div>

    <div class="grid cards" id="ad-cards">
      <div class="card"><div class="k">Active Campaigns</div><div class="v" id="ad-active">—</div></div>
      <div class="card"><div class="k">Total Spend</div><div class="v" id="ad-spend">—</div></div>
      <div class="card"><div class="k">Impressions</div><div class="v" id="ad-impressions">—</div></div>
      <div class="card"><div class="k">Clicks</div><div class="v" id="ad-clicks">—</div></div>
    </div>

    <div class="panel mt-16">
      <h2>Campaigns</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Campaign</th><th>Platform</th><th>Status</th><th>Budget</th><th>Spent</th><th>Results</th></tr>
          </thead>
          <tbody id="ad-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  await loadData();
  return container;
}

async function loadData() {
  try {
    const data = await api.get('/marketing/campaigns');
    const campaigns = data.campaigns || [];
    document.getElementById('ad-active').textContent = campaigns.filter((c) => c.status === 'active').length;
    document.getElementById('ad-spend').textContent = '₹' + campaigns.reduce((s, c) => s + Number(c.budget_spent_inr || 0), 0).toLocaleString();
    document.getElementById('ad-impressions').textContent = '—';
    document.getElementById('ad-clicks').textContent = '—';
    renderTable(campaigns);
  } catch (err) {
    console.error('Load advertising failed:', err);
    document.getElementById('ad-table-body').innerHTML = '<tr><td colspan="6" class="empty-state">No campaign data. Connect advertising accounts in Settings.</td></tr>';
  }
}

function renderTable(items) {
  const el = document.getElementById('ad-table-body');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<tr><td colspan="6" class="empty-state">No campaigns yet.</td></tr>';
    return;
  }
  el.innerHTML = items.map((c) => `
    <tr>
      <td style="font-weight:600">${escapeHtml(c.name)}</td>
      <td style="font-size:11px">${escapeHtml(c.platform)}</td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td style="font-size:11px">₹${c.budget_total_inr != null ? Number(c.budget_total_inr).toLocaleString() : '0'}</td>
      <td style="font-size:11px">₹${c.budget_spent_inr != null ? Number(c.budget_spent_inr).toLocaleString() : '0'}</td>
      <td style="font-size:11px;color:var(--faint)">—</td>
    </tr>
  `).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadData();
}
