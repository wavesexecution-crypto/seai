-- SEAI Deterministic Automation Engine schema
-- Additive migration: preserves all existing production data.
-- Run with: npm run db:migrate

-- ---------- Automation task definitions and executions ----------
CREATE TABLE IF NOT EXISTS automation_tasks (
  id TEXT PRIMARY KEY,
  script_name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  input_params JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  output JSONB,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_tasks_status ON automation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_automation_tasks_script ON automation_tasks(script_name);
CREATE INDEX IF NOT EXISTS idx_automation_tasks_created ON automation_tasks(created_at DESC);

-- ---------- Structured execution logs ----------
CREATE TABLE IF NOT EXISTS automation_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_logs_task ON automation_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_created ON automation_logs(created_at DESC);

-- ---------- Task schedules ----------
CREATE TABLE IF NOT EXISTS automation_schedules (
  id TEXT PRIMARY KEY,
  script_name TEXT NOT NULL,
  input_params JSONB NOT NULL DEFAULT '{}',
  cron_expression TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_schedules_active ON automation_schedules(is_active, next_run_at);
