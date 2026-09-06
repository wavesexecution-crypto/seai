-- SEAI multi-store foundation (additive; safe to re-run)
CREATE TABLE IF NOT EXISTS store_slots (
  slot INTEGER PRIMARY KEY,
  shop TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategies (
  store_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unformed',
  thesis TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  business_model TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  formed_by_run TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stores ADD COLUMN IF NOT EXISTS slot INTEGER;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS label TEXT;
