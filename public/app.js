/* SEAI VX — quiet client. No fake data: every section renders live API state or an honest empty state. */
'use strict';
const T = window.SEAI_TXT;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortModel = (n) => { if (!n) return '—'; const m = String(n).split('/').pop(); return m.length > 26 ? m.slice(0, 25) + '…' : m; };
const ago = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
const asObj = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

async function j(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) {
    // Session expired or not authenticated — redirect to sign-in
    localStorage.removeItem('seai-active-shop');
    location.href = '/sign-in';
    throw new Error('Not authenticated');
  }
  if (!r.ok) throw new Error('Request failed (' + r.status + ')');
  return r.json();
}

/* ---------- authentication ---------- */
const Auth = {
  user: null,
  async check() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('not authenticated');
      const data = await r.json();
      this.user = data.user;
      return true;
    } catch {
      this.user = null;
      return false;
    }
  },
  async signOut() {
    try { await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
    this.user = null;
    localStorage.removeItem('seai-active-shop');
    location.href = '/sign-in';
  },
};

/* ---------- store state: ONE source of truth ----------
 * storeSlot  — portfolio slot (Store 01..06), not a store until bound+connected
 * connection — a verified Shopify OAuth session (the ONLY thing that is "connected")
 * active     — the connection currently being operated (must be connected) */
const Store = {
  connections: [],
  active: null,
  loaded: false,
  async load() {
    const r = await j('/api/stores').catch(() => ({ connections: [] }));
    this.connections = r.connections || [];
    const saved = (localStorage.getItem('seai-active-shop') || '').trim().toLowerCase();
    // Adopt saved/active shop ONLY if it is a bare domain with a live connection.
    // Admin URLs, paths, and unconnected domains are discarded — never displayed.
    this.active = this.connections.some((c) => c.shop === saved) ? saved : null;
    if (!this.active) localStorage.removeItem('seai-active-shop');
    const q = (new URLSearchParams(location.search).get('shop') || '').trim().toLowerCase();
    if (q && this.connections.some((c) => c.shop === q)) {
      this.active = q;
      localStorage.setItem('seai-active-shop', q);
    }
    this.loaded = true;
    paintChrome();
  },
  connection() { return this.connections.find((c) => c.shop === this.active) || null; },
  set(shop) {
    const v = String(shop || '').trim().toLowerCase();
    if (!this.connections.some((c) => c.shop === v)) return false;
    this.active = v;
    localStorage.setItem('seai-active-shop', v);
    paintChrome();
    return true;
  },
};
/* façade kept for view code */
const shop = {
  get() { return Store.active || ''; },
  set(v) { return Store.set(v); },
};

function paintChrome() {
  const c = Store.connection();
  $('hm-store').textContent = c ? c.name : 'No store';
  loadSwitcher();
}

function validShopDomain(v) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(v || '').trim().toLowerCase());
}
function connectShop(domain) {
  const v = String(domain || '').trim().toLowerCase();
  if (!validShopDomain(v)) { toast('Enter your bare store domain, like my-store.myshopify.com.'); return false; }
  location.href = '/auth?shop=' + encodeURIComponent(v);
  return true;
}

/* ---------- toast ---------- */
let toastT = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------- theme (dark default) ---------- */
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('seai-theme', t); } catch { /* ignore */ } }
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('seai-theme'); } catch { /* ignore */ }
  setTheme(t === 'light' ? 'light' : 'dark');
})();
$('theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
});

/* ---------- cached shared state ---------- */
const cache = { at: 0, health: null, models: null, tools: null };
async function shared() {
  if (Date.now() - cache.at < 15000 && cache.health) return cache;
  const [health, models, tools] = await Promise.all([
    j('/api/health').catch(() => null),
    j('/api/models').catch(() => null),
    j('/api/tools').catch(() => null),
  ]);
  Object.assign(cache, { at: Date.now(), health, models, tools });
  const s = shop.get();
  $('hm-store').textContent = s || 'Not connected';
  const m = models ? (models.primary || models.best) : null;
  $('hm-model').textContent = shortModel(m);
  $('hm-autonomy').textContent = health ? T.autonomy(health.autonomy) : '—';
  return cache;
}

const sec = (eyebrow, inner) => '<section class="sec"><p class="eyebrow">' + eyebrow + '</p>' + inner + '</section>';
const empty = (title, body) => '<div class="empty"><p class="h2">' + title + '</p><p class="body-s" style="margin:6px 0 0">' + body + '</p></div>';
const dotFor = (ok, extra) => {
  if (ok === true) return '<span class="dot ok" aria-hidden="true"></span>';
  if (ok === false) return '<span class="dot bad" aria-hidden="true"></span>';
  return '<span class="dot" aria-hidden="true"></span>';
};

/* ============================================================ views */
const views = {};

