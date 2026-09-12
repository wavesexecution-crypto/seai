-- ============================================================================
-- 001_init.sql — SEAI Shopify Gateway: initial schema (Phase 1 scaffold)
--
-- Tables:
--   sessions            single row per shop (encrypted Shopify access token)
--   stores              identity bridge: shop <-> SEAI account + link state
--   webhook_deliveries  idempotency + replay guard for webhook processing
--
-- Security notes:
--   * The Shopify access token is NEVER stored in plain text — only the
--     AES-256-GCM ciphertext (access_token_ciphertext), keyed with
--     SESSION_STORAGE_KEY kept exclusively in the platform secrets store.
--   * Shop domains are enforced lowercase (Shopify normalizes them).
--   * No secret material exists in this file.
--
-- Idempotent: safe to run repeatedly (all objects use IF NOT EXISTS).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- sessions — one row per installed store; the encrypted store token + grant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_domain             TEXT        NOT NULL UNIQUE,
    access_token_ciphertext TEXT        NOT NULL,
    scope                   TEXT        NOT NULL DEFAULT '',
    is_online               BOOLEAN     NOT NULL DEFAULT FALSE,
    installed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sessions_shop_domain_lowercase
        CHECK (shop_domain = lower(shop_domain))
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
    ON sessions (updated_at DESC);

-- ---------------------------------------------------------------------------
-- stores: identity bridge between a Shopify store and an SEAI account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
    shop_domain      TEXT        PRIMARY KEY,
    seai_account_id  TEXT,
    link_state       TEXT        NOT NULL DEFAULT 'pending'
        CHECK (link_state IN ('pending', 'linked', 'revoked')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stores_seai_account
    ON stores (seai_account_id)
    WHERE seai_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- webhook_deliveries: idempotency + retry ledger for processed webhooks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_domain     TEXT        NOT NULL,
    topic           TEXT        NOT NULL,
    webhook_id      TEXT        NOT NULL,             -- Shopify's unique webhook id
    api_version     TEXT        NOT NULL,
    delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts        INTEGER     NOT NULL DEFAULT 0,
    last_status     INTEGER,
    last_error      TEXT,
    processed_at    TIMESTAMPTZ,
    CONSTRAINT webhook_deliveries_unique UNIQUE (shop_domain, topic, webhook_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_unprocessed
    ON webhook_deliveries (processed_at)
    WHERE processed_at IS NULL;

COMMIT;