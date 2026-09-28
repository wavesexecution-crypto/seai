-- SEAI storage integration schema (CDF side of seai.storage).
-- CDF stores storage FILE IDS only — never raw bytes. Bytes live in
-- seai.storage (PostgreSQL metadata + object store).
-- Run with: npm run db:migrate

-- Mapping of CDF owners to storage objects. Powers listing and website-
-- generation retrieval without ever scanning the storage bucket.
CREATE TABLE IF NOT EXISTS customer_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  website_id TEXT,
  storage_file_id TEXT NOT NULL UNIQUE,
  request_id TEXT REFERENCES change_requests(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other',
  filename TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'UPLOADING',
  intake_order_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_files_user ON customer_files(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_files_website ON customer_files(user_id, website_id);

-- Modify attachments reference storage files instead of inline data URLs.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS file_id TEXT;
