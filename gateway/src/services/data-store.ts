/**
 * Storage layer for the gateway.
 *
 * One `DataStore` interface backs: encrypted Shopify sessions, the shop <-> SEAI
 * account link, webhook-delivery idempotency, and one-time token (nonce) guard
 * tables. Two implementations:
 *
 *  - `MemoryDataStore`   — used in tests and local dev WITHOUT a database.
 *  - `PostgresDataStore` — production store (pg Pool over DATABASE_URL).
 *
 * The factory prefers Postgres when `DATABASE_URL` is set, otherwise memory.
 */

import pg from 'pg';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../logger.js';

/** A Shopify store session row (token stored as AES-256-GCM ciphertext). */
export interface StoredSession {
  readonly shopDomain: string;
  readonly accessTokenCiphertext: string;
  readonly scope: string;
  readonly isOnline: boolean;
  readonly installedAt: Date;
  readonly updatedAt: Date;
}

/** Shop <-> SEAI account identity bridge. */
export interface StoredStore {
  readonly shopDomain: string;
  readonly seaiAccountId?: string | undefined;
  readonly linkState: 'pending' | 'linked' | 'revoked';
  /** SHA-256 of the per-store SEAI machine token (never the token itself). */
  readonly seaiMachineTokenHash?: string | undefined;
  readonly storeName?: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Webhook delivery state (idempotency + retry ledger). */
export interface WebhookDeliveryRecord {
  readonly shopDomain: string;
  readonly topic: string;
  readonly webhookId: string;
  readonly apiVersion: string;
  readonly deliveredAt: Date;
  /** Running attempt counter (1 on first delivery). */
  readonly attempts: number;
  readonly lastStatus?: number | undefined;
  readonly lastError?: string | undefined;
  readonly processedAt?: Date | undefined;
}

export type LinkState = StoredStore['linkState'];

export interface MachineTokenRecord {
  readonly shopDomain: string;
  readonly ciphertext: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DataStore {
  // --- sessions --------------------------------------------------
  findSession(shopDomain: string): Promise<StoredSession | undefined>;
  saveSession(session: StoredSession): Promise<void>;
  deleteSession(shopDomain: string): Promise<void>;

  // --- stores / link ----------------------------------------------
  findStore(shopDomain: string): Promise<StoredStore | undefined>;
  saveStore(store: StoredStore): Promise<void>;
  deleteStore(shopDomain: string): Promise<void>;

  // --- SEAI machine tokens (encrypted at rest) --------------------
  saveMachineToken(shopDomain: string, ciphertext: string, at: Date): Promise<void>;
  findMachineToken(shopDomain: string): Promise<MachineTokenRecord | undefined>;
  deleteMachineToken(shopDomain: string): Promise<void>;

  // --- webhook delivery idempotency --------------------------------
  /** Record a delivery; returns true when newly recorded, false on duplicate. */
  recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<boolean>;
  /** Update status/error/attempts for an existing delivery row. */
  updateWebhookDelivery(
    key: Pick<WebhookDeliveryRecord, 'shopDomain' | 'topic' | 'webhookId'>,
    result: { attempts: number; lastStatus?: number; lastError?: string; processedAt?: Date },
  ): Promise<void>;

  // --- one-time nonce store (OAuth state + ticket replay guard) ----
  /** Insert nonce if absent and not expired. False on duplicate => replay. */
  setNonceIfAbsent(key: string, expiresAt: Date): Promise<boolean>;
  /** Atomically remove a nonce; true when it existed (consumed). */
  consumeNonce(key: string): Promise<boolean>;

  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory implementation (tests, local dev without DB)
// ---------------------------------------------------------------------------

export class MemoryDataStore implements DataStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly stores = new Map<string, StoredStore>();
  private readonly machineTokens = new Map<string, MachineTokenRecord>();
  private readonly deliveries = new Map<string, WebhookDeliveryRecord>();
  private readonly nonces = new Map<string, number>();

  async findSession(shopDomain: string): Promise<StoredSession | undefined> {
    return this.sessions.get(shopDomain);
  }

  async saveSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.shopDomain, session);
  }

  async deleteSession(shopDomain: string): Promise<void> {
    this.sessions.delete(shopDomain);
  }

