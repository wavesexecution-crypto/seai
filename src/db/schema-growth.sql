-- SEAI Growth OS — marketing/advertising business data model.
-- Postgres-first, idempotent. All money in integer INR paise? No: whole rupees
-- are used throughout the existing codebase (paise only for gateway amounts),
-- so INR columns here are NUMERIC(12,0) whole rupees unless suffixed _paise.
-- Advertising budgets are ALWAYS stored separately from SEAI service revenue
-- (invoices.kind = 'ad_budget') and never counted in MRR.

-- ---------- RBAC: staff roles ride on users (customers keep 'customer') ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------- Inbound inquiries (public consultation form) ----------
CREATE TABLE IF NOT EXISTS growth_inquiries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  services_required TEXT,           -- JSON array of service keys
  monthly_marketing_budget TEXT,    -- budget band, e.g. '15k-30k'
  ad_budget TEXT,                   -- budget band or free text
  objective TEXT,                   -- main business objective
  details TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new', -- new | in_review | converted | closed
  lead_id TEXT,                    -- set when converted to a lead
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_growth_inquiries_status ON growth_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_growth_inquiries_created ON growth_inquiries(created_at);

-- ---------- CRM: leads ----------
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  lead_ref TEXT UNIQUE,             -- human-friendly, e.g. LD-3F9K2A
  business_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  industry TEXT,
  location TEXT,
  website TEXT,
  social_links TEXT,                -- JSON object {instagram,facebook,linkedin,...}
  source TEXT NOT NULL DEFAULT 'manual', -- referral|outbound|inbound|dm|campaign|website|import|event|other|manual
  business_size TEXT,               -- solo|small|medium|large
  potential_services TEXT,          -- JSON array of service keys
  estimated_budget_inr NUMERIC(12,0),
  priority TEXT NOT NULL DEFAULT 'normal', -- low|normal|high|urgent
  stage TEXT NOT NULL DEFAULT 'new',       -- 11 pipeline stages (see LEAD_STAGES in code)
  estimated_mrr_inr NUMERIC(12,0),
  assigned_to TEXT,                 -- users.id (staff)
  next_follow_up_at TEXT,           -- ISO date
  last_contacted_at TEXT,
  lost_reason TEXT,
  inquiry_id TEXT,                  -- originating growth_inquiries.id, if any
  import_batch_id TEXT,             -- lead_imports.id when imported
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_business_lc ON leads(lower(business_name));

CREATE TABLE IF NOT EXISTS lead_activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor TEXT,                       -- users.id or 'system' / 'import'
  type TEXT NOT NULL,               -- note|call|email|whatsapp|stage_change|assignment|follow_up|import|converted
  body TEXT,
  meta TEXT,                        -- JSON
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id, created_at);

CREATE TABLE IF NOT EXISTS lead_imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,          -- csv | pdf
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed', -- completed | failed
  error TEXT,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);

