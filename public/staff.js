/* SEAI Staff Command Center — vanilla JS, cookie-session auth, RBAC-aware UI.
   APIs enforce authorization; the UI only hides what you cannot use. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n ?? 0).toLocaleString('en-IN');
const dt = (iso) => (!iso ? '—' : String(iso).slice(0, 16).replace('T', ' '));
const day = (iso) => (!iso ? '—' : String(iso).slice(0, 10));
const STAGES = ['new','contacted','responded','qualified','discovery_scheduled','discovery_completed','proposal_sent','negotiation','won','lost','follow_up'];
const STAGE_LABEL = { new:'New lead', contacted:'Contacted', responded:'Responded', qualified:'Qualified', discovery_scheduled:'Discovery scheduled', discovery_completed:'Discovery completed', proposal_sent:'Proposal sent', negotiation:'Negotiation', won:'Won', lost:'Lost', follow_up:'Follow-up' };
const PRIORITIES = ['low','normal','high','urgent'];
const SOURCES = ['referral','outbound','inbound','dm','campaign','website','import','event','other','manual'];
const WORKFLOWS = ['advertising','social','website','lead_gen','branding','automation','growth'];
const TASK_STATUS = ['pending','in_progress','blocked','done','skipped'];

const TABS = [
  { id: 'overview', label: 'Overview', roles: 'all' },
  { id: 'leads', label: 'Leads', roles: ['admin','sales','account_manager'] },
  { id: 'inquiries', label: 'Inquiries', roles: ['admin','sales','account_manager'] },
  { id: 'clients', label: 'Clients', roles: ['admin','account_manager','sales','finance','marketing'] },
  { id: 'projects', label: 'Projects', roles: ['admin','account_manager','marketing','designer','developer'] },
  { id: 'approvals', label: 'Approvals', roles: ['admin','account_manager','marketing','designer','developer'] },
  { id: 'finance', label: 'Finance', roles: ['admin','finance'] },
  { id: 'campaigns', label: 'Campaigns', roles: ['admin','account_manager','marketing'] },
  { id: 'support', label: 'Support', roles: ['admin','account_manager','sales','finance','marketing','designer','developer'] },
  { id: 'staff', label: 'Staff & roles', roles: ['admin'] },
];

const state = { user: null, view: 'overview', leadPage: 1, leadFilter: {}, clientCache: {} };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 || res.status === 403) {
    const e = await res.json().catch(() => ({}));
    throw Object.assign(new Error(e.error || 'Not authorised'), { status: res.status });
  }
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('json') ? await res.json() : { ok: res.ok, raw: await res.text() };
  if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, payload: json });
  return json;
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = 'none'), ms);
}
const errToast = (err) => toast(err?.message || String(err));
const pill = (txt, cls = '') => `<span class="pill ${cls}">${esc(txt)}</span>`;
const stagePill = (s) => pill(STAGE_LABEL[s] ?? s, s === 'won' ? 'good' : s === 'lost' ? 'bad' : s === 'new' ? 'new' : '');

function canAccess(tab) {
  if (tab.roles === 'all') return true;
  const r = state.user?.role ?? 'customer';
  return r === 'admin' || tab.roles.includes(r);
}

function renderNav() {
  $('#nav').innerHTML = TABS.filter(canAccess).map((t) =>
    `<button data-view="${t.id}" class="${state.view === t.id ? 'on' : ''}">${esc(t.label)}</button>`).join('');
  $$('#nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
}

function go(view) {
  state.view = view;
  $('#crumb').textContent = TABS.find((t) => t.id === view)?.label ?? view;
  renderNav();
  const main = $('#main');
  main.innerHTML = '<div class="empty">Loading…</div>';
  const render = {
    overview: renderOverview, leads: renderLeads, inquiries: renderInquiries, clients: renderClients,
    projects: renderProjects, approvals: renderApprovals, finance: renderFinance,
    campaigns: renderCampaigns, support: renderSupport, staff: renderStaff,
  }[view];
  if (render) render().catch((err) => { main.innerHTML = `<div class="empty">Could not load: ${esc(err.message)}</div>`; });
}

function openDrawer(title, html) {
  $('#drawerTitle').textContent = title;
  $('#drawerBody').innerHTML = html;
  $('#drawer').classList.add('open');
}
const closeDrawer = () => $('#drawer').classList.remove('open');

function openModal(title, fieldsHtml, onSubmit) {
  $('#modalTitle').textContent = title;
  const form = $('#modalForm');
  form.innerHTML = fieldsHtml;
  $('#modal').classList.add('open');
  $('#modalSubmit').onclick = async () => {
    try { await onSubmit(new FormData(form)); $('#modal').classList.remove('open'); }
    catch (err) { errToast(err); }
  };
}
const field = (name, label, type = 'text', attrs = '') => `<div class="${attrs.includes('full') ? 'full' : ''}"><label>${esc(label)}</label><input name="${esc(name)}" type="${type}" ${attrs.replace('full', '')} /></div>`;
const selectField = (name, label, options, attrs = '') =>
  `<div class="${attrs.includes('full') ? 'full' : ''}"><label>${esc(label)}</label><select name="${esc(name)}">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>`;

async function staffUsers() {
  try { const r = await api('/api/staff/users'); return r.users ?? []; } catch { return []; }
}

/* ============ OVERVIEW ============ */
async function renderOverview() {
  const d = await api('/api/staff/overview');
  const o = d;
  const f = o.finance;
  $('#main').innerHTML = `
    <h1>Business overview</h1>
    <div class="sub">Live numbers from the CRM, agreements and invoices. Advertising budgets are excluded from revenue.</div>
    <div class="grid cards">
      ${statCard('Active clients', o.clients.active, `${o.clients.total} total · ${o.clients.onboarding} onboarding`)}
      ${statCard('MRR (service fees)', money(f.mrr), `${f.activeAgreements} active agreements · excl. ad budgets`)}
      ${statCard('Ad budgets (client-funded)', money(f.adBudgets), 'Never counted as SEAI revenue')}
      ${statCard('Outstanding (service)', money(f.outstandingService), `${f.outstandingCount} open invoice(s)`)}
      ${statCard('New leads (7d)', o.leads.new7d, `${o.leads.total} total in pipeline`)}
      ${statCard('Qualified leads', o.leads.qualified, `${o.leads.proposalsSent} proposals · ${o.leads.negotiation} negotiating`)}
      ${statCard('Conversion rate', o.leads.conversionRate === null ? '—' : o.leads.conversionRate + '%', `${o.leads.won} won · ${o.leads.lost} lost`)}
      ${statCard('Follow-ups due', o.leads.followUpDue, 'Due today or overdue')}
      ${statCard('Active projects', o.projects.active, `${o.projects.planned} planned · ${o.projects.completed} completed`)}
      ${statCard('Renewals ≤30d', o.renewalsNext30d, 'See Finance → renewals')}
    </div>
    <div class="panel" style="margin-top:14px"><h2>Pipeline funnel</h2>
      <div class="funnel">${STAGES.map((s) => `<span class="fstep">${esc(STAGE_LABEL[s])} <b>${o.leads.byStage[s] ?? 0}</b></span>`).join('')}</div>
    </div>
    <div class="panel"><h2>Upcoming renewals</h2>
      ${f.renewals.length ? `<table><thead><tr><th>Agreement</th><th>Renewal</th><th class="r">Fee/mo</th></tr></thead><tbody>${f.renewals.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(day(r.renewal_date))}</td><td class="r">${money(r.monthly_fee_inr)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No renewals scheduled yet.</div>'}
    </div>`;
}
const statCard = (k, v, d) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${esc(d)}</div></div>`;

/* ============ LEADS ============ */
async function renderLeads() {
  const users = await staffUsers();
  const userOpts = users.map((u) => [u.id, u.full_name]);
  $('#main').innerHTML = `
    <div class="row between"><div><h1>Lead pipeline</h1><div class="sub">Search, filter, track and convert. Imports accept CSV or text-based PDFs (no OCR — scanned files are rejected).</div></div>
      <div class="row">
        <button class="btn sec" id="importBtn">Import file</button>
        <a class="btn sec" id="exportBtn" href="#">Export CSV</a>
        <button class="btn" id="newLeadBtn">+ New lead</button>
      </div></div>
    <div class="panel"><div class="row" style="margin-bottom:10px">
      <input id="leadQ" placeholder="Search business, contact, phone, email…" style="flex:1;min-width:220px" value="${esc(state.leadFilter.q ?? '')}"/>
      <select id="leadStage"><option value="">All stages</option>${STAGES.map((s) => `<option value="${s}" ${state.leadFilter.stage === s ? 'selected' : ''}>${STAGE_LABEL[s]}</option>`).join('')}</select>
      <select id="leadPriority"><option value="">All priorities</option>${PRIORITIES.map((p) => `<option value="${p}" ${state.leadFilter.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="leadSource"><option value="">All sources</option>${SOURCES.map((s) => `<option value="${s}" ${state.leadFilter.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label style="margin:0;display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" id="leadDue" style="width:auto" ${state.leadFilter.follow_up_due ? 'checked' : ''}/> Follow-ups due</label>
    </div><div id="leadsTable"></div></div>`;

  $('#leadQ').addEventListener('input', debounce(() => { state.leadFilter.q = $('#leadQ').value.trim(); state.leadPage = 1; loadLeadsTable(); }, 250));
  for (const [id, key] of [['leadStage', 'stage'], ['leadPriority', 'priority'], ['leadSource', 'source']]) {
    $('#' + id).addEventListener('change', (e) => { state.leadFilter[key] = e.target.value || undefined; state.leadPage = 1; loadLeadsTable(); });
  }
  $('#leadDue').addEventListener('change', (e) => { state.leadFilter.follow_up_due = e.target.checked || undefined; state.leadPage = 1; loadLeadsTable(); });
  $('#exportBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state.leadFilter)) if (v) p.set(k, v === true ? '1' : String(v));
    window.location = '/api/staff/leads/export?' + p.toString();
  });
  $('#newLeadBtn').addEventListener('click', () => openNewLeadModal(userOpts));
  $('#importBtn').addEventListener('click', openImportModal);
  loadLeadsTable();
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function loadLeadsTable() {
  const p = new URLSearchParams({ page: String(state.leadPage), limit: '25', ...Object.fromEntries(Object.entries(state.leadFilter).filter(([, v]) => v).map(([k, v]) => [k, v === true ? '1' : String(v)])) });
  const d = await api('/api/staff/leads?' + p);
  const rows = d.leads.map((l) => `<tr data-id="${l.id}" style="cursor:pointer">
    <td><b>${esc(l.business_name)}</b><br/><span class="muted">${esc(l.lead_ref ?? '')} · ${esc(l.industry ?? '—')}</span></td>
    <td>${esc(l.contact_person ?? '—')}<br/><span class="muted">${esc(l.phone ?? '')} ${esc(l.email ?? '')}</span></td>
    <td>${esc(l.location ?? '—')}</td>
    <td>${stagePill(l.stage)}</td>
    <td>${pill(l.priority ?? 'normal', l.priority === 'urgent' ? 'bad' : l.priority === 'high' ? 'warn' : '')}</td>
    <td>${esc(day(l.next_follow_up_at))}</td>
  </tr>`).join('');
  $('#leadsTable').innerHTML = `<table><thead><tr><th>Business</th><th>Contact</th><th>Location</th><th>Stage</th><th>Priority</th><th>Follow-up</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No leads match. Import a file or add one.</td></tr>'}</tbody></table>
  <div class="row between" style="margin-top:10px"><span class="muted">${d.total} lead(s) · page ${d.page}</span>
    <span class="row"><button class="btn sec small" id="prevPage" ${d.page <= 1 ? 'disabled' : ''}>← Prev</button><button class="btn sec small" id="nextPage" ${d.page * d.limit >= d.total ? 'disabled' : ''}>Next →</button></span></div>`;
  $$('#leadsTable tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openLeadDrawer(tr.dataset.id)));
  $('#prevPage')?.addEventListener('click', () => { state.leadPage = Math.max(1, state.leadPage - 1); loadLeadsTable(); });
  $('#nextPage')?.addEventListener('click', () => { state.leadPage += 1; loadLeadsTable(); });
}

function openNewLeadModal(userOpts) {
  openModal('New lead', `<div class="formgrid">
    ${field('business_name', 'Business name *', 'text', 'full')}
    ${field('contact_person', 'Contact person')}${field('phone', 'Phone', 'tel')}
    ${field('email', 'Email', 'email')}${field('industry', 'Industry')}
    ${field('location', 'Location / city')}${field('website', 'Website', 'url')}
    ${selectField('source', 'Source', SOURCES.map((s) => [s, s]))}${selectField('priority', 'Priority', PRIORITIES.map((p) => [p, p]))}
    ${selectField('stage', 'Stage', STAGES.map((s) => [s, STAGE_LABEL[s]]))}${selectField('assigned_to', 'Assign to', [['', 'Unassigned'], ...userOpts])}
    ${field('estimated_budget_inr', 'Est. budget (₹)', 'number')}${field('estimated_mrr_inr', 'Est. MRR (₹)', 'number')}
    ${field('next_follow_up_at', 'Follow-up date', 'date')}<div class="full"><label>Notes</label><textarea name="notes" placeholder="Context, referral details, pain points…"></textarea></div>
  </div>`, async (fd) => {
    const body = Object.fromEntries(fd);
    for (const k of ['estimated_budget_inr', 'estimated_mrr_inr']) if (body[k] === '') delete body[k];
    if (!body.assigned_to) delete body.assigned_to;
    const r = await api('/api/staff/leads', { method: 'POST', body });
    toast('Lead created');
    state.view === 'leads' ? loadLeadsTable() : go('leads');
    return r;
  });
}

function openImportModal() {
  openModal('Import leads', `<div class="full"><label>File (.csv or .pdf)</label><input type="file" id="importFile" accept=".csv,.pdf,text/csv,application/pdf"/></div>
    <p class="muted" style="font-size:11.5px;margin:8px 0 0">CSV headers recognised: business, contact, phone, email, industry, location, website, source, budget, priority, services, notes. PDFs must contain selectable text — scanned PDFs are rejected (OCR is not enabled). Duplicates (same email/phone/business) are skipped unless ticked.</p>
    <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;margin-top:10px"><input type="checkbox" id="importDup" style="width:auto"/> Import rows even if they look like duplicates</label>`,
    async () => {
      const file = $('#importFile').files[0];
      if (!file) throw new Error('Choose a file');
      if (file.size > 3 * 1024 * 1024) throw new Error('File exceeds 3 MB');
      const content_base64 = await fileToBase64(file);
      const r = await api('/api/staff/leads/import', { method: 'POST', body: { filename: file.name, content_base64, import_duplicates: $('#importDup').checked } });
      toast(`Imported ${r.rows_imported} · skipped ${r.rows_skipped} · duplicates ${r.duplicates}`);
      loadLeadsTable();
    });
}
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

async function openLeadDrawer(id) {
  const d = await api('/api/staff/leads/' + id);
  const l = d.lead;
  const users = await staffUsers();
  const userOpts = [['', 'Unassigned'], ...users.map((u) => [u.id, u.full_name])];
  const acts = d.activities.map((a) => `<div class="act"><b>${esc(a.type)}</b> — ${esc(a.body ?? '')}<time>${dt(a.created_at)}</time></div>`).join('') || '<div class="muted">No activity yet.</div>';
  openDrawer(l.business_name, `
    <div class="row" style="margin-bottom:8px">${stagePill(l.stage)} ${pill(l.priority ?? 'normal')} ${pill('src: ' + (l.source ?? 'manual'))}</div>
    <div class="kv">
      <div>Ref</div><div>${esc(l.lead_ref ?? l.id)}</div>
      <div>Contact</div><div>${esc(l.contact_person ?? '—')} · ${esc(l.designation ?? '')}</div>
      <div>Phone</div><div>${esc(l.phone ?? '—')}</div>
      <div>Email</div><div>${esc(l.email ?? '—')}</div>
      <div>Industry</div><div>${esc(l.industry ?? '—')}</div>
      <div>Location</div><div>${esc(l.location ?? '—')}</div>
      <div>Website</div><div>${l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noreferrer" style="color:var(--blue)">${esc(l.website)}</a>` : '—'}</div>
      <div>Services</div><div>${esc((JSON.parse(l.potential_services ?? '[]') || []).join(', ') || '—')}</div>
      <div>Budget</div><div>${l.estimated_budget_inr ? money(l.estimated_budget_inr) : '—'} · MRR ${l.estimated_mrr_inr ? money(l.estimated_mrr_inr) : '—'}</div>
      <div>Follow-up</div><div>${esc(day(l.next_follow_up_at))}</div>
    </div>
    <div class="row" style="margin:10px 0">
      <select id="stageSel">${STAGES.map((s) => `<option value="${s}" ${l.stage === s ? 'selected' : ''}>${STAGE_LABEL[s]}</option>`).join('')}</select>
      <select id="assignSel">${userOpts.map(([v, lab]) => `<option value="${esc(v)}" ${String(l.assigned_to ?? '') === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>
    </div>
    <div class="row" style="margin-bottom:12px"><input id="followUpDate" type="date" value="${esc(String(l.next_follow_up_at ?? '').slice(0, 10))}"/><button class="btn sec small" id="setFollowUp">Set follow-up</button><button class="btn sec small" id="lostBtn">Mark lost…</button><button class="btn small" id="convertBtn">Convert to client</button></div>
    <label>Add note / log activity</label>
    <div class="row"><select id="actType"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select><input id="actBody" placeholder="What happened?" style="flex:1"/><button class="btn sec small" id="addAct">Log</button></div>
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:18px 0 8px">Activity history</h2>
    <div>${acts}</div>`);
  $('#stageSel').addEventListener('change', async (e) => {
    try { await api(`/api/staff/leads/${id}`, { method: 'PATCH', body: { stage: e.target.value } }); toast('Stage updated'); openLeadDrawer(id); loadLeadsTable(); } catch (err) { errToast(err); }
  });
  $('#assignSel').addEventListener('change', async (e) => {
    try { await api(`/api/staff/leads/${id}`, { method: 'PATCH', body: { assigned_to: e.target.value || null } }); toast('Assignment updated'); } catch (err) { errToast(err); }
  });
  $('#setFollowUp').addEventListener('click', async () => {
    try { await api(`/api/staff/leads/${id}`, { method: 'PATCH', body: { next_follow_up_at: $('#followUpDate').value || null } }); toast('Follow-up saved'); loadLeadsTable(); } catch (err) { errToast(err); }
  });
  $('#addAct').addEventListener('click', async () => {
    const body = $('#actBody').value.trim(); if (!body) return;
    try { await api(`/api/staff/leads/${id}/activity`, { method: 'POST', body: { type: $('#actType').value, body } }); $('#actBody').value = ''; openLeadDrawer(id); } catch (err) { errToast(err); }
  });
  $('#lostBtn').addEventListener('click', async () => {
    const reason = prompt('Why was this lead lost? (stored on the record)');
    if (reason === null) return;
    try { await api(`/api/staff/leads/${id}`, { method: 'PATCH', body: { stage: 'lost', lost_reason: reason } }); toast('Marked lost'); closeDrawer(); loadLeadsTable(); } catch (err) { errToast(err); }
  });
  $('#convertBtn').addEventListener('click', async () => {
    if (!confirm('Convert this lead to a client and open onboarding?')) return;
    try { const r = await api(`/api/staff/leads/${id}/convert`, { method: 'POST' }); toast('Converted — onboarding started'); closeDrawer(); go('clients'); } catch (err) { errToast(err); }
  });
}

/* ============ INQUIRIES ============ */
async function renderInquiries() {
  const d = await api('/api/staff/inquiries');
  const rows = d.inquiries.map((i) => `<tr>
    <td><b>${esc(i.business_name)}</b><br/><span class="muted">${esc(i.industry ?? '—')} · ${esc(i.website ?? '')}</span></td>
    <td>${esc(i.name)}<br/><span class="muted">${esc(i.email)} · ${esc(i.phone)}</span></td>
    <td>${esc((JSON.parse(i.services_required ?? '[]') || []).join(', ') || '—')}<br/><span class="muted">Mktg: ${esc(i.monthly_marketing_budget ?? '—')} · Ads: ${esc(i.ad_budget ?? '—')}</span></td>
    <td class="muted" style="max-width:280px">${esc(i.objective ?? '')}${i.details ? '<br/>' + esc(String(i.details).slice(0, 160)) : ''}</td>
    <td>${dt(i.created_at)}</td>
    <td>${pill(i.status ?? 'new', i.status === 'new' ? 'new' : '')}<br/>${i.status === 'new' ? `<button class="btn sec small" data-close="${i.id}" style="margin-top:4px">Mark handled</button>` : ''}</td>
  </tr>`).join('');
  $('#main').innerHTML = `<h1>Consultation inquiries</h1><div class="sub">From the public site enquiry form. Each submission also auto-creates a pipeline lead (duplicates are linked, not re-created).</div>
    <div class="panel"><table><thead><tr><th>Business</th><th>Contact</th><th>Services / budgets</th><th>Objective & details</th><th>Received</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No inquiries yet. The contact form on seai.store feeds this list.</td></tr>'}</tbody></table></div>`;
  $$('#main [data-close]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/staff/inquiries/' + b.dataset.close + '/close', { method: 'POST', body: { status: 'closed' } }); toast('Marked handled'); renderInquiries(); } catch (err) { errToast(err); }
  }));
}

/* ============ CLIENTS ============ */
async function renderClients() {
  $('#main').innerHTML = `
    <div class="row between"><div><h1>Clients</h1><div class="sub">Won leads become clients. Onboarding progress is tracked per client.</div></div></div>
    <div class="panel"><div class="row" style="margin-bottom:10px"><input id="clientQ" placeholder="Search clients…" style="flex:1;min-width:200px"/><select id="clientStatus"><option value="">All statuses</option><option value="onboarding">Onboarding</option><option value="active">Active</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option></select></div>
    <div id="clientsTable"></div></div>`;
  $('#clientQ').addEventListener('input', debounce(loadClientsTable, 250));
  $('#clientStatus').addEventListener('change', loadClientsTable);
  loadClientsTable();
}
async function loadClientsTable() {
  const p = new URLSearchParams({ limit: '50' });
  if ($('#clientQ')?.value.trim()) p.set('q', $('#clientQ').value.trim());
  if ($('#clientStatus')?.value) p.set('status', $('#clientStatus').value);
  const d = await api('/api/staff/clients?' + p);
  const rows = d.clients.map((c) => `<tr data-id="${c.id}" style="cursor:pointer"><td><b>${esc(c.brand_name)}</b><br/><span class="muted">${esc(c.industry ?? '—')}</span></td><td>${esc(c.primary_contact ?? '—')}<br/><span class="muted">${esc(c.email ?? '')}</span></td><td>${esc(c.service_locations ?? '—')}</td><td>${pill(c.status ?? 'onboarding', c.status === 'active' ? 'good' : c.status === 'cancelled' ? 'bad' : 'warn')}</td></tr>`).join('');
  $('#clientsTable').innerHTML = `<table><thead><tr><th>Client</th><th>Contact</th><th>Locations</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">No clients yet. Convert a won lead.</td></tr>'}</tbody></table>`;
  $$('#clientsTable tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openClientDrawer(tr.dataset.id)));
}
async function openClientDrawer(id) {
  const d = await api('/api/staff/clients/' + id);
  const c = d.client;
  const onb = d.onboarding;
  state.clientCache[id] = c;
  openDrawer(c.brand_name, `
    <div class="row">${pill(c.status ?? 'onboarding', c.status === 'active' ? 'good' : 'warn')} ${(d.agreements || []).map((a) => pill(`${a.name} · ${money(a.monthly_fee_inr)}/mo`, 'blue')).join('')}</div>
    <div class="kv"><div>Contact</div><div>${esc(c.primary_contact ?? '—')} (${esc(c.designation ?? '')})</div><div>Email</div><div>${esc(c.email ?? '—')}</div><div>Phone</div><div>${esc(c.phone ?? '—')}</div><div>Address</div><div>${esc(c.address ?? '—')}</div><div>Locations</div><div>${esc(c.service_locations ?? '—')}</div><div>GSTIN</div><div>${esc(c.gstin ?? '—')}</div><div>Website</div><div>${esc(c.website ?? '—')}</div></div>
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:14px 0 6px">Onboarding progress</h2>
    <div class="row"><div style="flex:1;background:#0e0e10;border:1px solid var(--line2);border-radius:99px;height:12px;overflow:hidden"><div style="width:${onb?.progress?.percent ?? 0}%;height:100%;background:#fff"></div></div><b>${onb?.progress?.percent ?? 0}%</b></div>
    <div class="muted" style="font-size:11px;margin-top:4px">${onb?.progress?.filled ?? 0}/${onb?.progress?.required ?? 0} mandatory fields · services: ${(onb?.services ?? []).join(', ') || 'all (no agreement yet)'}</div>
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:14px 0 6px">Agreements</h2>
    ${(d.agreements || []).map((a) => `<div class="act"><b>${esc(a.name)}</b> — ${money(a.monthly_fee_inr)}/mo · ad budget ${a.ad_budget_inr ? money(a.ad_budget_inr) : '—'} · renewal ${esc(day(a.renewal_date))} ${a.status !== 'active' ? pill(a.status, 'bad') : ''}${a.razorpay_subscription_id ? `<br/><span class="muted">Razorpay: ${esc(a.razorpay_subscription_id)}</span>` : ''}<br/><button class="btn sec small" data-gen="${a.id}" style="margin-top:4px">Generate service invoice</button> <button class="btn sec small" data-gen-ad="${a.id}" style="margin-top:4px">Generate ad-budget invoice</button> ${['starter','growth','scale'].includes(String(a.plan)) ? `<button class="btn sec small" data-sub-create="${a.id}" style="margin-top:4px">Create Razorpay subscription</button>` : ''}</div>`).join('') || '<div class="muted">No agreement — create one below.</div>'}
    <button class="btn sec small" id="addAgreement" style="margin:6px 0 14px">+ New agreement</button>
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:6px 0">Projects</h2>
    ${(d.projects || []).map((p) => `<div class="act"><b>${esc(p.name)}</b> — ${esc(p.service_category)} · ${esc(p.status)}</div>`).join('') || '<div class="muted">No projects yet.</div>'}
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:14px 0 6px">Invoices</h2>
    ${(d.invoices || []).slice(0, 8).map((i) => `<div class="act"><b>${esc(i.number)}</b> — ${esc(i.kind)} · ${money(i.total_inr)} · ${pill(i.status, i.status === 'paid' ? 'good' : i.status === 'overdue' ? 'bad' : '')}</div>`).join('') || '<div class="muted">No invoices yet.</div>'}
  `);
  $$('#drawerBody [data-gen]').forEach((b) => b.addEventListener('click', () => generateInvoice(b.dataset.gen, 'service_fee')));
  $$('#drawerBody [data-gen-ad]').forEach((b) => b.addEventListener('click', () => generateInvoice(b.dataset.genAd, 'ad_budget')));
  $$('#drawerBody [data-sub-create]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Create a genuine Razorpay subscription for this agreement? The client will authorise the mandate in the dashboard.')) return;
    try {
      const r = await api(`/api/staff/agreements/${b.dataset.subCreate}/subscription`, { method: 'POST' });
      toast(`Subscription created. Client can activate auto-pay from Billing. (${r.razorpaySubscriptionId})`);
      openClientDrawer(id);
    } catch (err) { errToast(err); }
  }));
  $('#addAgreement')?.addEventListener('click', () => openAgreementModal(id, () => openClientDrawer(id)));
}
async function generateInvoice(agreementId, kind) {
  const periodLabel = prompt(kind === 'ad_budget' ? 'Period label for the ad-budget invoice' : 'Period label for the service invoice', new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }));
  if (periodLabel === null) return;
  try { const r = await api(`/api/staff/agreements/${agreementId}/invoices/generate`, { method: 'POST', body: { kind, periodLabel } }); toast(`Invoice ${r.number} created (${money(r.total_inr)})`); } catch (err) { errToast(err); }
}
function openAgreementModal(clientId, onDone) {
  openModal('New agreement', `<div class="formgrid">
    ${selectField('plan', 'Plan', [['starter', 'Starter — ₹7,999/mo'], ['growth', 'Growth — ₹14,999/mo'], ['scale', 'Scale — ₹29,999/mo'], ['custom', 'Custom']])}
    ${field('monthly_fee_inr', 'Monthly fee (₹) — blank = plan price', 'number')}
    ${field('ad_budget_inr', 'Ad budget (₹/mo, client-funded)', 'number')}
    ${field('name', 'Name', 'text')}
    ${field('contract_months', 'Contract months', 'number')}
    ${field('start_date', 'Start date', 'date')}
    ${selectField('services', 'Services (comma-separated keys)', [['advertising,social', 'advertising,social'], ['website', 'website'], ['branding', 'branding'], ['lead_gen', 'lead_gen'], ['growth', 'growth'], ['automation', 'automation'], ['advertising,social,lead_gen', 'advertising,social,lead_gen']])}
    <div class="full"><label>Services in scope</label><input name="services_custom" placeholder="e.g. advertising,social,website (overrides dropdown)"/></div>
  </div>`, async (fd) => {
    const body = Object.fromEntries(fd);
    for (const k of ['monthly_fee_inr', 'ad_budget_inr', 'contract_months']) if (body[k] === '') delete body[k];
    const svc = (body.services_custom || body.services || '').split(',').map((s) => s.trim()).filter(Boolean);
    const payload = { plan: body.plan, monthly_fee_inr: body.monthly_fee_inr ? Number(body.monthly_fee_inr) : undefined, ad_budget_inr: body.ad_budget_inr ? Number(body.ad_budget_inr) : undefined, name: body.name || undefined, contract_months: body.contract_months ? Number(body.contract_months) : undefined, start_date: body.start_date || undefined, services: svc };
    await api(`/api/staff/clients/${clientId}/agreements`, { method: 'POST', body: payload });
    toast('Agreement created');
    if (onDone) onDone();
  });
}

