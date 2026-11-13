/* SEAI Business Ops â€” Settings page */
import { api } from '../api.js';

export const title = 'Settings';
export const subtitle = 'System configuration and preferences';

export async function render(container) {
  container.innerHTML = `
    <div class="panel mt-16">
      <h2>Application Settings</h2>
      <div class="form-row mt-8">
        <div style="grid-column:span 2">
          <label>API Base</label>
          <input type="text" id="setting-api-base" value="/api/ops" style="width:100%" readonly />
          <p class="muted mt-4">Internal API routes are served from the same origin.</p>
        </div>
      </div>
    </div>

    <div class="panel mt-16">
      <h2>Database Tables</h2>
      <p class="muted">All data is stored in Neon PostgreSQL. Tables: services, proposals, proposal_line_items, social_integrations, social_posts, marketing_campaigns, campaign_creatives, lead_sources.</p>
    </div>

    <div class="panel mt-16">
      <h2>Security</h2>
      <ul style="margin:8px 0 0 18px;color:var(--sub);font-size:12px">
        <li>Session-based authentication with httpOnly cookies</li>
        <li>Role-based access control (RBAC)</li>
        <li>Tokens encrypted at rest with SEAI_ENCRYPTION_KEY</li>
        <li>No client data exposure between clients</li>
      </ul>
    </div>
  `;
  return container;
}

export async function onEnter() {}