-- ---------- Clients (won leads that become paying clients) ----------
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,   -- client portal login, if provisioned
  legal_name TEXT,
  brand_name TEXT NOT NULL,
  industry TEXT,
  description TEXT,
  address TEXT,
  service_locations TEXT,           -- comma-separated or JSON array
  website TEXT,
  social_links TEXT,                -- JSON
  primary_contact TEXT,
  designation TEXT,
  email TEXT,
  phone TEXT,
  preferred_channel TEXT,           -- whatsapp|phone|email
  decision_maker TEXT,              -- name of authorised signatory
  gstin TEXT,
  billing_email TEXT,
  account_manager_id TEXT,          -- users.id (staff)
  status TEXT NOT NULL DEFAULT 'onboarding', -- onboarding|active|paused|cancelled
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_am ON clients(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- ---------- Onboarding (save & resume, per-section JSONB) ----------
CREATE TABLE IF NOT EXISTS onboarding_responses (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,        -- business|contact|brand|goals|advertising|website|content|financial
  data TEXT NOT NULL DEFAULT '{}',  -- JSON object of field_key -> value
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  UNIQUE (client_id, section_key)
);

CREATE TABLE IF NOT EXISTS onboarding_assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  section_key TEXT,
  field_key TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_url TEXT NOT NULL,           -- base64 data URL; capped 2 MB at the API layer
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_onboarding_assets_client ON onboarding_assets(client_id);

CREATE TABLE IF NOT EXISTS onboarding_invites (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,           -- meta_bm|meta_page|instagram|google_ads|analytics|gtm|crm|other
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|accepted|declined
  invited_email TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_client ON onboarding_invites(client_id);

-- ---------- Service agreements (retainers / custom) ----------
CREATE TABLE IF NOT EXISTS service_agreements (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,               -- starter|growth|scale|custom
  name TEXT NOT NULL,
  services TEXT,                    -- JSON array of service keys in scope
  monthly_fee_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  ad_budget_inr NUMERIC(12,0),     -- client-funded, accounted separately, never SEAI revenue
  billing_frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT,
  renewal_date TEXT,                -- next renewal / next billing date
  contract_months INTEGER,
  renewal_terms TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|paused|cancelled
  razorpay_subscription_id TEXT,   -- set when billed via Razorpay subscriptions
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_agreements_client ON service_agreements(client_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON service_agreements(status);

-- ---------- Delivery engine ----------
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agreement_id TEXT REFERENCES service_agreements(id) ON DELETE SET NULL,
  service_category TEXT NOT NULL,   -- branding|advertising|social|website|lead_gen|automation|growth
  name TEXT NOT NULL,
  brief TEXT,
  status TEXT NOT NULL DEFAULT 'planned', -- planned|active|on_hold|completed|cancelled
  assigned_to TEXT,                 -- users.id (staff)
  start_date TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_assigned ON projects(assigned_to);

CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'task',      -- task|deliverable|milestone
  title TEXT NOT NULL,
  detail TEXT,
  owner_id TEXT,                          -- users.id (staff)
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|blocked|done|skipped
  depends_on TEXT,                        -- JSON array of task ids
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by TEXT,
  approved_at TEXT,
  is_gate BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id, seq);
CREATE INDEX IF NOT EXISTS idx_project_tasks_owner ON project_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);

CREATE TABLE IF NOT EXISTS project_activities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor TEXT,                       -- users.id or 'system'
  type TEXT NOT NULL,               -- created|task_done|task_blocked|approval|status_change|note
  body TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_project_activities_project ON project_activities(project_id, created_at);

-- ---------- Content / campaign approvals (client-facing) ----------
CREATE TABLE IF NOT EXISTS content_approvals (
  id TEXT PRIMARY KEY,
  series TEXT NOT NULL,             -- groups versions of the same creative
  version INTEGER NOT NULL DEFAULT 1,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'creative',  -- creative|caption|campaign|calendar|other
  title TEXT NOT NULL,
  preview_url TEXT,                 -- link to asset (storage id / external URL)
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|revised
  feedback TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_content_approvals_client ON content_approvals(client_id, status);
CREATE INDEX IF NOT EXISTS idx_content_approvals_series ON content_approvals(series, version);

-- ---------- Advertising reports (operator-entered or API; source labelled) ----------
CREATE TABLE IF NOT EXISTS campaign_reports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  platform TEXT NOT NULL,           -- meta|google|youtube|other
  status TEXT NOT NULL DEFAULT 'active',  -- active|paused|ended
  period_start TEXT,
  period_end TEXT,
  spend_inr NUMERIC(12,0),
  reach INTEGER,
  impressions INTEGER,
  clicks INTEGER,
  leads INTEGER,
  cost_per_lead_inr NUMERIC(10,0),
  conversions INTEGER,
  data_source TEXT NOT NULL DEFAULT 'manual', -- manual|meta_api|google_ads_api
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_campaign_reports_client ON campaign_reports(client_id);

-- ---------- Invoices (ad budgets separate from service revenue) ----------
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,               -- INV-2026-0001
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agreement_id TEXT REFERENCES service_agreements(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'service_fee', -- service_fee|ad_budget|one_time|third_party|other
  description TEXT NOT NULL,
  line_items TEXT NOT NULL DEFAULT '[]',    -- JSON [{label, qty, unit_inr}]
  subtotal_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  gst_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  total_inr NUMERIC(12,0) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'draft',     -- draft|sent|paid|overdue|cancelled
  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_kind ON invoices(kind);

-- ---------- Expenses (SEAI's own costs, for margin reporting) ----------
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,           -- payroll|contractor|software|tools|office|other
  description TEXT NOT NULL,
  amount_inr NUMERIC(12,0) NOT NULL,
  incurred_at TEXT NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);

-- ---------- Support requests (client ↔ SEAI) ----------
CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open|in_progress|resolved|closed
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_support_requests_client ON support_requests(client_id, status);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  sender_id TEXT,                   -- users.id
  sender_role TEXT NOT NULL,        -- client|seai
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_support_messages_request ON support_messages(request_id, created_at);

-- ---------- Notifications (client + staff inboxes) ----------
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,            -- users.id recipient
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