/* ============ PROJECTS ============ */
async function renderProjects() {
  const clients = (await api('/api/staff/clients?limit=200')).clients;
  $('#main').innerHTML = `
    <div class="row between"><div><h1>Delivery</h1><div class="sub">Projects are created from service workflows — every step has an owner, dates, dependencies and approval gates.</div></div>
      <button class="btn" id="newProjectBtn">+ New project</button></div>
    <div class="panel"><div class="row" style="margin-bottom:10px"><select id="projectStatus"><option value="">All statuses</option>${['planned','active','on_hold','completed','cancelled'].map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div><div id="projectsTable"></div></div>`;
  $('#projectStatus').addEventListener('change', loadProjectsTable);
  $('#newProjectBtn').addEventListener('click', () => {
    openModal('New project from workflow', `<div class="formgrid">
      ${selectField('client_id', 'Client', clients.map((c) => [c.id, c.brand_name]), 'full')}
      ${selectField('service_category', 'Service workflow', WORKFLOWS.map((w) => [w, w.replace('_', ' ')]))}
      ${field('name', 'Project name (optional)', 'text')}
      ${field('start_date', 'Start date', 'date')}${field('due_date', 'Due date', 'date')}
      <div class="full"><label>Brief</label><textarea name="brief"></textarea></div>
    </div>`, async (fd) => {
      const body = Object.fromEntries(fd);
      for (const k of ['name', 'start_date', 'due_date', 'brief']) if (body[k] === '') delete body[k];
      const r = await api('/api/staff/projects', { method: 'POST', body });
      toast(`Project created with ${r.tasks} steps`);
      loadProjectsTable();
    });
  });
  loadProjectsTable();
}
async function loadProjectsTable() {
  const status = $('#projectStatus')?.value ?? '';
  const d = await api('/api/staff/projects' + (status ? `?status=${status}` : ''));
  const rows = d.projects.map((p) => `<tr data-id="${p.id}" style="cursor:pointer"><td><b>${esc(p.name)}</b><br/><span class="muted">${esc(p.service_category)}</span></td><td>${esc(day(p.start_date))} → ${esc(day(p.due_date))}</td><td>${pill(p.status, p.status === 'active' ? 'good' : p.status === 'completed' ? 'blue' : '')}</td></tr>`).join('');
  $('#projectsTable').innerHTML = `<table><thead><tr><th>Project</th><th>Timeline</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty">No projects yet. Create one from a workflow.</td></tr>'}</tbody></table>`;
  $$('#projectsTable tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openProjectDrawer(tr.dataset.id)));
}
async function openProjectDrawer(id) {
  const d = await api('/api/staff/projects/' + id);
  const p = d.project;
  const done = d.tasks.filter((t) => t.status === 'done').length;
  const pct = d.tasks.length ? Math.round((done / d.tasks.length) * 100) : 0;
  const taskRows = d.tasks.map((t) => {
    const gate = t.approval_required || t.is_gate;
    const locked = gate && !t.approved_at;
    return `<div class="act" data-task="${t.id}">
      <div class="row between"><div><b>${Number(t.seq) + 1}. ${esc(t.title)}</b> ${gate ? pill('GATE', 'warn') : ''} ${t.approved_at ? pill('approved', 'good') : ''}<br/><span class="muted">${esc(t.kind)}${t.detail ? ' — ' + esc(t.detail) : ''}</span></div>
      <div class="row"><select class="taskStatus" ${locked ? '' : ''}>${TASK_STATUS.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>${gate ? `<button class="btn sec small" data-approve="1">Approve</button><button class="btn danger small" data-approve="0">Reject</button>` : ''}</div></div>
    </div>`;
  }).join('');
  const acts = d.activities.map((a) => `<div class="act"><b>${esc(a.type)}</b> — ${esc(a.body ?? '')}<time>${dt(a.created_at)}</time></div>`).join('');
  openDrawer(p.name, `
    <div class="row">${pill(p.status)} ${pill(p.service_category)} ${p.assigned_to ? pill('assigned') : ''}</div>
    <div class="row" style="margin:10px 0"><div style="flex:1;background:#0e0e10;border:1px solid var(--line2);border-radius:99px;height:12px;overflow:hidden"><div style="width:${pct}%;height:100%;background:#fff"></div></div><b>${pct}%</b></div>
    <div class="muted" style="font-size:11.5px">${esc(p.brief ?? 'No brief recorded.')}</div>
    <div class="row" style="margin:10px 0"><select id="projectStatusSel">${['planned','active','on_hold','completed','cancelled'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:14px 0 8px">Tasks & gates</h2>
    ${taskRows}
    <h2 style="font-size:11px;text-transform:uppercase;color:var(--faint);letter-spacing:.1em;margin:18px 0 8px">Activity</h2>
    ${acts || '<div class="muted">No activity yet.</div>'}
  `);
  $('#projectStatusSel').addEventListener('change', async (e) => { try { await api('/api/staff/projects/' + id, { method: 'PATCH', body: { status: e.target.value } }); toast('Project status updated'); } catch (err) { errToast(err); } });
  $$('#drawerBody [data-task]').forEach((rowEl) => {
    const taskId = rowEl.dataset.task;
    rowEl.querySelector('.taskStatus').addEventListener('change', async (e) => {
      try { await api('/api/staff/tasks/' + taskId, { method: 'PATCH', body: { status: e.target.value } }); toast('Task updated'); openProjectDrawer(id); } catch (err) { errToast(err); openProjectDrawer(id); }
    });
    rowEl.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', async () => {
      const approve = btn.dataset.approve === '1';
      const feedback = approve ? '' : (prompt('Why is this rejected?') ?? '');
      try { await api(`/api/staff/tasks/${taskId}/approve`, { method: 'POST', body: { approve, feedback } }); toast(approve ? 'Approved' : 'Rejected'); openProjectDrawer(id); } catch (err) { errToast(err); }
    }));
  });
}

