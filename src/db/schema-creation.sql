-- SEAI autonomous store creation (additive; safe to re-run)
CREATE TABLE IF NOT EXISTS creation_runs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_phase TEXT NOT NULL DEFAULT 'research',
  plan JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creation_store ON creation_runs(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creation_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES creation_runs(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csteps_run ON creation_steps(run_id);