  async findStore(shopDomain: string): Promise<StoredStore | undefined> {
    return this.stores.get(shopDomain);
  }

  async saveStore(store: StoredStore): Promise<void> {
    this.stores.set(store.shopDomain, store);
  }

  async deleteStore(shopDomain: string): Promise<void> {
    this.stores.delete(shopDomain);
  }

  async saveMachineToken(shopDomain: string, ciphertext: string, at: Date): Promise<void> {
    this.machineTokens.set(shopDomain, { shopDomain, ciphertext, createdAt: at, updatedAt: at });
  }

  async findMachineToken(shopDomain: string): Promise<MachineTokenRecord | undefined> {
    return this.machineTokens.get(shopDomain);
  }

  async deleteMachineToken(shopDomain: string): Promise<void> {
    this.machineTokens.delete(shopDomain);
  }

  async recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<boolean> {
    const key = deliveryKey(delivery.shopDomain, delivery.topic, delivery.webhookId);
    if (this.deliveries.has(key)) {
      return false;
    }
    this.deliveries.set(key, delivery);
    return true;
  }

  async updateWebhookDelivery(
    key: Pick<WebhookDeliveryRecord, 'shopDomain' | 'topic' | 'webhookId'>,
    result: { attempts: number; lastStatus?: number; lastError?: string; processedAt?: Date },
  ): Promise<void> {
    const k = deliveryKey(key.shopDomain, key.topic, key.webhookId);
    const existing = this.deliveries.get(k);
    if (!existing) return;
    this.deliveries.set(k, { ...existing, ...result });
  }

  async setNonceIfAbsent(key: string, expiresAt: Date): Promise<boolean> {
    const expiry = this.nonces.get(key);
    if (expiry !== undefined && expiry > Date.now()) {
      return false;
    }
    this.nonces.set(key, expiresAt.getTime());
    return true;
  }

  async consumeNonce(key: string): Promise<boolean> {
    return this.nonces.delete(key);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.stores.clear();
    this.deliveries.clear();
    this.nonces.clear();
  }
}

function deliveryKey(shop: string, topic: string, webhookId: string): string {
  return `${shop}\u0000${topic}\u0000${webhookId}`;
}

// ---------------------------------------------------------------------------
// Postgres implementation (production)
// ---------------------------------------------------------------------------

export class PostgresDataStore implements DataStore {
  readonly pool: pg.Pool;