/* ============ APPROVALS ============ */
async function renderApprovals() {
  const clients = (await api('/api/staff/clients?limit=200')).clients;
  const d = await api('/api/staff/approvals?status=pending');
  const rows = d.approvals.map((a) => `<tr><td><b>${esc(a.title)}</b><br/><span class="muted">${esc(a.kind)} · v${a.version}</span></td><td>${esc((state.clientCache[a.client_id] || {}).brand_name ?? a.client_id)}</td><td>${a.preview_url ? `<a href="${esc(a.preview_url)}" target="_blank" rel="noreferrer" style="color:var(--blue)">preview ↗</a>` : '—'}</td><td class="muted">${esc((a.caption ?? '').slice(0, 120))}</td><td>${dt(a.created_at)}</td></tr>`).join('');
  $('#main').innerHTML = `
    <div class="row between"><div><h1>Approval queue</h1><div class="sub">Creatives, captions, calendars and campaign material awaiting client/staff sign-off.</div></div>
      <button class="btn" id="newApprovalBtn">+ Send for approval</button></div>
    <div class="panel"><table><thead><tr><th>Item</th><th>Client</th><th>Preview</th><th>Caption</th><th>Sent</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Nothing pending. Nothing ships without sign-off.</td></tr>'}</tbody></table></div>`;
  $('#newApprovalBtn').addEventListener('click', () => {
    openModal('Send for approval', `<div class="formgrid">
      ${selectField('client_id', 'Client', clients.map((c) => [c.id, c.brand_name]), 'full')}
      ${selectField('kind', 'Kind', [['creative', 'Creative'], ['caption', 'Caption'], ['campaign', 'Campaign material'], ['calendar', 'Content calendar'], ['other', 'Other']])}
      ${field('title', 'Title *', 'text', 'full')}
      ${field('preview_url', 'Preview link (Drive/storage URL)', 'url', 'full')}
      <div class="full"><label>Caption / notes</label><textarea name="caption"></textarea></div>
    </div>`, async (fd) => {
      const body = Object.fromEntries(fd);
      await api('/api/staff/approvals', { method: 'POST', body });
      toast('Sent for approval');
      renderApprovals();
    });
  });
}

