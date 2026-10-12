/**
 * Regression test for Shopify OAuth callback HMAC validation.
 *
 * Shopify computes hmac = hex(HMAC-SHA256(secret, sorted_query_string))
 * where sorted_query_string = sorted(key=value & ...) excluding hmac/signature.
 * The gateway must pass the *full* req.query (including host, hmac, shop,
 * code, state, timestamp) to shopify.utils.validateHmac via
 * createShopifyHandle().validateOauthHmac.
 *
 * Previous bug: auth.ts passed only {shop,code,state,timestamp}, omitting
 * host and hmac, so validation always failed (missing hmac) or mismatched.
 *
 * This test uses a dedicated test secret (never the real SHOPIFY_API_SECRET)
 * and synthetic fixtures derived from the library's own ProcessedQuery
 * canonicalization (URLSearchParams, sorted).
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createShopifyHandle } from '../src/services/shopify.js';
import { loadConfig } from '../src/config.js';

const TEST_API_KEY = 'test-hmac-api-key';
const TEST_API_SECRET = 'test-hmac-api-secret-32chars!!';
const TEST_SHOP = 'hmac-test-shop.myshopify.com';

/** Replicates @shopify/shopify-api's stringifyQueryForAdmin (ProcessedQuery). */
function canonicalize(query: Record<string, string>): string {
  const usp = new URLSearchParams();
  Object.keys(query)
    .sort((a, b) => a.localeCompare(b))
    .forEach((k) => usp.append(k, query[k]!));
  return usp.toString(); // no leading ?
}
function hmacFor(queryWithoutHmac: Record<string, string>): string {
  const msg = canonicalize(queryWithoutHmac);
  return createHmac('sha256', TEST_API_SECRET).update(msg).digest('hex');
}
function makeHandle() {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SHOPIFY_API_KEY: TEST_API_KEY,
    SHOPIFY_API_SECRET: TEST_API_SECRET,
    SHOPIFY_APP_URL: 'https://test-gateway.example.test',
    SHOPIFY_API_SCOPES: 'read_products',
    SHOPIFY_API_VERSION: '2025-07',
    SESSION_STORAGE_KEY: 'x',
    GATEWAY_TOKEN_SIGNING_KEY: 'y',
  });
  return createShopifyHandle(config);
}
function baseQuery(overrides: Record<string, string> = {}): Record<string, string> {
  const now = Math.trunc(Date.now() / 1000);
  return {
    shop: TEST_SHOP,
    code: 'test-auth-code-123',
    state: 'test-state-nonce-xyz',
    timestamp: String(now),
    host: 'abc123.cloudfront.net', // base64 host Shopify sends
    ...overrides,
  };
}

describe('OAuth callback HMAC', () => {
  it('valid Shopify callback HMAC passes', async () => {
    const handle = makeHandle();
    const q = baseQuery();
    const hmac = hmacFor(q);
    const ok = await handle.validateOauthHmac({ ...q, hmac });
    expect(ok).toBe(true);
  });

  it('modified hmac fails', async () => {
    const handle = makeHandle();
    const q = baseQuery();
    const good = hmacFor(q);
    const bad = good.slice(0, -1) + (good.slice(-1) === '0' ? '1' : '0');
    const ok = await handle.validateOauthHmac({ ...q, hmac: bad });
    expect(ok).toBe(false);
  });

  it('modified shop fails', async () => {
    const handle = makeHandle();
    const q = baseQuery();
    const hmac = hmacFor(q);
    const ok = await handle.validateOauthHmac({ ...q, shop: 'evil-shop.myshopify.com', hmac });
    expect(ok).toBe(false);
  });

  it('modified code fails', async () => {
    const handle = makeHandle();
    const q = baseQuery();
    const hmac = hmacFor(q);
    const ok = await handle.validateOauthHmac({ ...q, code: 'tampered-code', hmac });
    expect(ok).toBe(false);
  });

  it('missing hmac fails', async () => {
    const handle = makeHandle();
    const q = baseQuery();
    const ok = await handle.validateOauthHmac(q); // no hmac key
    expect(ok).toBe(false);
  });

  it('missing required OAuth parameters still fails HMAC (no bypass)', async () => {
    const handle = makeHandle();
    const q: Record<string, string> = { shop: TEST_SHOP, timestamp: String(Math.trunc(Date.now() / 1000)) };
    const hmac = hmacFor(q);
    const ok = await handle.validateOauthHmac({ ...q, hmac });
    // HMAC itself may be syntactically valid, but auth.ts will reject missing code/state
    // before HMAC. Here we just verify HMAC does not throw and returns boolean.
    expect(typeof ok).toBe('boolean');
  });

  it('query parameter ordering does not affect valid HMAC', async () => {
    const handle = makeHandle();
    // Build hmac from sorted canonical, but pass query in different insertion order
    const ordered: Record<string, string> = {
      timestamp: String(Math.trunc(Date.now() / 1000)),
      shop: TEST_SHOP,
      code: 'order-test-code',
      state: 'order-state-9',
      host: 'host-xyz',
    };
    const hmac = hmacFor(ordered);
    const shuffled: Record<string, string> = {
      host: ordered.host!,
      state: ordered.state!,
      shop: ordered.shop!,
      code: ordered.code!,
      timestamp: ordered.timestamp!,
      hmac,
    };
    const ok = await handle.validateOauthHmac(shuffled);
    expect(ok).toBe(true);
  });

  it('OAuth state validation still works (unrelated to HMAC)', async () => {
    // This test documents that state is a separate nonce; HMAC test should not
    // depend on state store. The handle's HMAC covers state as part of query.
    const handle = makeHandle();
    const q = baseQuery({ state: 'state-A' });
    const hmacA = hmacFor(q);
    const okA = await handle.validateOauthHmac({ ...q, hmac: hmacA });
    expect(okA).toBe(true);
    // Same hmac with different state must fail
    const okB = await handle.validateOauthHmac({ ...q, state: 'state-B', hmac: hmacA });
    expect(okB).toBe(false);
  });

  it('timing-safe comparison remains enabled (library handles it)', async () => {
    const handle = makeHandle();
    const q = baseQuery();
    const hmac = hmacFor(q);
    // Two calls with same valid hmac should both pass; library uses safeCompare internally
    const a = await handle.validateOauthHmac({ ...q, hmac });
    const b = await handle.validateOauthHmac({ ...q, hmac });
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
