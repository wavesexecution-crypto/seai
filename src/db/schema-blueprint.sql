-- SEAI zero-config onboarding blueprints (additive; safe to re-run)
CREATE TABLE IF NOT EXISTS blueprints (
  store_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL DEFAULT '',
  context_raw TEXT NOT NULL DEFAULT '',
  blueprint JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'compiled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