/* ============ FINANCE ============ */
async function renderFinance() {
  const f = await api('/api/staff/finance');
  const inv = await api('/api/staff/invoices?status=sent');
  const invPaid = await api('/api/staff/invoices?status=paid');
  const invoiceRow = (i) => `<tr><td><b>${esc(i.number)}</b><br/><span class="muted">${esc(i.kind)}</span></td><td>${esc(i.client_id.slice(0, 8))}…</td><td>${money(i.total_inr)}</td><td>${esc(day(i.due_at))}</td><td>${pill(i.status, i.status === 'paid' ? 'good' : i.status === 'overdue' ? 'bad' : '')}</td><td class="row" style="gap:4px"><button class="btn sec small" data-download="${i.id}">Invoice</button>${i.status === 'sent' || i.status === 'overdue' ? `<button class="btn small" data-paid="${i.id}">Mark paid</button>` : ''}${i.status === 'draft' ? `<button class="btn sec small" data-send="${i.id}">Mark sent</button>` : ''}</td></tr>`;
  const expenses = f.expenses.map((e) => `<tr><td>${esc(day(e.incurred_at))}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td class="r">${money(e.amount_inr)}</td><td>${e.recurring ? pill('recurring', 'blue') : ''}</td></tr>`).join('');
  $('#main').innerHTML = `
    <h1>Financial management</h1><div class="sub">Service revenue only. Advertising budgets (client-funded) are tracked separately and never counted as SEAI revenue or profit.</div>
    <div class="grid cards">
      ${statCard('MRR (service fees)', money(f.mrr), `${f.activeAgreements} active agreements`)}
      ${statCard('Outstanding — service', money(f.outstandingService), 'Sent + overdue invoices')}
      ${statCard('Outstanding — ad budgets', money(f.outstandingAdBudget), 'Client-funded, separate')}
      ${statCard('Ad budgets in play', money(f.adBudgets), 'Monthly, client-funded')}
      ${statCard('One-time revenue (paid)', money(f.oneTimePaid), 'Projects billed & collected')}
      ${statCard('Service revenue (paid)', money(f.servicePaid), 'Retainers collected to date')}
      ${statCard('Expenses recorded', money(f.expenseTotal), 'Payroll + contractors + software')}
    </div>
    <div class="panel" style="margin-top:14px"><div class="row between"><h2>Outstanding invoices</h2><button class="btn sec small" id="newExpenseBtn">+ Record expense</button></div>
      <table><thead><tr><th>Invoice</th><th>Client</th><th>Total</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>${inv.invoices.slice(0, 15).map(invoiceRow).join('') || '<tr><td colspan="6" class="empty">Nothing outstanding. 🎉</td></tr>'}</tbody></table>
    </div>
    <div class="panel"><h2>Recently paid</h2><table><thead><tr><th>Invoice</th><th>Client</th><th>Total</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>${invPaid.invoices.slice(0, 10).map(invoiceRow).join('') || '<tr><td colspan="6" class="empty">No payments recorded yet.</td></tr>'}</tbody></table></div>
    <div class="panel"><h2>Expenses (latest 100)</h2><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="r">Amount</th><th></th></tr></thead><tbody>${expenses || '<tr><td colspan="5" class="empty">No expenses recorded.</td></tr>'}</tbody></table></div>`;
  $$('#main [data-download]').forEach((b) => b.addEventListener('click', () => window.open('/api/staff/invoices/' + b.dataset.download + '/download', '_blank')));
  $$('#main [data-paid]').forEach((b) => b.addEventListener('click', async () => {
    const ref = prompt('Razorpay payment ID (optional — leave blank for manual/bank)', '');
    try { await api('/api/staff/invoices/' + b.dataset.paid + '/paid', { method: 'POST', body: { razorpay_payment_id: ref || undefined } }); toast('Marked paid'); renderFinance(); } catch (err) { errToast(err); }
  }));
  $$('#main [data-send]').forEach((b) => b.addEventListener('click', async () => { try { await api('/api/staff/invoices/' + b.dataset.send + '/send', { method: 'POST' }); renderFinance(); } catch (err) { errToast(err); } }));
  $('#newExpenseBtn').addEventListener('click', () => {
    openModal('Record expense', `<div class="formgrid">
      ${selectField('category', 'Category', [['payroll', 'Payroll'], ['contractor', 'Contractor'], ['software', 'Software'], ['tools', 'Tools'], ['office', 'Office'], ['other', 'Other']])}
      ${field('description', 'Description *', 'text', 'full')}
      ${field('amount_inr', 'Amount (₹) *', 'number')}${field('incurred_at', 'Date', 'date')}
      <label style="grid-column:1/-1;display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" name="recurring" style="width:auto"/> Recurring monthly</label>
    </div>`, async (fd) => {
      const body = Object.fromEntries(fd);
      await api('/api/staff/expenses', { method: 'POST', body: { ...body, amount_inr: Number(body.amount_inr), recurring: fd.get('recurring') === 'on' } });
      toast('Expense recorded');
      renderFinance();
    });
  });
}

