-- ============================================================================
-- 002_operations.sql — SEAI Shopify Gateway: nonce store + machine tokens
--
--   nonces                  one-time tokens (OAuth state, ticket replay guard)
--   machine_tokens          per-store SEAI machine tokens (AES-256-GCM)
--   stores.seai_machine_token_hash   per-store SEAI machine-token (sha256)
--   stores.store_name                display name refreshed from shop/update
--   sessions.issued_at               last OAuth token issue time
--
-- Idempotent and additive: safe to run on an existing Phase-1 database.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS nonces (
    key          TEXT        PRIMARY KEY,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nonces_expires_at
    ON nonces (expires_at);

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS seai_machine_token_hash TEXT;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS store_name TEXT;

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS machine_tokens (
    shop_domain  TEXT        PRIMARY KEY,
    ciphertext   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;