/* ---------- OVERVIEW ---------- */
views.overview = {
  title: 'Overview — SEAI',
  async render(el) {
    const { health, models } = await shared();
    const s = shop.get();
    const h = new Date().getHours();
    const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const who = ((health && health.operator) || '').trim() || 'there';
    let html = '<p class="eyebrow">Overview</p><h1 class="display">' + greet + ', ' + esc(who) + '.</h1>' +
      '<p class="lede">' + (s ? 'Operating <strong>' + esc(s) + '</strong>. Here is what SEAI knows right now.' : 'Connect a store and SEAI will begin operating it — observing, reasoning, and acting under policy.') + '</p>';

    /* attention */
    let attn = '';
    if (!s) {
      attn = '<div class="row"><span class="l">No store connected</span><span class="r"><a href="/command" data-nav style="color:var(--ink)">Connect in Command →</a></span></div>';
    } else {
      const [runsR, expR] = await Promise.all([
        j('/api/runs?storeId=' + encodeURIComponent(s)).catch(() => ({ runs: [] })),
        j('/api/experiments?storeId=' + encodeURIComponent(s)).catch(() => ({ experiments: [] })),
      ]);
      const runs = runsR.runs || [];
      const open = (expR.experiments || []).filter((e) => e.status === 'running').length;
      const unhealthy = health ? health.ollama.keys.filter((k) => k.status !== 'healthy').length : 0;
      if (unhealthy > 0) attn += '<div class="row"><span class="l">' + dotFor(false) + unhealthy + ' of 6 AI keys need attention</span><span class="r"><a href="/provider" data-nav style="color:var(--ink)">Provider →</a></span></div>';
      if (!runs.length) attn += '<div class="row"><span class="l">No analysis yet</span><span class="r">Run your first command below</span></div>';
      else {
        const last = runs[0];
        attn += '<div class="row"><span class="l">' + esc((last.summary || T.kind(last.kind)).split('\n')[0].slice(0, 110)) + '</span><span class="r">' + esc(T.status(last.status)) + ' · ' + ago(last.started_at || last.created_at) + '</span></div>';
      }
      if (open > 0) attn += '<div class="row"><span class="l">' + open + ' experiment' + (open > 1 ? 's' : '') + ' running</span><span class="r"><a href="/activity" data-nav style="color:var(--ink)">Activity →</a></span></div>';
      if (!attn) attn = '<div class="row"><span class="l">All quiet</span><span class="r">Nothing needs you right now</span></div>';
    }
    html += sec('What needs attention', '<div class="rows">' + attn + '</div>');

    /* opportunities from real decisions */
    let opp = '';
    if (s) {
      const d = await j('/api/decisions?storeId=' + encodeURIComponent(s)).catch(() => ({ decisions: [] }));
      opp = (d.decisions || []).filter((x) => (x.execution_status || 'proposed') === 'proposed').slice(0, 3).map((x) =>
        '<div class="row"><span class="l">' + esc(asText(x.proposed_action).slice(0, 120)) + '</span><span class="r">confidence ' + Math.round(Number(x.confidence || 0) * 100) + '%</span></div>'
      ).join('');
    }
    html += sec('Opportunities', opp ? '<div class="rows">' + opp + '</div>' : '<p class="body-s">No open opportunities recorded. SEAI proposes them as it investigates.</p>');

    /* recent activity */
    let act = '';
    if (s) {
      const r = await j('/api/runs?storeId=' + encodeURIComponent(s)).catch(() => ({ runs: [] }));
      act = (r.runs || []).slice(0, 4).map((x) =>
        '<div class="row"><span class="l">' + esc(T.kind(x.kind)) + ' — ' + esc((x.summary || T.status(x.status)).split('\n')[0].slice(0, 90)) + '</span><span class="r">' + ago(x.started_at || x.created_at) + '</span></div>'
      ).join('');
    }
    html += sec('Recent activity', act ? '<div class="rows">' + act + '</div>' : '<p class="body-s">Nothing yet.</p>');

    /* performance: real run aggregates only */
    let perf = '';
    if (s) {
      const r = await j('/api/runs?storeId=' + encodeURIComponent(s)).catch(() => ({ runs: [] }));
      const runs = r.runs || [];
      const done = runs.filter((x) => x.status === 'completed').length;
      perf = '<div class="row"><span class="l">Runs recorded</span><span class="r tnum"><span class="strong" style="color:var(--ink)">' + runs.length + '</span> · ' + done + ' completed</span></div>';
      if (runs[0]) perf += '<div class="row"><span class="l">Last run</span><span class="r">' + esc(T.status(runs[0].status)) + ' · ' + esc(shortModel(runs[0].model)) + ' · ' + ago(runs[0].started_at || runs[0].created_at) + '</span></div>';
    } else perf = '<p class="body-s">Performance appears once SEAI runs against a store.</p>';
    html += sec('Performance', perf.startsWith('<p') ? perf : '<div class="rows">' + perf + '</div>');

    /* system status */
    const hk = health ? health.ollama.keys.filter((k) => k.status === 'healthy').length : 0;
    html += sec('System status',
      '<div class="rows">' +
      '<div class="row"><span class="l">' + dotFor(health && hk === 6) + 'Provider</span><span class="r tnum">' + hk + ' / 6 healthy</span></div>' +
      '<div class="row"><span class="l">' + dotFor(!!(models && (models.primary || models.best))) + 'Model</span><span class="r">' + esc(shortModel(models && (models.primary || models.best))) + '</span></div>' +
      '<div class="row"><span class="l">' + dotFor(!!health) + 'Autonomy</span><span class="r">' + esc(health ? T.autonomy(health.autonomy) : '—') + '</span></div>' +
      '</div>');
    el.innerHTML = html;
  },
};

/* ---------- COMMAND ---------- */
const STAGES = [
  { id: 'understand', label: 'Understanding request' },
  { id: 'store', label: 'Inspecting store', tools: ['store.get', 'themes.get'] },
  { id: 'products', label: 'Analyzing products', tools: ['products.', 'collections.', 'content.'] },
  { id: 'orders', label: 'Checking orders', tools: ['orders.', 'analytics.'] },
  { id: 'customers', label: 'Reviewing customers', tools: ['customers.'] },
  { id: 'inventory', label: 'Evaluating inventory', tools: ['inventory.'] },
  { id: 'discounts', label: 'Checking discounts', tools: ['discounts.'] },
  { id: 'recommend', label: 'Forming recommendation', tools: ['experiments.', 'strategy.', 'portfolio.'] },
];
const EXAMPLES = ['Analyze my store', 'Build my store from scratch', 'Find our biggest growth opportunity', 'Why did sales change?', 'Review inventory risk', 'Show me what SEAI changed'];
let cmdTimer = null;