/* ============ CAMPAIGNS (manual reporting) ============ */
async function renderCampaigns() {
  const clients = (await api('/api/staff/clients?limit=200')).clients;
  $('#main').innerHTML = `
    <h1>Campaign reporting</h1><div class="sub">Manual entries are labelled “manual”. Live Meta/Google API sync is not connected — numbers shown are operator-entered and always carry their source. Nothing is invented.</div>
    <div class="panel"><h2>Log / update a campaign period</h2><form id="campaignForm" class="formgrid">
      ${selectField('client_id', 'Client', clients.map((c) => [c.id, c.brand_name]), 'full')}
      ${field('campaign_name', 'Campaign name *', 'text', 'full')}
      ${selectField('platform', 'Platform', [['meta', 'Meta (FB/IG)'], ['google', 'Google Ads'], ['youtube', 'YouTube'], ['other', 'Other']])}
      ${selectField('status', 'Status', [['active', 'active'], ['paused', 'paused'], ['ended', 'ended']])}
      ${field('period_start', 'Period start', 'date')}${field('period_end', 'Period end', 'date')}
      ${field('spend_inr', 'Spend (₹)', 'number')}${field('reach', 'Reach', 'number')}
      ${field('impressions', 'Impressions', 'number')}${field('clicks', 'Clicks', 'number')}
      ${field('leads', 'Leads', 'number')}${field('conversions', 'Conversions', 'number')}
      ${selectField('data_source', 'Data source', [['manual', 'manual (operator-entered)']])}
      <div class="full"><label>Notes</label><textarea name="notes"></textarea></div>
      <div class="full"><button class="btn" type="submit">Save report</button></div>
    </form></div>
    <div class="panel"><h2>How to read this</h2><p class="muted" style="font-size:12px">CPL is computed as spend ÷ leads when both are entered. “meta_api”/“google_ads_api” sources appear only once those integrations are connected — they are never back-filled with estimates. Client dashboards show the same source label.</p></div>`;
  $('#campaignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    try { await api('/api/staff/campaign-reports', { method: 'POST', body }); toast('Report saved'); e.target.reset(); } catch (err) { errToast(err); }
  });
}

