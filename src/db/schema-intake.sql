-- SEAI client intake schema (public website intake form on seai.store).
-- One row per accepted intake submission. Files reference seai.storage
-- objects by their storage file id; the bytes never live here.
-- Run with: npm run db:migrate

CREATE TABLE IF NOT EXISTS intakes (
  id TEXT PRIMARY KEY,
  -- Client-supplied key so a retried submission never creates a second
  -- intake (and therefore never sends a second report).
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Section 1: business
  client_name TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  existing_site TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  what_you_do TEXT NOT NULL DEFAULT '',
  target_customers TEXT NOT NULL DEFAULT '',
  business_description TEXT NOT NULL DEFAULT '',
  selling_points TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',

  -- Section 2: website direction
  preferred_style TEXT NOT NULL DEFAULT '',
  preferred_colors TEXT NOT NULL DEFAULT '',
  preferred_typography TEXT NOT NULL DEFAULT '',
  pages_requested TEXT NOT NULL DEFAULT '[]',
  features_requested TEXT NOT NULL DEFAULT '[]',
  reference_links TEXT NOT NULL DEFAULT '',
  competitors TEXT NOT NULL DEFAULT '',
  special_instructions TEXT NOT NULL DEFAULT '',

  -- Section 3: content
  content TEXT NOT NULL DEFAULT '{}',

  -- Plan / delivery
  plan TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  intake_session TEXT NOT NULL DEFAULT '',
  storage_scope TEXT NOT NULL DEFAULT '',

  -- Delivery bookkeeping
  report_status TEXT NOT NULL DEFAULT 'pending',
  report_event_id TEXT,
  report_delivery_id TEXT,
  report_message_id TEXT,
  report_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intakes_submitted ON intakes(submitted_at);
CREATE INDEX IF NOT EXISTS idx_intakes_business ON intakes(business_name);

-- Every asset the client uploaded, linked to the real storage object.
CREATE TABLE IF NOT EXISTS intake_files (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL REFERENCES intakes(id) ON DELETE CASCADE,
  -- Storage file id from seai.storage (the bytes stay in storage).
  storage_file_id TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT 'other',
  filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'intake_attachment',
  content_type_label TEXT NOT NULL DEFAULT '',
  -- Set when the storage lookup could not be resolved at intake time.
  lookup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_files_intake ON intake_files(intake_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_files_storage ON intake_files(storage_file_id);