views.command = {
  title: 'Command — SEAI',
  async render(el) {
    const { health, models } = await shared();
    const c = Store.connection();
    const hk = health ? health.ollama.keys.filter((k) => k.status === 'healthy').length : 0;
    const active = models ? (models.primary || models.best) : null;

    let context;
    if (!c) {
      context =
        '<div class="cmd" style="padding:26px 24px;margin-top:26px"><p class="eyebrow">Store</p>' +
        '<p class="h2">No Shopify store connected.</p>' +
        '<p class="body-s" style="margin:8px 0 18px;max-width:52ch">Connect a Shopify store to give SEAI access to your commerce system. Shopify commands require a connected store.</p>' +
        '<div style="display:flex;gap:10px;max-width:480px"><input class="input" id="c-domain" type="text" placeholder="my-store.myshopify.com" autocomplete="off" spellcheck="false" aria-label="Store domain" />' +
        '<button class="btn" id="c-connect">Connect Shopify</button></div></div>';
    } else {
      context =
        '<div class="rows" style="margin-top:26px">' +
        '<div class="row"><span class="l">Store</span><span class="r"><span style="color:var(--ink);font-weight:600">' + esc(c.name) + '</span> · ' + esc(c.shop) + ' · Connected</span></div>' +
        '<div class="row"><span class="l">Model</span><span class="r">' + esc(shortModel(active)) + '</span></div>' +
        '<div class="row"><span class="l">Autonomy</span><span class="r">' + esc(health ? T.autonomy(health.autonomy) : '—') + '</span></div>' +
        '<div class="row"><span class="l">Provider</span><span class="r tnum">' + hk + ' / 6 healthy</span></div>' +
        '</div>';
    }

    el.innerHTML =
      '<p class="eyebrow">Command</p><h1 class="display">What should SEAI do?</h1>' +
      '<p class="lede">Tell SEAI what you want done. It will investigate, decide, and act within your autonomy policy.</p>' +
      context +
      '<div class="cmd" style="margin-top:18px;opacity:' + (c ? '1' : '.55') + '"><label class="meta-s" for="c-cmd" style="position:absolute;left:-999px">Command</label>' +
      '<textarea id="c-cmd" rows="2" placeholder="' + (c ? 'Ask SEAI anything about your business…' : 'Connect a store to begin…') + '"' + (c ? '' : ' disabled') + '>Analyze my store.</textarea>' +
      '<div class="cmd-bar"><span class="switchrow"><input class="switch" type="checkbox" id="c-confirm"' + (c ? '' : ' disabled') + ' /><label for="c-confirm">Authorize writes for this run</label></span>' +
      '<span class="sp"></span><span class="meta-s"><kbd>↵</kbd> to run</span>' +
      '<button class="btn" id="c-run"' + (c ? '' : ' disabled') + '>Run</button></div></div>' +
      '<div class="examples">' + EXAMPLES.map((q) => '<button class="ex"' + (c ? '' : ' disabled style="opacity:.45;cursor:default"') + '>' + esc(q) + '</button>').join('') + '</div>' +
      '<div id="c-live" aria-live="polite"></div>';

    if (!c) {
      $('c-connect').addEventListener('click', () => connectShop($('c-domain').value));
      $('c-domain').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectShop($('c-domain').value); });
      return;
    }
    const ta = $('c-cmd');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runCommand(); } });
    el.querySelectorAll('.ex').forEach((b) => { b.addEventListener('click', () => {
      if (b.textContent === 'Build my store from scratch') { startBuild(); return; }
      ta.value = b.textContent; runCommand();
    }); });
    $('c-run').addEventListener('click', runCommand);
  },
  unmount() { clearInterval(cmdTimer); cmdTimer = null; },
};

function stageOf(tool) {
  for (let i = 1; i < STAGES.length; i++) {
    if ((STAGES[i].tools || []).some((p) => tool.startsWith(p))) return i;
  }
  return STAGES.length - 1;
}

async function runCommand() {
  const conn = Store.connection();
  if (!conn) { toast('Connect a Shopify store before running this command.'); return; }
  const s = conn.shop;
  const prompt = $('c-cmd').value.trim() || 'Analyze my store.';
  const confirmed = $('c-confirm').checked;
  const runBtn = $('c-run');
  runBtn.disabled = true;
  const live = $('c-live');
  const state = { reached: new Set([0]), blocked: false, done: false };
  const paint = () => {
    const mx = Math.max(...state.reached);
    live.innerHTML = '<p class="eyebrow" style="margin:26px 0 4px">' + esc(prompt.slice(0, 90)) + '</p>' +
      '<ol class="tl">' + STAGES.map((st, i) => {
        let cls, sub = '';
        if (state.done) { cls = state.reached.has(i) ? 'done' : ''; sub = state.reached.has(i) ? 'Complete' : 'Queued'; }
        else if (i === mx) { cls = state.blocked ? 'blocked' : 'active'; sub = state.blocked ? 'Waiting — policy requires approval' : 'Running'; }
        else if (state.reached.has(i)) { cls = 'done'; sub = 'Complete'; }
        else { cls = 'wait'; sub = 'Queued'; }
        return '<li class="' + cls + '"><span class="p" aria-hidden="true"></span><div class="t">' + st.label + '</div><div class="s">' + sub + '</div></li>';
      }).join('') + '</ol><div id="c-result"></div>';
  };
  paint();
  const resultHtml = async (runId, summary, meta) => {
    const d = await j('/api/runs/' + runId).catch(() => ({ toolCalls: [] }));
    const calls = d.toolCalls || [];
    (calls || []).forEach((t) => state.reached.add(stageOf(t.tool)));
    const reads = calls.filter((t) => t.ok && !isWrite(t.tool));
    const writes = calls.filter((t) => isWrite(t.tool));
    const ev = reads.slice(0, 6).map((t) => {
      let n = '';
      const r = asObj(t.result);
      if (Array.isArray(r)) n = r.length + ' records';
      else if (r && typeof r === 'object') n = Object.keys(r).length + ' fields';
      return esc(T.tool(t.tool)) + (n ? ' — ' + n : '');
    });
    let decision = 'No change proposed.';
    try {
      const dd = await j('/api/decisions?storeId=' + encodeURIComponent(s)).catch(() => ({ decisions: [] }));
      const latest = (dd.decisions || [])[0];
      if (latest && latest.proposed_action) decision = asText(latest.proposed_action).slice(0, 300) + ' (confidence ' + Math.round(Number(latest.confidence || 0) * 100) + '%)';
    } catch { /* ignore */ }
    const paras = String(summary || '').split(/\n\n+/);
    $('c-result').innerHTML =
      '<div class="rows" style="margin-top:8px">' +
      '<div class="row"><span class="l">Finding</span></div><p class="body-s" style="margin:0 0 6px">' + esc(paras[0] || summary || 'Done.') + '</p>' +
      (ev.length ? '<div class="row"><span class="l">Evidence</span></div><p class="body-s" style="margin:0 0 6px">' + ev.join('<br/>') + '</p>' : '') +
      '<div class="row"><span class="l">Decision</span></div><p class="body-s" style="margin:0 0 6px">' + esc(decision) + '</p>' +
      '<div class="row"><span class="l">Action</span></div><p class="body-s" style="margin:0 0 6px">' + (writes.length ? writes.map((t) => esc(T.tool(t.tool)) + ' — ' + (t.ok ? 'done' : 'not done')).join('<br/>') : 'No changes made. Read-only pass.') + '</p>' +
      '<div class="row"><span class="l">Result</span></div><p class="body-s" style="margin:0">' + esc(paras[1] || 'Measured on the next cycle.') + '</p>' +
      '</div><p class="meta-s" style="margin-top:10px">' + esc(meta) + '</p>';
  };
  let runId = null;
  try {
    const started = fetch('/api/agent/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop: s, prompt, confirmed }) })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = new Error((body && body.error) || 'Request failed (' + r.status + ')');
          err.code = body && body.code;
          throw err;
        }
        return body;
      });
    const discover = async () => {
      const r = await j('/api/runs?storeId=' + encodeURIComponent(s)).catch(() => null);
      return r && r.runs && r.runs[0] ? r.runs[0].id : null;
    };
    const p = started.then((r) => { runId = r.runId; return r; });
    cmdTimer = setInterval(async () => {
      try {
        if (!runId) runId = await discover();
        if (!runId) return;
        const d = await j('/api/runs/' + runId).catch(() => null);
        if (!d) return;
        (d.toolCalls || []).forEach((t) => {
          state.reached.add(stageOf(t.tool));
          if (!t.ok && /policy|confirmation/i.test(asText(t.result))) state.blocked = true;
        });
        if ((d.toolCalls || []).length) paint();
      } catch { /* keep polling */ }
    }, 1800);
    const r = await p;
    clearInterval(cmdTimer); cmdTimer = null;
    state.done = true;
    paint();
    await resultHtml(r.runId, r.summary, r.iterations + ' iterations · ' + shortModel(r.model) + ' · ' + T.status(r.status));
    toast('Run ' + T.status(r.status) + '.');
  } catch (e) {
    clearInterval(cmdTimer); cmdTimer = null;
    if (e && e.code === 'NO_STORE_CONNECTED') {
      await Store.load();
      if ($('c-live')) $('c-live').innerHTML = '<div class="empty"><p class="h2">No Shopify store connected.</p><p class="body-s">Connect a Shopify store to give SEAI access to your commerce system.</p></div>';
    } else if ($('c-live')) {
      live.innerHTML = '<div class="empty"><p class="h2">Run failed</p><p class="body-s">' + esc(e.message) + '</p></div>';
    }
  } finally {
    if (runBtn && runBtn.isConnected) runBtn.disabled = false;
  }
}