/* ============ SUPPORT ============ */
async function renderSupport() {
  const d = await api('/api/staff/support');
  const rows = d.requests.map((r) => `<tr data-id="${r.id}" style="cursor:pointer"><td><b>${esc(r.subject)}</b><br/><span class="muted">${esc(r.client_id.slice(0, 8))}… · ${dt(r.updated_at)}</span></td><td style="max-width:340px">${esc(r.body).slice(0, 220)}</td><td>${pill(r.status, r.status === 'open' ? 'new' : r.status === 'resolved' ? 'good' : '')}</td></tr>`).join('');
  $('#main').innerHTML = `<h1>Support queue</h1><div class="sub">Client support requests. Reply inline; status moves open → in_progress → resolved/closed.</div>
    <div class="panel"><table><thead><tr><th>Request</th><th>Details</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty">No requests. Good sign (or nobody has your pager).</td></tr>'}</tbody></table></div>`;
  $$('#main tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
    const id = tr.dataset.id;
    const reply = prompt('Reply to client (empty to cancel):');
    if (!reply) return;
    try { await api(`/api/staff/support/${id}/messages`, { method: 'POST', body: { body: reply, status: 'in_progress' } }); toast('Reply sent'); renderSupport(); } catch (err) { errToast(err); }
  }));
}

