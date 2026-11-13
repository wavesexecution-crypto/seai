-- SEAI Business Ops schema (ops.seai.store)
-- Additive migration: preserves all existing production data.
-- Run with: npm run db:migrate

-- ---------- Configurable service catalogue (authoritative, replaces hardcoded list) ----------
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,             -- e.g. 'website', 'advertising', 'social'
  label TEXT NOT NULL,                   -- human-readable name
  description TEXT NOT NULL DEFAULT '',
  pricing_model TEXT NOT NULL DEFAULT 'one_time', -- one_time | recurring | retainer
  base_price_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  packages JSONB NOT NULL DEFAULT '[]',  -- [{name, price_inr, deliverables[], revision_limit}]
  deliverables JSONB NOT NULL DEFAULT '[]',
  estimated_delivery_days INTEGER,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_services_key ON services(key);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);

-- ---------- Proposals (sales) ----------
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  proposal_ref TEXT UNIQUE NOT NULL,    -- e.g. PROP-2026-0001
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', -- draft|sent|viewed|accepted|rejected|expired
  subtotal_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  gst_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  total_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_terms TEXT NOT NULL DEFAULT 'Due within 7 days',
  valid_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  rejection_reason TEXT,
  pdf_url TEXT,                          -- signed storage URL for generated PDF
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_lead ON proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_client ON proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_ref ON proposals(proposal_ref);

