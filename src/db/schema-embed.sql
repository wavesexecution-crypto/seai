-- Phase 6: replay protection for gateway tickets.
-- A nonce is recorded once when a ticket is consumed; duplicate nonces are
-- rejected. Rows are safe to prune once past expires_at.

CREATE TABLE IF NOT EXISTS nonces (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nonces_expires_at ON nonces (expires_at);
