/**
 * PHASE 3 TESTS part 1: connect start (claim mint + redirect + guards).
 */
import { describe, expect, it } from 'vitest';
import { TEST_CREDENTIALS, TEST_SHOP } from './harness.js';
import { AUTH, h, parseBody, startLinkFlow } from './phase3-helpers.js';

describe('connect start', () => {
  it('mints a signed claim and redirects to the SEAI login with shop context', async () => {
    const claim = await startLinkFlow();
    const payload = parseBody(claim);
    expect(payload.version).toBe(1);
    expect(payload.kind).toBe('connect');
    expect(payload.shopDomain).toBe(TEST_SHOP);
    expect(typeof payload.nonce).toBe('string');
  });

  it('requires Shopify auth on /connect/start', async () => {
    const res = await h.req().get('/connect/start');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('returns 503 when SEAI link signing is not configured', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { createApp } = await import('../src/server.js');
    const { MemoryDataStore } = await import('../src/services/data-store.js');
    const store = new MemoryDataStore();
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SHOPIFY_API_KEY: TEST_CREDENTIALS.apiKey,
      SHOPIFY_API_SECRET: TEST_CREDENTIALS.apiSecret,
      SHOPIFY_APP_URL: TEST_CREDENTIALS.appUrl,
      SHOPIFY_API_SCOPES: 'read_products',
      SHOPIFY_API_VERSION: '2025-07',
      SESSION_STORAGE_KEY: TEST_CREDENTIALS.sessionStorageKey,
      GATEWAY_TOKEN_SIGNING_KEY: TEST_CREDENTIALS.gatewayTokenSigningKey,
      SEAI_BASE_URL: TEST_CREDENTIALS.seaiBaseUrl,
    });
    const { default: request } = await import('supertest');
    const app = createApp({
      config,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
      overrides: { store },
    });
    await store.saveSession({
      shopDomain: TEST_SHOP,
      accessTokenCiphertext: 'x',
      scope: '',
      isOnline: false,
      installedAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await request(app).get('/connect/start').set(AUTH(h.mintSessionToken()));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('link_not_configured');
  });
});