CREATE TABLE IF NOT EXISTS proposal_line_items (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_key TEXT NOT NULL,
  service_label TEXT NOT NULL,
  package_name TEXT,
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  line_total_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposal_items_proposal ON proposal_line_items(proposal_id);

-- ---------- Social / platform integrations (OAuth connections) ----------
CREATE TABLE IF NOT EXISTS social_integrations (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,                -- meta | whatsapp | google | linkedin | youtube | tiktok
  account_id TEXT NOT NULL,              -- platform-scoped external account id
  account_name TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,        -- encrypted at rest
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  health_status TEXT NOT NULL DEFAULT 'unknown', -- healthy | expired | revoked | error
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  workspace_type TEXT NOT NULL DEFAULT 'seai', -- seai | client
  workspace_id TEXT,                     -- clients.id or null for SEAI's own
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, account_id, workspace_type, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_social_integrations_platform ON social_integrations(platform);
CREATE INDEX IF NOT EXISTS idx_social_integrations_workspace ON social_integrations(workspace_type, workspace_id);
CREATE INDEX IF NOT EXISTS idx_social_integrations_active ON social_integrations(is_active, health_status);

-- ---------- Social posts (content calendar + publishing) ----------
CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  integration_id TEXT REFERENCES social_integrations(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  external_post_id TEXT,                 -- platform post id after publishing
  content_type TEXT NOT NULL DEFAULT 'text', -- text | image | carousel | reel | story
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '[]',   -- JSON array
  media_urls JSONB NOT NULL DEFAULT '[]',-- [{url, mime_type, width, height}]
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | submitted | approved | scheduled | published | failed | rejected
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  failed_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_integration ON social_posts(integration_id);

-- ---------- Marketing campaigns (paid advertising) ----------
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  integration_id TEXT REFERENCES social_integrations(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,                -- meta | google
  external_campaign_id TEXT,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | pending_approval | approved | active | paused | completed | cancelled
  budget_total_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  budget_daily_inr NUMERIC(12,0),
  budget_spent_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  targeting JSONB NOT NULL DEFAULT '{}',
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_platform ON marketing_campaigns(platform);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_integration ON marketing_campaigns(integration_id);

-- ---------- Campaign creatives ----------
CREATE TABLE IF NOT EXISTS campaign_creatives (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  external_creative_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'image',    -- image | video | carousel | text
  media_urls JSONB NOT NULL DEFAULT '[]',
  headline TEXT,
  description TEXT,
  call_to_action TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | submitted | approved | rejected | active | paused
  spend_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  impressions INTEGER,
  clicks INTEGER,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_creatives_campaign ON campaign_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_creatives_status ON campaign_creatives(status);

-- ---------- Website project domain ----------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS domain TEXT;

-- ---------- Media assets (content studio library) ----------
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                    -- image | video | document
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_url TEXT NOT NULL,             -- signed URL or storage path
  source_type TEXT NOT NULL,             -- upload | external | platform
  source_id TEXT,                        -- external platform media id
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds INTEGER,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_assets_kind ON media_assets(kind);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_by ON media_assets(created_by);

-- ---------- Social posts recipient field (WhatsApp) ----------
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS recipient TEXT;

-- ---------- Ad metrics (platform-synced performance snapshots) ----------
CREATE TABLE IF NOT EXISTS ad_metrics (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  ctr NUMERIC(8,4) NOT NULL DEFAULT 0,
  cpc NUMERIC(10,2) NOT NULL DEFAULT 0,
  cpm NUMERIC(10,2) NOT NULL DEFAULT 0,
  conversions NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, date)
);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_campaign ON ad_metrics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_date ON ad_metrics(date);

-- ---------- Lead sources tracking ----------
CREATE TABLE IF NOT EXISTS lead_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- website | instagram | whatsapp | cold_email | referral | direct_sales | paid_ads | manual
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Seed default lead sources ----------
INSERT INTO lead_sources (id, name, type, is_active, created_at) VALUES
  ('src_website', 'Public Website Inquiry', 'website', true, now()),
  ('src_instagram', 'Instagram', 'instagram', true, now()),
  ('src_whatsapp', 'WhatsApp', 'whatsapp', true, now()),
  ('src_cold_email', 'Cold Email', 'cold_email', true, now()),
  ('src_referral', 'Referral', 'referral', true, now()),
  ('src_direct_sales', 'Direct Sales', 'direct_sales', true, now()),
  ('src_paid_ads', 'Paid Advertising', 'paid_ads', true, now()),
  ('src_manual', 'Manual Entry', 'manual', true, now())
ON CONFLICT (id) DO NOTHING;

-- ---------- Seed default services ----------
INSERT INTO services (id, key, label, description, pricing_model, base_price_inr, packages, deliverables, estimated_delivery_days, is_recurring, is_active, created_at, updated_at) VALUES
  ('svc_website', 'website', 'Website Development', 'Custom business website with design, development, and deployment.', 'one_time', 49999, '[]', '["Custom design", "Responsive development", "CMS setup", "SEO basics", "Launch support"]', 21, false, true, now(), now()),
  ('svc_advertising', 'advertising', 'Digital Advertising', 'Meta/Google/YouTube ad campaigns with strategy, creative, and management.', 'recurring', 24999, '[]', '["Campaign strategy", "Ad creative", "Audience setup", "Weekly optimisation", "Performance reporting"]', 7, true, true, now(), now()),
  ('svc_social', 'social', 'Social Media Marketing', 'Instagram/Facebook content, community management, and growth.', 'recurring', 14999, '[]', '["Content calendar", "Post creation", "Community engagement", "Hashtag strategy", "Monthly analytics"]', 7, true, true, now(), now()),
  ('svc_lead_gen', 'lead_gen', 'Lead Generation', 'Targeted lead acquisition campaigns.', 'recurring', 19999, '[]', '["Lead magnet creation", "Landing page", "Lead capture forms", "CRM integration", "Weekly lead reports"]', 14, true, true, now(), now()),
  ('svc_automation', 'automation', 'Sales & Automation', 'CRM setup, automation workflows, and sales process optimisation.', 'one_time', 34999, '[]', '["CRM setup", "Pipeline configuration", "Automation workflows", "Team training", "Documentation"]', 14, false, true, now(), now()),
  ('svc_growth', 'growth', 'Growth Strategy & Audits', 'Comprehensive marketing audits and growth planning.', 'one_time', 29999, '[]', '["Marketing audit", "Competitor analysis", "Growth roadmap", "KPI framework", "Quarterly review"]', 10, false, true, now(), now()),
  ('svc_maintenance', 'maintenance', 'Website Maintenance', 'Ongoing website maintenance, security, and updates.', 'recurring', 457, '[]', '["Security updates", "Content updates", "Backup monitoring", "Uptime monitoring", "Technical support"]', 1, true, true, now(), now())
ON CONFLICT (key) DO NOTHING;

-- ---------- Add new RBAC role columns to users (already has role column from schema-growth.sql) ----------
-- The users.role column already exists from schema-growth.sql.
-- We extend the valid role set in application code to include owner, administrator, project_manager, support.

-- ---------- Razorpay webhook events (idempotency) ----------
CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,           -- Razorpay webhook event id
  event_type TEXT NOT NULL,                -- payment.captured | payment.failed | ...
  payload JSONB NOT NULL DEFAULT '{}',
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events_event_id ON razorpay_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events_processed ON razorpay_webhook_events(processed);

-- ---------- WhatsApp webhook events (idempotency) ----------
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,           -- Meta webhook event id
  event_type TEXT NOT NULL,                -- messages | message_status | ...
  payload JSONB NOT NULL DEFAULT '{}',
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_event_id ON whatsapp_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_processed ON whatsapp_webhook_events(processed);

-- ---------- WhatsApp message templates ----------
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                      -- template name registered with Meta
  language TEXT NOT NULL DEFAULT 'en',     -- language code
  category TEXT NOT NULL DEFAULT 'utility', -- utility|marketing|authentication
  components JSONB NOT NULL DEFAULT '[]',  -- header, body, footer, buttons
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|disabled
  meta_template_id TEXT,                   -- ID returned by Meta
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name ON whatsapp_templates(name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_status ON whatsapp_templates(status);

-- ---------- WhatsApp messages (inbound and outbound) ----------
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  integration_id TEXT REFERENCES social_integrations(id) ON DELETE SET NULL,
  wa_message_id TEXT,                      -- message id from Meta
  conversation_id TEXT,                    -- phone number as conversation key
  direction TEXT NOT NULL,                 -- inbound|outbound
  type TEXT NOT NULL DEFAULT 'text',       -- text|image|interactive|...
  body TEXT,                               -- message text content
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|delivered|read|failed|received
  timestamp TEXT,                          -- ISO timestamp from Meta or local
  raw_payload JSONB NOT NULL DEFAULT '{}', -- full webhook payload for inbound
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conv ON whatsapp_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction ON whatsapp_messages(direction);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_integration ON whatsapp_messages(integration_id);
