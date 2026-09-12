/**
 * Shared test harness: builds a fully-configured gateway app with test-only
 * credentials and an injected MemoryDataStore.
 *
 * All credential values here are clearly-marked TEST values (never real
 * Shopify or SEAI secrets). The app URL is a reserved test host, not a
 * production domain.
 */

import { createHmac } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { MemoryDataStore, type DataStore, type StoredSession, type StoredStore } from '../src/services/data-store.js';
import { createTicketService, type TicketService } from '../src/services/ticket.js';
import { createCryptoBox } from '../src/services/crypto.js';

export const TEST_CREDENTIALS = {
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
  appUrl: 'https://test-gateway.example.test',
  sessionStorageKey: 'test-session-storage-key',
  gatewayTokenSigningKey: 'test-gateway-token-signing-key',
  seaiBaseUrl: 'https://seai.test',
  seaiWebhookSecret: 'test-seai-webhook-secret',
} as const;

export const TEST_SHOP = 'test-shop.myshopify.com';

export interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly config: AppConfig;
  readonly store: MemoryDataStore;
  readonly tickets: TicketService;
  /** Mints a Shopify session-token JWT (HS256) signed with the TEST secret. */
  readonly mintSessionToken: (opts?: Partial<SessionTokenOptions>) => string;
  /** Install a store session row (token ciphertext is a TEST placeholder). */
  readonly installSession: (shop?: string) => Promise<StoredSession>;
  /** Install a store row with an optional SEAI account link. */
  readonly linkStore: (opts: { shop?: string; seaiAccountId?: string; state?: StoredStore['linkState'] }) => Promise<StoredStore>;
  /** Request helper returning a supertest Test instance. */
  readonly req: () => ReturnType<typeof request>;
}

export interface SessionTokenOptions {
  readonly shopDomain: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly sub: string;
  readonly sid: string;
  /** Offset in seconds from now for the exp claim. */
  readonly expiresInSec: number;
  /** Offset in seconds from now for the nbf claim. */
  readonly notBeforeOffsetSec: number;
  /**
   * Explicit issuer override. When set to the `OMIT` sentinel the iss claim
   * is removed entirely (to test the missing-issuer path); otherwise pass a
   * string to set it. Omit for the default derived value.
   */
  readonly iss: typeof OMIT_ISS | string | undefined;
  readonly dest: string | undefined;
  readonly aud: string | undefined;
  /** Override the signing secret (to test invalid-signature paths). */
  readonly signingSecret: string | undefined;
}

/** Sentinel: pass as `iss` to omit the claim entirely from the JWT. */
export const OMIT_ISS = Symbol('omit-iss');

export interface HarnessOverrides {
  readonly graphql?: import('../src/services/graphql.js').GraphqlTransport;
  readonly proxyRateLimiter?: import('../src/services/rate-limiter.js').TokenBucketStore;
}

export function createHarness(overrides?: HarnessOverrides): Harness {
  const store = new MemoryDataStore();
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SHOPIFY_API_KEY: TEST_CREDENTIALS.apiKey,
    SHOPIFY_API_SECRET: TEST_CREDENTIALS.apiSecret,
    SHOPIFY_APP_URL: TEST_CREDENTIALS.appUrl,
    SHOPIFY_API_SCOPES: 'read_products,write_products',
    SHOPIFY_API_VERSION: '2025-07',
    SESSION_STORAGE_KEY: TEST_CREDENTIALS.sessionStorageKey,
    GATEWAY_TOKEN_SIGNING_KEY: TEST_CREDENTIALS.gatewayTokenSigningKey,
    SEAI_BASE_URL: TEST_CREDENTIALS.seaiBaseUrl,
    SEAI_WEBHOOK_SECRET: TEST_CREDENTIALS.seaiWebhookSecret,
  });
  const app = createApp({ config, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never, overrides: { store, ...overrides } });

  function mintSessionToken(opts: Partial<SessionTokenOptions> = {}): string {
    const o: SessionTokenOptions = {
      shopDomain: opts.shopDomain ?? TEST_SHOP,
      apiKey: opts.apiKey ?? TEST_CREDENTIALS.apiKey,
      apiSecret: opts.apiSecret ?? TEST_CREDENTIALS.apiSecret,
      sub: opts.sub ?? 'test-user-1',
      sid: opts.sid ?? 'test-session-1',
      expiresInSec: opts.expiresInSec ?? 60,
      notBeforeOffsetSec: opts.notBeforeOffsetSec ?? -1,
      iss: opts.iss,
      dest: opts.dest,
      aud: opts.aud,
      signingSecret: opts.signingSecret,
    };
    const now = Math.trunc(Date.now() / 1000);
    // Derive iss from dest when dest is explicitly set; otherwise from shopDomain.
    const effectiveDest = o.dest ?? `https://${o.shopDomain}`;
    const derivedIss = effectiveDest.replace(/\/+$/, '') + '/admin';
    const effectiveIss = o.iss === OMIT_ISS ? undefined : (o.iss ?? derivedIss);
    const payload: Record<string, unknown> = {
      ...(effectiveIss === undefined ? {} : { iss: effectiveIss }),
      dest: effectiveDest,
      aud: o.aud ?? o.apiKey,
      sub: o.sub,
      exp: now + o.expiresInSec,
      nbf: now + o.notBeforeOffsetSec,
      iat: now,
      jti: `test-jti-${Math.trunc(Math.random() * 1e9)}`,
      sid: o.sid,
    };
    const b64url = (value: Buffer) => value.toString('base64url').replaceAll('=', '');
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${header}.${body}`;
    const signature = b64url(createHmac('sha256', o.signingSecret ?? o.apiSecret).update(signingInput).digest());
    return `${signingInput}.${signature}`;
  }

  async function installSession(shop = TEST_SHOP): Promise<StoredSession> {
    const session: StoredSession = {
      shopDomain: shop,
      accessTokenCiphertext: 'test-ciphertext-placeholder',
      scope: 'read_products write_products',
      isOnline: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveSession(session);
    return session;
  }

  async function linkStore(opts: { shop?: string; seaiAccountId?: string; state?: StoredStore['linkState'] } = {}): Promise<StoredStore> {
    const row: StoredStore = {
      shopDomain: opts.shop ?? TEST_SHOP,
      seaiAccountId: opts.seaiAccountId,
      linkState: opts.state ?? (opts.seaiAccountId ? 'linked' : 'pending'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveStore(row);
    return row;
  }

  const tickets = createTicketService(config, createCryptoBox(TEST_CREDENTIALS.sessionStorageKey), store);
  return {
    app,
    config,
    store,
    tickets,
    mintSessionToken,
    installSession,
    linkStore,
    req: () => request(app),
  } as Harness;
}

export function b64urlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export type { DataStore };
export { expect };