/* ---------- ACTIVITY ---------- */
views.activity = {
  title: 'Activity — SEAI',
  async render(el) {
    const s = shop.get();
    if (!s) {
      el.innerHTML = '<p class="eyebrow">Activity</p><h1 class="display">Operational trace.</h1>' +
        '<p class="lede">Connect a store and every investigation, decision, and action will be recorded here.</p>' +
        sec('Runs', empty('No store connected', 'Activity appears after SEAI runs against a connected store.')) +
        '<div style="margin-top:18px"><a class="btn-quiet" href="/command" data-nav style="text-decoration:none;display:inline-block">Go to Command</a></div>';
      el.querySelectorAll('a[data-nav]').forEach((a) => a.addEventListener('click', nav));
      return;
    }
    const q = '?storeId=' + encodeURIComponent(s);
    const r = await j('/api/runs' + q).catch(() => ({ runs: [] }));
    const runs = r.runs || [];
    let html = '<p class="eyebrow">Activity</p><h1 class="display">Operational trace.</h1>' +
      '<p class="lede">Everything SEAI did on <strong>' + esc((Store.connection() || {}).name || s) + '</strong>, in business terms.</p>';
    if (!runs.length) { el.innerHTML = html + sec('Runs', empty('No activity yet', 'Issue a command and SEAI will record every investigation, decision, and action here.')); return; }
    const items = await Promise.all(runs.slice(0, 10).map(async (run) => {
      const d = await j('/api/runs/' + run.id).catch(() => ({ toolCalls: [] }));
      const calls = d.toolCalls || [];
      const reads = calls.filter((t) => t.ok && !isWrite(t.tool));
      const writes = calls.filter((t) => isWrite(t.tool));
      const blocked = calls.filter((t) => !t.ok);
      const firstLine = (run.summary || T.kind(run.kind)).split('\n')[0].slice(0, 140);
      return '<article class="act"><p class="what">' + esc(firstLine) + '</p>' +
        '<p class="when">' + esc(T.status(run.status)) + ' · ' + ago(run.started_at || run.created_at) + ' · ' + esc(shortModel(run.model)) + ' · ' + calls.length + ' checks</p>' +
        '<details><summary>Evidence, decision, action</summary><div class="ev">' +
        '<div><b>SEAI investigated</b>' + (reads.length ? reads.length + ' checks across ' + [...new Set(reads.map((t) => T.groupWord(t.tool.split('.')[0])))].join(', ') : '—') + '</div>' +
        '<div><b>SEAI found</b>' + esc((run.summary || 'No summary recorded.').split('\n').slice(0, 3).join(' ').slice(0, 280)) + '</div>' +
        '<div><b>SEAI executed</b>' + (writes.length ? writes.map((t) => esc(T.tool(t.tool)) + ' — ' + (t.ok ? 'done' : 'not done')).join('; ') : 'No changes made. Read-only pass.') + '</div>' +
        (blocked.length ? '<div><b>Held for approval</b>' + blocked.map((t) => esc(T.tool(t.tool))).join(', ') + '</div>' : '') +
        '<details class="adv"><summary>Raw trace</summary><pre class="code">' + esc(JSON.stringify(calls.map((t) => ({ tool: t.tool, ok: t.ok, policy: t.policy_decision })), null, 1)) + '</pre></details>' +
        '</div></details></article>';
    }));
    el.innerHTML = html + sec('Runs', items.join(''));
  },
};
const isWrite = (tool) => /create|update|archive|disable|rollback/i.test(tool);

