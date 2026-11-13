/* SEAI Business Ops — Content (Phase 7) */
import { api } from '../api.js';

export const title = 'Content';
export const subtitle = 'Content planning, scheduling, publishing and performance';

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <h2>Content Studio</h2>
      <p class="muted">Plan, draft, approve, and schedule content across SEAI's social channels.</p>
    </div>

    <div class="grid cards" id="content-cards">
      <div class="card"><div class="k">Drafts</div><div class="v" id="content-drafts">—</div></div>
      <div class="card"><div class="k">Scheduled</div><div class="v" id="content-scheduled">—</div></div>
      <div class="card"><div class="k">Published</div><div class="v" id="content-published">—</div></div>
      <div class="card"><div class="k">Pending Approval</div><div class="v" id="content-pending">—</div></div>
    </div>

    <div class="panel mt-16">
      <h2>Content Calendar</h2>
      <div id="content-calendar" class="empty-state">Connect social accounts in Settings to begin content planning.</div>
    </div>
  `;

  await loadData();
  return container;
}

async function loadData() {
  try {
    const data = await api.get('/social/posts');
    const posts = data.posts || [];
    document.getElementById('content-drafts').textContent = posts.filter((p) => p.status === 'draft').length;
    document.getElementById('content-scheduled').textContent = posts.filter((p) => p.status === 'scheduled').length;
    document.getElementById('content-published').textContent = posts.filter((p) => p.status === 'published').length;
    document.getElementById('content-pending').textContent = posts.filter((p) => p.status === 'submitted').length;
  } catch (err) {
    console.error('Load content failed:', err);
  }
}

export async function onEnter() {
  await loadData();
}
