/* SEAI Business Ops — Services page */
import { api } from '../api.js';

export const title = 'Services';
export const subtitle = 'Central service catalogue — authoritative pricing';

let services = [];

export async function render(container) {
  container.innerHTML = `
    <div class="row between mt-8">
      <button class="btn-primary" id="btn-new-service">+ New Service</button>
    </div>

    <div class="panel mt-16">
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr><th>Key</th><th>Label</th><th>Description</th><th>Pricing Model</th><th>Base Price</th><th>Recurring</th><th>Active</th><th style="text-align:right">Actions</th></tr>
          </thead>
          <tbody id="services-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-service').addEventListener('click', openServiceEditor);
  await loadServices();
}

async function loadServices() {
  try {
    const data = await api.get('/services');
    services = data.services || [];
    renderTable(services);
  } catch (err) {
    console.error('Load services failed:', err);
  }
}

function renderTable(items) {
  const el = document.getElementById('services-table-body');
  if (!el) return;
  el.innerHTML = items.map((s) => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(s.key)}</td>
      <td style="font-weight:600">${escapeHtml(s.label)}</td>
      <td style="font-size:11px;color:var(--faint)">${escapeHtml(s.description)}</td>
      <td><span class="badge badge-new">${s.pricing_model}</span></td>
      <td>₹${s.base_price_inr != null ? Number(s.base_price_inr).toLocaleString() : '0'}</td>
      <td><span class="badge badge-new">${s.is_recurring ? 'Yes' : 'No'}</span></td>
      <td><span class="badge badge-${s.is_active ? 'active' : 'cancelled'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="text-align:right"><button class="ghost-btn" onclick="SEAI_OPS_PAGES.editService('${s.id}')">Edit</button></td>
    </tr>
  `).join('');
}

window.SEAI_OPS_PAGES = window.SEAI_OPS_PAGES || {};
window.SEAI_OPS_PAGES.editService = async (id) => {
  const s = services.find((x) => x.id === id);
  if (!s) return;
  alert(`Edit service: ${s.label}\nPrice: ₹${s.base_price_inr}\nModel: ${s.pricing_model}`);
};

function openServiceEditor() {
  alert('Service creation — use the staff console or API.');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onEnter() {
  await loadServices();
}