/* ---------- PROVIDER ---------- */
views.provider = {
  title: 'Provider — SEAI',
  async render(el) {
    const { health, models } = await shared();
    const keys = health ? health.ollama.keys : [];
    const hk = keys.filter((k) => k.status === 'healthy').length;
    const active = models ? (models.primary || models.best) : null;
    el.innerHTML =
      '<p class="eyebrow">Provider</p><h1 class="display">Ollama Cloud.</h1>' +
      '<p class="display tnum" style="margin-top:26px">' + hk + ' <span style="color:var(--faint);font-size:0.55em;font-weight:500">/ 6 healthy</span></p>' +
      sec('Active model', '<div class="rows"><div class="row"><span class="l">' + esc(shortModel(active)) + '</span><span class="r">' + (models && models.primary ? 'pinned primary' : 'strongest discovered') + '</span></div></div>') +
      sec('Provider health', '<div class="rows">' + (keys.map((k) =>
        '<div class="row"><span class="l">' + dotFor(k.status === 'healthy', k.status) + esc(k.keyId) + '</span><span class="r">' + esc(String(k.status).replace(/_/g, ' ')) + '</span></div>'
      ).join('') || '<p class="body-s">No provider data.</p>') + '</div>' +
      '<div style="margin-top:18px;display:flex;gap:10px"><button class="btn-quiet" id="p-validate">Validate all keys</button></div><div id="p-vout" style="margin-top:8px"></div>') +
      sec('Models', '<div class="rows">' + ((models && models.models || []).slice(0, 10).map((m, i) =>
        '<div class="row"><span class="l tnum" style="color:var(--faint)">' + String(i + 1).padStart(2, '0') + ' &nbsp;' + esc(m.name) + '</span><span class="r">' + esc((m.capabilities || []).map(T.cap).join(' · ') || '—') + '</span></div>'
      ).join('') || '<p class="body-s">Discovery unreachable.</p>') + '</div>' +
      '<details class="adv"><summary>Technical details</summary><pre class="code" id="p-tech">' + esc(JSON.stringify({ keys: keys.map((k) => ({ id: k.keyId, status: k.status, requests: k.requestCount, latencyMs: k.avgLatencyMs })), models: (models && models.models || []).slice(0, 19).map((m) => ({ name: m.name, score: m.score })) }, null, 1)) + '</pre></details>');
    $('p-validate').addEventListener('click', async () => {
      $('p-vout').innerHTML = '<p class="body-s">Validating…</p>';
      try {
        const v = await j('/api/ai/validate', { method: 'POST' });
        const ok = v.keys.filter((k) => k.ok).length;
        $('p-vout').innerHTML = '<p class="body-s">' + ok + ' of 6 keys healthy. Identifiers only — credentials never leave the gateway.</p>';
        cache.at = 0; views.provider.render(el);
      } catch (e) { $('p-vout').innerHTML = '<p class="body-s">Validation failed: ' + esc(e.message) + '</p>'; }
    });
  },
};

/* ---------- TOOLS ---------- */
const GROUPS = [
  ['Store', ['store.', 'themes.']],
  ['Products', ['products.']],
  ['Inventory', ['inventory.']],
  ['Orders', ['orders.']],
  ['Customers', ['customers.']],
  ['Discounts', ['discounts.']],
  ['Collections', ['collections.']],
  ['Store Content', ['content.']],
  ['Analytics', ['analytics.']],
  ['Experiments', ['experiments.']],
  ['Strategy', ['strategy.']],
  ['Portfolio', ['portfolio.']],
];
views.tools = {
  title: 'Tools — SEAI',
  async render(el) {
    const { tools } = await shared();
    const list = (tools && tools.tools) || [];
    const groups = GROUPS.map(([g, prefixes]) => {
      const items = list.filter((t) => prefixes.some((p) => t.name.startsWith(p)));
      if (!items.length) return '';
      return '<p class="eyebrow" style="margin:26px 0 4px">' + g + '</p><div class="rows">' + items.map((t) =>
        '<div class="row"><span class="l">' + esc(T.tool(t.name)) + ' <span style="color:var(--faint);font-weight:400">· ' + esc(T.blurb(t.name, t.description)) + '</span></span>' +
        '<span class="r"><span class="tag">' + esc(T.risk(t.risk)) + '</span> &nbsp;' + esc(T.access(t.confirm, t.reversible)) + '</span></div>'
      ).join('') + '</div>';
    }).join('');
    el.innerHTML = '<p class="eyebrow">Capabilities</p><h1 class="display">Everything SEAI can operate.</h1>' +
      '<p class="lede">Every action SEAI is allowed to take — each one states its risk and whether it needs your approval first. Technical identifiers appear only under Advanced details.</p>' +
      (groups || '<p class="body-s">Registry unreachable.</p>') +
      '<details class="adv"><summary>Advanced details</summary><pre class="code">' + esc(JSON.stringify(list.map((t) => ({ tool: t.name, permission: t.permission, risk: t.risk, confirmation: t.confirm, reversible: t.reversible })), null, 1)) + '</pre></details>';
  },
};

/* ---------- SYSTEM ---------- */
views.system = {
  title: 'System — SEAI',
  async render(el) {
    const { health } = await shared();
    const [admin, stores, scopes] = await Promise.all([
      j('/api/admin/overview').catch(() => null),
      j('/api/stores').catch(() => ({ connections: [] })),
      j('/api/scopes').catch(() => null),
    ]);
    const row = (l, r, ok) => '<div class="row"><span class="l">' + (ok === undefined ? '' : dotFor(ok)) + l + '</span><span class="r">' + r + '</span></div>';
    const queued = admin ? (admin.events || []).filter((e) => e.status === 'queued').length : 0;
    el.innerHTML = '<p class="eyebrow">System</p><h1 class="display">Internals.</h1>' +
      '<p class="lede">Advanced state. Quiet by design — expand anything for detail.</p>' +
      sec('Agent', '<div class="rows">' + row('Autonomy', esc(health ? T.autonomy(health.autonomy) : '—'), true) + row('Runs recorded', String((admin && admin.runs || []).length), true) + '</div>') +
      sec('AI gateway', '<div class="rows">' + row('Keys healthy', (admin ? admin.provider.keys.filter((k) => k.status === 'healthy').length : 0) + ' / 6', true) + row('Active model', esc(shortModel(admin && admin.provider.activeModel)), true) +
      '<details class="adv"><summary>Per-key latency</summary><pre class="code">' + esc(JSON.stringify((admin && admin.aiLatency || []).slice(0, 10), null, 1)) + '</pre></details></div>') +
      sec('Shopify', '<div class="rows">' + row('API version', esc(health ? health.shopify.apiVersion : '—'), true) + row('Connected stores', String((stores.connections || []).length), true) + row('Scopes granted', scopes ? String(scopes.scopes.length) + ' documented' : '—', !!scopes) +
      (scopes ? '<details class="adv"><summary>Scope reasons</summary><pre class="code">' + esc(JSON.stringify(scopes.reasons, null, 1)) + '</pre></details>' : '') + '</div>') +
      sec('Database', '<div class="rows">' + row('Engine', esc(health ? (health.driver === 'pg' ? 'PostgreSQL' : 'Embedded store') : '—'), true) + row('Scope isolation', 'per-store', true) + '</div>') +
      sec('Events', '<div class="rows">' + row('Queued', String(queued), queued === 0) + row('Recent', String((admin && admin.events || []).length) + ' tracked', true) + '</div>') +
      sec('Security', '<div class="rows">' + row('Key exposure', 'masked identifiers only', true) + row('Token storage', 'encrypted at rest', true) + row('Tool arguments', 'schema-validated, allowlisted', true) + '</div>') +
      sec('Observability', '<div class="rows">' + row('Run tracing', 'every run persisted', true) + row('Decision log', 'proposals with evidence', true) + '</div>');
    try {
      const brain = await j('/api/brain').catch(() => null);
      if (brain) {
        const secEl = document.createElement('div');
        secEl.innerHTML = sec('Brain', '<div class="rows">' +
          row('Vault', esc(brain.vault) + ' · ' + brain.notes + ' notes', true) +
          (brain.recent || []).slice(0, 5).map((n) => '<div class="row"><span class="l" style="font-weight:400">' + esc(n.title) + '</span><span class="r">' + esc(n.path.split('/')[0]) + '</span></div>').join('') +
          '</div>');
        $('view').appendChild(secEl);
      }
    } catch { /* brain panel is optional */ }
  },
};

