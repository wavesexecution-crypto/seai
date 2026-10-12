-- SEAI customer dashboard schema (post-purchase website control center)
-- Customer-scoped: every row carries user_id; API layer enforces ownership.
-- Run with: npm run db:migrate

CREATE TABLE IF NOT EXISTS customer_websites (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  deployment_status TEXT NOT NULL DEFAULT 'unknown',
  last_deployment_at TIMESTAMPTZ,
  ssl_status TEXT NOT NULL DEFAULT 'unknown',
  -- Verified purchase handoff, recorded only by the staff-authorised lifecycle
  -- route. order_id makes website.purchase_confirmed stateful and therefore
  -- idempotent: the notice is emitted when the order is first recorded, and a
  -- re-post of the same order is a no-op.
  order_id TEXT,
  plan_name TEXT,
  order_amount_paise INTEGER,
  order_currency TEXT,
  order_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_websites_user ON customer_websites(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_websites_order ON customer_websites(order_id);

-- Additive upgrade path for databases created before the purchase columns.
ALTER TABLE customer_websites ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE customer_websites ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE customer_websites ADD COLUMN IF NOT EXISTS order_amount_paise INTEGER;
ALTER TABLE customer_websites ADD COLUMN IF NOT EXISTS order_currency TEXT;
ALTER TABLE customer_websites ADD COLUMN IF NOT EXISTS order_confirmed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_customer_websites_order ON customer_websites(order_id);

-- External analytics/health data source connections (real data only)
CREATE TABLE IF NOT EXISTS analytics_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_connected',
  external_id TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_analytics_connections_user ON analytics_connections(user_id);

-- Snapshots of real data pulled from connected sources (payload is JSON text)
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  metric TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '30d',
  payload TEXT NOT NULL DEFAULT '{}',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_user ON analytics_snapshots(user_id);

-- Client-to-SEAI website change requests
CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_change_requests_user ON change_requests(user_id);

-- Conversation history on a change request
CREATE TABLE IF NOT EXISTS change_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL DEFAULT 'client',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_change_messages_request ON change_messages(request_id);

-- File attachments on a change request (metadata + data URL, 5MB cap enforced in API)
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_request ON attachments(request_id);

-- Recurring website maintenance subscription (price comes from server config)
CREATE TABLE IF NOT EXISTS maintenance_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL DEFAULT 'Website Maintenance',
  price_inr INTEGER NOT NULL DEFAULT 457,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'not_subscribed',
  next_billing_date TIMESTAMPTZ,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  renewal_status TEXT NOT NULL DEFAULT 'off',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_subscriptions_user ON maintenance_subscriptions(user_id);