/* ============ STAFF & ROLES (admin) ============ */
async function renderStaff() {
  const d = await api('/api/staff/users');
  const ROLES = ['customer','admin','sales','account_manager','marketing','designer','developer','finance'];
  const rows = d.users.map((u) => `<tr><td><b>${esc(u.full_name)}</b><br/><span class="muted">${esc(u.email)}</span></td><td>${u.email_verified ? pill('verified', 'good') : pill('unverified', 'warn')}</td><td><select data-role-for="${u.id}">${ROLES.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('');
  $('#main').innerHTML = `<h1>Staff & permissions</h1><div class="sub">Role-based access. Admins can grant/revoke roles. Admin role is unrestricted; others are capability-scoped per route on the server.</div>
    <div class="panel"><table><thead><tr><th>User</th><th>Email</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table><p class="foot">Promotion path: sign up at /create-account → admin sets role here. There is no self-service staff signup.</p></div>`;
  $$('#main select[data-role-for]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await api('/api/staff/users/' + sel.dataset.roleFor + '/role', { method: 'PATCH', body: { role: sel.value } }); toast('Role updated'); } catch (err) { errToast(err); renderStaff(); }
  }));
}

/* ============ boot ============ */
(async function boot() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    const role = state.user?.role ?? 'customer';
    if (role === 'customer') {
      $('#main').innerHTML = '<div class="empty">This area is for SEAI staff. Your account is a client account — head to <a href="/overview" style="color:var(--blue)">your dashboard</a> instead.</div>';
      $('#nav').innerHTML = '';
      $('#roleChip').textContent = 'client';
      return;
    }
    $('#whoName').textContent = state.user.fullName ?? state.user.email;
    $('#whoRole').textContent = role.replace('_', ' ');
    $('#roleChip').textContent = role.replace('_', ' ');
    renderNav();
    go('overview');
  } catch (err) {
    $('#main').innerHTML = '<div class="empty">Your session expired. <a href="/sign-in" style="color:var(--blue)">Sign in again</a>.</div>';
  }
})();

$('#drawerClose').addEventListener('click', closeDrawer);
$('#modalCancel').addEventListener('click', () => $('#modal').classList.remove('open'));
$('#signOut').addEventListener('click', async () => { try { await fetch('/api/auth/sign-out', { method: 'POST' }); } finally { window.location = '/sign-in'; } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); $('#modal').classList.remove('open'); } });