  constructor(databaseUrl: string, max = 8) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max });
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async findSession(shopDomain: string): Promise<StoredSession | undefined> {
    const rows = await this.pool.query(
      `SELECT shop_domain, access_token_ciphertext, scope, is_online, installed_at, updated_at
         FROM sessions WHERE shop_domain = $1`,
      [shopDomain],
    );
    return rows.rowCount === 0 ? undefined : rowToSession(rows.rows[0]);
  }

  async saveSession(session: StoredSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions
         (shop_domain, access_token_ciphertext, scope, is_online, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (shop_domain) DO UPDATE SET
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         scope = EXCLUDED.scope,
         is_online = EXCLUDED.is_online,
         installed_at = EXCLUDED.installed_at,
         updated_at = EXCLUDED.updated_at`,
      [
        session.shopDomain,
        session.accessTokenCiphertext,
        session.scope,
        session.isOnline,
        session.installedAt,
        session.updatedAt,
      ],
    );
  }

  async deleteSession(shopDomain: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE shop_domain = $1', [shopDomain]);
  }

  async findStore(shopDomain: string): Promise<StoredStore | undefined> {
    const rows = await this.pool.query(
      `SELECT shop_domain, seai_account_id, link_state, seai_machine_token_hash,
              store_name, created_at, updated_at
         FROM stores WHERE shop_domain = $1`,
      [shopDomain],
    );
    return rows.rowCount === 0 ? undefined : rowToStore(rows.rows[0]);
  }

  async saveStore(store: StoredStore): Promise<void> {
    await this.pool.query(
      `INSERT INTO stores
         (shop_domain, seai_account_id, link_state, seai_machine_token_hash, store_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (shop_domain) DO UPDATE SET
         seai_account_id = EXCLUDED.seai_account_id,
         link_state = EXCLUDED.link_state,
         seai_machine_token_hash = EXCLUDED.seai_machine_token_hash,
         store_name = EXCLUDED.store_name,
         updated_at = now()`,
      [
        store.shopDomain,
        store.seaiAccountId ?? null,
        store.linkState,
        store.seaiMachineTokenHash ?? null,
        store.storeName ?? null,
      ],
    );
  }

  async deleteStore(shopDomain: string): Promise<void> {
    await this.pool.query('DELETE FROM machine_tokens WHERE shop_domain = $1', [shopDomain]);
    await this.pool.query('DELETE FROM stores WHERE shop_domain = $1', [shopDomain]);
  }

  async saveMachineToken(shopDomain: string, ciphertext: string, at: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO machine_tokens (shop_domain, ciphertext, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (shop_domain) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = EXCLUDED.updated_at`,
      [shopDomain, ciphertext, at],
    );
  }

  async findMachineToken(shopDomain: string): Promise<MachineTokenRecord | undefined> {
    const rows = await this.pool.query(
      'SELECT shop_domain, ciphertext, created_at, updated_at FROM machine_tokens WHERE shop_domain = $1',
      [shopDomain],
    );
    if (rows.rowCount === 0) return undefined;
    const row = rows.rows[0] as Record<string, unknown>;
    return {
      shopDomain: String(row.shop_domain),
      ciphertext: String(row.ciphertext),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  async deleteMachineToken(shopDomain: string): Promise<void> {
    await this.pool.query('DELETE FROM machine_tokens WHERE shop_domain = $1', [shopDomain]);
  }

  async recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<boolean> {
    const rows = await this.pool.query(
      `INSERT INTO webhook_deliveries
         (shop_domain, topic, webhook_id, api_version, delivered_at, attempts, last_status, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (shop_domain, topic, webhook_id) DO NOTHING
       RETURNING id`,
      [
        delivery.shopDomain,
        delivery.topic,
        delivery.webhookId,
        delivery.apiVersion,
        delivery.deliveredAt,
        delivery.attempts,
        delivery.lastStatus ?? null,
        delivery.lastError ?? null,
      ],
    );
    return rows.rowCount === 1;
  }

  async updateWebhookDelivery(
    key: Pick<WebhookDeliveryRecord, 'shopDomain' | 'topic' | 'webhookId'>,
    result: { attempts: number; lastStatus?: number; lastError?: string; processedAt?: Date },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_deliveries
          SET attempts = $4, last_status = $5, last_error = $6, processed_at = $7
        WHERE shop_domain = $1 AND topic = $2 AND webhook_id = $3`,
      [
        key.shopDomain,
        key.topic,
        key.webhookId,
        result.attempts,
        result.lastStatus ?? null,
        result.lastError ?? null,
        result.processedAt ?? null,
      ],
    );
  }

  async setNonceIfAbsent(key: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.pool.query(
      `INSERT INTO nonces (key, expires_at) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, expiresAt],
    );
    return rows.rowCount === 1;
  }

  async consumeNonce(key: string): Promise<boolean> {
    const rows = await this.pool.query('DELETE FROM nonces WHERE key = $1 RETURNING key', [key]);
    return rows.rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// Factory + row mappers
// ---------------------------------------------------------------------------

export function createDataStore(config: AppConfig, _logger: AppLogger): DataStore {
  if (config.databaseUrl) {
    return new PostgresDataStore(config.databaseUrl);
  }
  return new MemoryDataStore();
}

function rowToSession(row: Record<string, unknown>): StoredSession {
  return {
    shopDomain: String(row.shop_domain),
    accessTokenCiphertext: String(row.access_token_ciphertext),
    scope: String(row.scope ?? ''),
    isOnline: Boolean(row.is_online),
    installedAt: toDate(row.installed_at),
    updatedAt: toDate(row.updated_at),
  };
}

function rowToStore(row: Record<string, unknown>): StoredStore {
  return {
    shopDomain: String(row.shop_domain),
    seaiAccountId: row.seai_account_id ? String(row.seai_account_id) : undefined,
    linkState: String(row.link_state ?? 'pending') as LinkState,
    seaiMachineTokenHash: row.seai_machine_token_hash
      ? String(row.seai_machine_token_hash)
      : undefined,
    storeName: row.store_name ? String(row.store_name) : undefined,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}