/* ---------- PORTFOLIO ---------- */
views.portfolio = {
  title: 'Portfolio — SEAI',
  async render(el) {
    const p = await j('/api/portfolio').catch(() => null);
    if (!p) { el.innerHTML = '<p class="eyebrow">Portfolio</p><h1 class="display">Unavailable.</h1><p class="lede">Could not load portfolio state.</p>'; return; }
    const stores = p.stores || [];
    const connected = stores.filter((s) => s.status === 'connected').length;
    const names = {};
    try {
      const sc = await j('/api/stores').catch(() => ({ connections: [] }));
      (sc.connections || []).forEach((c) => { names[c.shop] = c.name; });
    } catch { /* ignore */ }
    let html = '<p class="eyebrow">Portfolio</p><h1 class="display">Six stores. One operator.</h1>' +
      '<p class="lede">6 available store slots · ' + connected + ' connected. Each connected store is an independent experiment — isolated data, isolated strategy, shared infrastructure.</p>';
    const ins = p.insights || {};
    html += sec('Standing',
      '<div class="rows">' +
      '<div class="row"><span class="l">Leading</span><span class="r">' + esc(ins.leader || 'No measured revenue yet') + '</span></div>' +
      (ins.leader ? '<div class="row"><span class="l" style="font-weight:400;color:var(--sub)">' + esc(ins.leaderWhy || '') + '</span></div>' : '') +
      '<div class="row"><span class="l">Ranking by measured revenue</span><span class="r tnum">' + (p.ranking || []).join(' · ') + '</span></div>' +
      '</div>');
    html += sec('Stores', '<div class="rows">' + stores.map((s) => {
      const strat = s.strategy ? T.strategy(s.strategy.status) : 'No strategy yet';
      const stateWord = s.status === 'connected' ? 'Connected' : s.status === 'assigned' ? 'Assigned — awaiting authorization' : 'Available';
      const perf = s.revenue !== null ? 'rev ' + s.revenue + ' · ' + s.orders + ' orders · AOV ' + s.aov : (s.status === 'connected' ? 'Connected · not yet measured' : 'No metrics — nothing connected yet');
      const right = s.status === 'available'
        ? '<span class="r"><input class="input" data-assign="' + s.slot + '" placeholder="store.myshopify.com" style="width:190px;display:inline-block;padding:6px 10px;font-size:12.5px" aria-label="Assign shop to ' + esc(s.label) + '" /> <button class="btn-quiet" data-bind="' + s.slot + '" style="padding:6px 12px;font-size:12.5px">Assign</button></span>'
        : s.status === 'connected'
          ? '<span class="r"><a href="/overview" data-nav data-shop="' + esc(s.shop) + '" style="color:var(--ink)">Open →</a></span>'
          : '<span class="r">Awaiting authorization</span>';
      const sub = s.status === 'connected'
        ? '<div class="row" style="border-top:none;padding-top:0"><span class="l" style="font-weight:400;color:var(--sub);font-size:13px">' + esc(perf) + ' · ' + s.runs + ' runs · ' + s.experimentsOpen + ' open experiments</span></div>'
        : '';
      const connName = s.shop && names[s.shop] && names[s.shop] !== s.shop ? esc(names[s.shop]) + ' · ' : '';
      return '<div class="row"><span class="l">' + dotFor(s.status === 'connected') + esc(s.label) + ' <span style="color:var(--faint);font-weight:400">· ' + stateWord + (s.shop ? ' · ' + connName + esc(s.shop) : '') + ' · ' + esc(strat) + '</span></span>' + right + '</div>' + sub;
    }).join('') + '</div>');
    const attn = ins.needsAttention || [];
    html += sec('Attention',
      attn.length
        ? '<div class="rows">' + attn.map((a) => '<div class="row"><span class="l">' + esc(a.store) + '</span><span class="r">' + esc(a.reason) + '</span></div>').join('') + '</div>'
        : '<p class="body-s">Nothing needs you right now.</p>');
    html += '<p class="meta-s" style="margin-top:6px">' + esc(ins.note || '') + '</p>';
    el.innerHTML = html;
    el.querySelectorAll('a[data-shop]').forEach((a) => a.addEventListener('click', (e) => { shop.set(a.getAttribute('data-shop')); }));
    el.querySelectorAll('a[data-nav]').forEach((a) => a.addEventListener('click', nav));
    el.querySelectorAll('[data-bind]').forEach((b) => b.addEventListener('click', async () => {
      const slot = b.getAttribute('data-bind');
      const input = el.querySelector('input[data-assign="' + slot + '"]');
      const v = (input.value || '').trim();
      if (!v) { toast('Enter a *.myshopify.com domain.'); return; }
      try {
        await j('/api/portfolio/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: Number(slot), shop: v }) });
        toast('Bound to Store ' + String(slot).padStart(2, '0') + '.');
        render();
      } catch (e) { toast('Assign failed: ' + e.message); }
    }));
  },
};

/* ---------- START (zero-config onboarding: domain + brief, nothing else) ---------- */
views.start = {
  title: 'Build your store — SEAI',
  render(el) {
    el.innerHTML =
      '<p class="eyebrow">Onboarding</p><h1 class="display">Build your store.</h1>' +
      '<p class="lede">Give SEAI the address and tell it what you want. Everything else — research, brand, catalog, storefront, launch — is SEAI.</p>' +
      '<div style="margin-top:30px;max-width:560px"><div class="field"><label for="s-domain">Domain</label>' +
      '<input class="input" id="s-domain" type="text" placeholder="example.com" autocomplete="off" spellcheck="false" /></div>' +
      '<div class="field"><label for="s-context">Store context</label>' +
      '<textarea class="textarea" id="s-context" rows="7" placeholder="Tell SEAI what you want to build.">Describe your business, idea, products, audience, goals, constraints, or anything else you want SEAI to know.</textarea></div>' +
      '<div style="margin-top:18px"><button class="btn" id="s-go">Create with SEAI</button></div>' +
      '<div id="s-out" style="margin-top:16px" aria-live="polite"></div></div>';
    $('s-go').addEventListener('click', async () => {
      const domain = ($('s-domain').value || '').trim();
      const context = ($('s-context').value || '').trim();
      if (!domain || context.length < 20) { toast('Add your domain and a sentence or two about what to build.'); return; }
      $('s-go').disabled = true;
      $('s-out').innerHTML = '<p class="body-s">Understanding your brief…</p>';
      try {
        const r = await j('/api/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain, context }) });
        history.pushState(null, '', '/creation?run=' + r.runId);
        render();
      } catch (e) {
        $('s-go').disabled = false;
        $('s-out').innerHTML = '<div class="empty"><p class="h2">Not yet.</p><p class="body-s">' + esc(e.message) + '</p>' +
          '<div style="margin-top:14px"><a class="btn-quiet" href="/command" data-nav style="text-decoration:none;display:inline-block">Connect a store first</a></div></div>';
        $('s-out').querySelectorAll('a[data-nav]').forEach((a) => a.addEventListener('click', nav));
      }
    });
  },
};

/* ---------- CREATION ---------- */
async function startBuild() {
  const conn = Store.connection();
  if (!conn) { toast('Connect a Shopify store before building.'); return; }
  try {
    const r = await j('/api/creation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop: conn.shop }) });
    history.pushState(null, '', '/creation?run=' + r.runId);
    render();
  } catch (e) { toast('Build failed to start: ' + e.message); }
}

const CREATION_PHASES = [
  ['blueprint', 'Understanding your brief'], ['research', 'Researching the opportunity'],
  ['opportunity', 'Defining the business'], ['brand', 'Creating the brand'],
  ['catalog', 'Creating the catalog'], ['collections', 'Building the storefront'],
  ['storefront', 'Publishing pages & policies'], ['design', 'Styling the storefront'],
  ['domain', 'Configuring commerce'], ['readiness', 'Running final checks'],
  ['launch', 'Preparing launch'], ['optimize', 'Operating the store'],
];
let creationTimer = null;

views.creation = {
  title: 'Creation — SEAI',
  async render(el) {
    const q = new URLSearchParams(location.search).get('run');
    const s = shop.get();
    let run = null;
    if (q) run = (await j('/api/creation/' + encodeURIComponent(q)).catch(() => null))?.run ?? null;
    else if (s) run = (await j('/api/creation?storeId=' + encodeURIComponent(s)).catch(() => ({ run: null }))).run;
    if (!run) {
      el.innerHTML = '<p class="eyebrow">Creation</p><h1 class="display">Build a store from nothing.</h1>' +
        '<p class="lede">SEAI researches an opportunity, creates the brand, builds the catalog and storefront on real Shopify state, verifies launch readiness, then operates the result.</p>' +
        (s
          ? '<div style="margin-top:26px"><button class="btn" id="cr-start">Build ' + esc((Store.connection() || {}).name || s) + '</button></div><p class="body-s" style="margin-top:14px">Research → brand → catalog → storefront → readiness → launch. High-risk steps pause for your approval.</p>'
          : '<div class="empty"><p class="h2">No Shopify store connected.</p><p class="body-s">Connect a store in Command, then build it here.</p></div>');
      const b = $('cr-start');
      if (b) b.addEventListener('click', startBuild);
      return;
    }
    const steps = run.steps || [];
    const byPhase = {};
    steps.forEach((x) => { (byPhase[x.phase] = byPhase[x.phase] || []).push(x); });
    const order = CREATION_PHASES.map(([k]) => k);
    const curIdx = Math.max(0, order.indexOf(run.current_phase));
    const phaseRows = CREATION_PHASES.map(([key, label], i) => {
      const mine = byPhase[key] || [];
      const pend = mine.filter((x) => x.status === 'pending_approval').length;
      const failed = mine.some((x) => x.status === 'failed');
      const st = run.status === 'completed' || i < curIdx || mine.some((x) => ['built', 'declared', 'handoff'].includes(x.kind) && x.status === 'done') || (key === 'readiness' && mine.some((x) => x.kind === 'checklist'))
        ? ['Complete', '']
        : pend ? ['Waiting for approval', 'blocked']
        : failed ? ['Needs attention', 'blocked']
        : i === curIdx ? ['Running', 'active']
        : ['Waiting', 'wait'];
      return '<li class="' + st[1] + '"><span class="p" aria-hidden="true"></span><div class="t">' + label + '</div><div class="s">' + st[0] + (pend ? ' · ' + pend + ' to review' : '') + '</div></li>';
    }).join('');
    const pendAll = steps.filter((x) => x.status === 'pending_approval');
    const rdStep = steps.find((x) => x.phase === 'readiness' && x.kind === 'checklist');
    const rd = rdStep ? (typeof rdStep.result === 'string' ? JSON.parse(rdStep.result) : rdStep.result) : null;
    const statusWord = { running: 'Running', awaiting_approval: 'Awaiting approval', blocked: 'Blocked', completed: 'Completed', failed: 'Failed' }[run.status] || run.status;
    el.innerHTML = '<p class="eyebrow">Creation</p><h1 class="display">' +
      (run.status === 'completed' ? 'Store built.' : run.status === 'awaiting_approval' ? 'Your approval needed.' : run.status === 'blocked' ? 'Blocked.' : run.status === 'failed' ? 'Build halted.' : 'Building the store.') + '</h1>' +
      '<p class="lede">Run ' + esc(String(run.id).slice(0, 8)) + ' · ' + esc(statusWord) + ' · every step below is real Shopify state.</p>' +
      '<ol class="tl">' + phaseRows + '</ol>' +
      (pendAll.length ? '<div class="sec"><p class="eyebrow">Waiting for approval</p>' + pendAll.map((x) => {
        const p = typeof x.payload === 'string' ? JSON.parse(x.payload) : (x.payload || {});
        return '<div class="row"><span class="l">' + esc(describeApproval(p)) + '</span><span class="r"><button class="btn-quiet" data-approve="' + x.id + '" style="padding:6px 14px;font-size:12.5px">Approve</button></span></div>';
      }).join('') + '</div>' : '') +
      (rd ? '<div class="sec"><p class="eyebrow">Launch readiness — ' + (rd.ready ? 'Ready' : 'Blocked') + '</p><div class="rows">' +
        (rd.checks || []).map((c) => '<div class="row"><span class="l">' + (c.pass ? '' : '○ ') + esc(c.name) + '</span><span class="r">' + esc(c.pass ? c.detail : c.detail + ' — ' + c.resolution) + '</span></div>').join('') + '</div></div>' : '') +
      '<div class="sec" id="cr-bp"><p class="eyebrow">SEAI’s understanding</p><p class="body-s">Loading blueprint…</p></div>';
    const bpBox = $('cr-bp');
    if (bpBox && run.store_id) {
      j('/api/blueprint?storeId=' + encodeURIComponent(run.store_id)).then((b) => {
        if (!b || !b.sections || !b.sections.length || !bpBox.isConnected) return;
        bpBox.innerHTML = '<p class="eyebrow">SEAI’s understanding</p>' + b.sections.slice(0, 11).map((sec) =>
          '<p class="eyebrow" style="margin:18px 0 4px">' + esc(sec.section) + '</p><div class="rows">' +
          sec.items.slice(0, 12).map((it) =>
            '<div class="row"><span class="l" style="font-weight:400">' + esc(it.field) + '</span><span class="r" style="max-width:65%">' + esc(String(it.value).slice(0, 220)) + ' <span style="color:var(--faint)">· ' + esc(it.provenance) + '</span></span></div>'
          ).join('') + '</div>'
        ).join('');
      }).catch(() => { if (bpBox.isConnected) bpBox.innerHTML = ''; });
    }
    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await j('/api/creation/' + run.id + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepIds: [b.getAttribute('data-approve')] }) });
        toast('Approved — build resumed.');
        render();
      } catch (e) { toast('Approval failed: ' + e.message); b.disabled = false; }
    }));
    clearInterval(creationTimer); creationTimer = null;
    if (['running', 'awaiting_approval'].includes(run.status)) {
      creationTimer = setInterval(() => { if (document.visibilityState === 'visible') render(); }, 5000);
    }
  },
  unmount() { clearInterval(creationTimer); creationTimer = null; },
};

