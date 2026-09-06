-- SEAI V1 PostgreSQL schema. Every business object is store-scoped (store_id).
-- Run with: npm run db:migrate

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  shop_domain TEXT UNIQUE NOT NULL,
  shop_name TEXT,
  email TEXT,
  currency TEXT,
  plan_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopify_sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_shop ON shopify_sessions(shop);

CREATE TABLE IF NOT EXISTS ai_keys (
  key_id TEXT PRIMARY KEY,
  slot INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_success TIMESTAMPTZ,
  last_failure TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  request_count BIGINT NOT NULL DEFAULT 0,
  rate_limit_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_models (
  name TEXT PRIMARY KEY,
  capabilities JSONB NOT NULL DEFAULT '{}',
  context_length INTEGER,
  parameter_size TEXT,
  vision BOOLEAN NOT NULL DEFAULT FALSE,
  tool_support BOOLEAN NOT NULL DEFAULT FALSE,
  reasoning BOOLEAN NOT NULL DEFAULT FALSE,
  structured_output BOOLEAN NOT NULL DEFAULT FALSE,
  availability TEXT NOT NULL DEFAULT 'unknown',
  health TEXT NOT NULL DEFAULT 'unknown',
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  key_id TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  error_class TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created ON ai_requests(created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  autonomy_level TEXT NOT NULL DEFAULT 'EXECUTE_SAFE',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_store ON agent_runs(store_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_steps_run ON agent_steps(run_id, n);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  policy_decision TEXT NOT NULL DEFAULT 'allow',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_toolcalls_run ON tool_calls(run_id);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  objective TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL DEFAULT '',
  hypothesis TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '[]',
  proposed_action TEXT NOT NULL DEFAULT '',
  expected_outcome TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'low',
  confidence REAL NOT NULL DEFAULT 0,
  required_permissions JSONB NOT NULL DEFAULT '[]',
  execution_status TEXT NOT NULL DEFAULT 'proposed',
  result JSONB NOT NULL DEFAULT '{}',
  measurement_plan TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_store ON decisions(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  decision_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  tool TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB NOT NULL DEFAULT '{}',
  reversible BOOLEAN NOT NULL DEFAULT TRUE,
  rollback_args JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,
  metric TEXT NOT NULL,
  baseline JSONB NOT NULL DEFAULT '{}',
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  variant JSONB NOT NULL DEFAULT '{}',
  control JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  result JSONB NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0,
  decision TEXT NOT NULL DEFAULT '',
  rollback_plan JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_obs_store ON observations(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, category, key)
);
CREATE INDEX IF NOT EXISTS idx_mem_store_cat ON memories(store_id, category);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  dims JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metrics_store ON metrics(store_id, name, captured_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  shop TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
