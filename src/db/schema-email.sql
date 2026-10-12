-- SEAI transactional email delivery model
-- One row per business event (email_events), one row per provider attempt
-- (email_deliveries). dedupe_key makes delivery idempotent: a replayed backend
-- event can never produce a second *successful* email, while a failed attempt
-- stays retryable up to a bounded number of tries (MAX_ATTEMPTS).
-- Run with: npm run db:migrate

-- The `id` column exists because the shared db abstraction keys every table on
-- `id` (db.insert / db.update). `name` stays the business key of the template.
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  wired BOOLEAN NOT NULL DEFAULT TRUE,
  required_vars TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  template TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  customer_id TEXT,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 1,
  correlation_id TEXT,
  -- Render variables, JSON-encoded, so a send orphaned by a serverless freeze can
  -- be reconstructed and retried instead of being lost forever. Tokens are never
  -- written here (see NOT_APPLICABLE_REAP_TEMPLATES): a password-reset or
  -- email-verification URL embeds a single-use secret, and that secret must not be
  -- duplicated into another table.
  variables TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_events_dedupe ON email_events(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_email_events_customer ON email_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_events_status ON email_events(status);
CREATE INDEX IF NOT EXISTS idx_email_events_correlation ON email_events(correlation_id);
-- Supports the bounded stale-send sweep (status + recency) without a table scan.
CREATE INDEX IF NOT EXISTS idx_email_events_stale ON email_events(status, updated_at);

-- Additive upgrade path for databases created before `variables` existed.
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS variables TEXT;
CREATE INDEX IF NOT EXISTS idx_email_events_stale ON email_events(status, updated_at);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  template TEXT NOT NULL,
  customer_id TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT NOT NULL DEFAULT 'smtp',
  provider_message_id TEXT,
  provider_response TEXT,
  error TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_event ON email_deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_recipient ON email_deliveries(recipient);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_status ON email_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_created ON email_deliveries(created_at);

-- ---------------------------------------------------------------------------
-- Upgrade path. `CREATE TABLE IF NOT EXISTS` above is a no-op on a database
-- created by an earlier revision, so every later change needs its own
-- idempotent step. Both blocks below are safe to run repeatedly.
-- ---------------------------------------------------------------------------

-- Earlier revisions keyed email_templates on `name` and had no `id`, which the
-- shared db abstraction requires for insert/update by key.
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE email_templates SET id = name WHERE id IS NULL;

DO $$
DECLARE pk_col text;
BEGIN
  SELECT a.attname INTO pk_col
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.conrelid = 'email_templates'::regclass AND c.contype = 'p'
  LIMIT 1;
  IF pk_col = 'name' THEN
    ALTER TABLE email_templates DROP CONSTRAINT email_templates_pkey;
    ALTER TABLE email_templates ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_name ON email_templates(name);

-- Retryable attempts. Existing rows become attempt 1 of MAX_ATTEMPTS.
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS attempts INTEGER;
UPDATE email_events SET attempts = 1 WHERE attempts IS NULL;
ALTER TABLE email_events ALTER COLUMN attempts SET DEFAULT 1;
ALTER TABLE email_events ALTER COLUMN attempts SET NOT NULL;