function describeApproval(p) {
  const tool = p.tool || '';
  const label = (window.SEAI_TXT ? window.SEAI_TXT.tool(tool) : tool);
  if (tool === 'themes.upload') return label + ' — ' + (p.args && p.args.filename ? p.args.filename : 'theme file') + ' (exact content shown in Advanced details)';
  if (tool === 'policies.update') return label + ' — ' + ((p.args && p.args.type) || 'policy');
  return label;
}

/* ============================================================ router */
const ROUTES = ['start', 'portfolio', 'overview', 'command', 'activity', 'provider', 'tools', 'system', 'creation'];
let current = null;
function path() {
  const p = location.pathname.replace(/\/+$/, '').slice(1) || 'portfolio';
  return ROUTES.includes(p) ? p : 'portfolio';
}
async function loadSwitcher() {
  const sel = document.getElementById('store-sel');
  if (!sel) return;
  // Connected stores ONLY. Slots, placeholders, and unconnected shops never appear here.
  if (!Store.connections.length) {
    sel.outerHTML = '<p class="body-s" id="store-sel" style="margin:0 0 0 15px">No store connected</p>';
    return;
  }
  const cur = sel.tagName === 'SELECT' ? sel.value : Store.active;
  if (sel.tagName !== 'SELECT') return;
  sel.innerHTML = Store.connections.map((c) =>
    '<option value="' + esc(c.shop) + '"' + (c.shop === (cur || Store.active) ? ' selected' : '') + '>' + esc(c.name) + '</option>'
  ).join('');
  sel.onchange = () => {
    if (Store.set(sel.value) && path() !== 'overview') history.pushState(null, '', '/overview');
    render();
  };
}
async function render() {
  if (current && views[current].unmount) { try { views[current].unmount(); } catch { /* ignore */ } }
  const r = path();
  current = r;
  document.querySelectorAll('.nav a').forEach((a) => {
    const on = a.getAttribute('href') === '/' + r;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const el = $('view');
  el.innerHTML = '<p class="body-s" style="padding:40px 0">Loading…</p>';
  try {
    await views[r].render(el);
  } catch (e) {
    el.innerHTML = '<p class="eyebrow">Error</p><h1 class="display">Something failed.</h1><p class="lede">' + esc(e.message) + '</p>';
  }
  document.title = views[r].title;
  el.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  $('foot').textContent = 'Updated ' + new Date().toLocaleTimeString();
  loadSwitcher();
  el.querySelectorAll('a[data-nav]').forEach((a) => a.addEventListener('click', nav));
}
function nav(e) {
  const href = e.currentTarget.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  e.preventDefault();
  if (location.pathname !== href) history.pushState(null, '', href);
  render();
}
document.querySelectorAll('a[data-nav]').forEach((a) => a.addEventListener('click', nav));
window.addEventListener('popstate', render);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (path() !== 'command') { history.pushState(null, '', '/command'); render().then(() => { const t = $('c-cmd'); t && t.focus(); }); }
    else { const t = $('c-cmd'); t && t.focus(); t && t.select(); }
  }
});
(async function init() {
  // Auth gate — must be authenticated to access dashboard
  const authed = await Auth.check();
  if (!authed) {
    location.href = '/sign-in';
    return;
  }
  await Store.load();

  // Embedded Shopify bootstrap (Phase 6). When ?shop= is present (set by the
  // /embed/activity redirect after ticket verification), initialize App Bridge
  // and select the authenticated shop. The shop value is trusted because it
  // comes from the server-side ticket verification, not user input.
  const params = new URLSearchParams(location.search);
  const shopParam = params.get('shop');
  const isEmbedded = window.top !== window.self;
  if (shopParam && isEmbedded && typeof Shopify !== 'undefined') {
    try {
      const cfgResp = await fetch('/embed/config', { credentials: 'same-origin' });
      const cfg = cfgResp.ok ? await cfgResp.json() : {};
      Shopify.init({
        apiKey: cfg.apiKey || '',
        shopOrigin: `https://${shopParam}`,
        forceRedirect: true,
      });
    } catch (e) {
      // Non-fatal: App Bridge is enhancement-only; the dashboard still works.
      console.warn('[seai] App Bridge init failed:', e?.message ?? e);
    }
  }
  if (shopParam && Store.connections.some((c) => c.shop === shopParam)) {
    localStorage['seai-active-shop'] = shopParam;
  }

  if (location.pathname === '/') {
    history.replaceState(null, '', Store.connections.length ? '/portfolio' : '/start');
  }
  loadSwitcher();
  render();
  if (params.get('connected') && Store.active) toast('Store connected.');
})();
