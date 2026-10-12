/**
 * PHASE 4 TESTS part 2: forwarding, errors, rate limits.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { TEST_CREDENTIALS, TEST_SHOP, createHarness } from './harness.js';
import { createCryptoBox } from '../src/services/crypto.js';
import { createRateLimiter } from '../src/services/rate-limiter.js';
import type { GraphqlTransport } from '../src/services/graphql.js';

const MACHINE = 'machine-token-0123456789abcdef-proxy';

function seedHash(shop: string): string {
  return createHmac('sha256', 'seai-gateway:machine:v1').update(`${shop}:${MACHINE}`).digest('hex');
}

function okTransport(handler: (body: unknown) => unknown): GraphqlTransport {
  return {
    async proxy(_shop: string, _token: string, body: unknown) {
      return { status: 200, headers: {}, body: handler(body) };
    },
  };
}

async function buildLinkedApp(opts: {
  transport: GraphqlTransport;
  perMinute?: number;
  account?: string;
}) {
  const h = createHarness({
    graphql: opts.transport,
    proxyRateLimiter: createRateLimiter(opts.perMinute ?? 240),
  });
  const box = createCryptoBox(TEST_CREDENTIALS.sessionStorageKey);
  const now = new Date();
  const account = opts.account ?? 'acct-proxy';
  // Encrypt a KNOWN Shopify token so we can assert it is forwarded — the
  // ciphertext is a TEST placeholder, never a real credential.
  await h.store.saveSession({
    shopDomain: TEST_SHOP,
    accessTokenCiphertext: await box.encrypt('shpat_test-shopify-token'),
    scope: 'read_products',
    isOnline: false,
    installedAt: now,
    updatedAt: now,
  });
  await h.store.saveStore({
    shopDomain: TEST_SHOP,
    seaiAccountId: account,
    linkState: 'linked',
    seaiMachineTokenHash: seedHash(TEST_SHOP),
    createdAt: now,
    updatedAt: now,
  });
  await h.store.saveMachineToken(TEST_SHOP, await box.encrypt(MACHINE), now);
  const ex = await h.req().post('/v1/graphql/exchange').send({ shop: TEST_SHOP, machineToken: MACHINE });
  return { h, token: String(ex.body.token) };
}

describe('proxy forwarding', () => {
  it('forwards the decrypted token server-side and relays the body verbatim', async () => {
    const seen: Array<{ shop: string; token: string }> = [];
    const { h, token } = await buildLinkedApp({
      transport: {
        async proxy(shop: string, accessToken: string, body: unknown) {
          seen.push({ shop, token: accessToken });
          return { status: 200, headers: { 'x-request-id': 'shopify-1' }, body };
        },
      },
    });
    const res = await h.req().post(`/v1/graphql/${TEST_SHOP}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ shop { id } }' });
    expect(res.status).toBe(200);
    expect(seen.length).toBe(1);
    expect(seen[0]?.shop).toBe(TEST_SHOP);
    expect(seen[0]?.token).toBe('shpat_test-shopify-token');
    expect(res.body).toEqual({ query: '{ shop { id } }' });
    expect(JSON.stringify(res.text)).not.toContain('shpat_test-shopify-token');
  });

  it('preserves Shopify GraphQL errors verbatim', async () => {
    const shopifyErrors = { errors: [{ message: 'Field foo does not exist', locations: [{ line: 1, column: 3 }] }] };
    const { h, token } = await buildLinkedApp({ transport: okTransport(() => shopifyErrors) });
    const res = await h.req().post(`/v1/graphql/${TEST_SHOP}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ foo }' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(shopifyErrors);
  });

  it('invalidates the session on Shopify 401 and surfaces shopify_unauthorized', async () => {
    const { h, token } = await buildLinkedApp({
      transport: { async proxy() { return { status: 401, headers: {}, body: { errors: [{ message: 'Unauthorized' }] } }; } },
    });
    const res = await h.req().post(`/v1/graphql/${TEST_SHOP}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ shop { id } }' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('shopify_unauthorized');
    expect(await h.store.findSession(TEST_SHOP)).toBeUndefined();
  });

  it('enforces the per-shop rate limit with Retry-After', async () => {
    const { h, token } = await buildLinkedApp({ transport: okTransport(() => ({ data: {} })), perMinute: 1 });
    const auth = { Authorization: `Bearer ${token}` };
    await h.req().post(`/v1/graphql/${TEST_SHOP}`).set(auth).send({ query: '{ a }' }).expect(200);
    const limited = await h.req().post(`/v1/graphql/${TEST_SHOP}`).set(auth).send({ query: '{ a }' });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeTruthy();
  });

  it('retries Shopify 429 honoring Retry-After (transport-level)', async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    const seq = [
      new Response(JSON.stringify({ errors: [{ message: 'throttled' }] }), { status: 429, headers: { 'retry-after': '0' } }),
      new Response(JSON.stringify({ data: { shop: { id: '1' } } }), { status: 200 }),
    ];
    vi.stubGlobal('fetch', (async () => seq[calls++] ?? seq[seq.length - 1]) as typeof fetch);
    try {
      const { createGraphqlTransport } = await import('../src/services/graphql.js');
      const { loadConfig } = await import('../src/config.js');
      const { createLogger } = await import('../src/logger.js');
      const config = loadConfig({ NODE_ENV: 'test', SHOPIFY_API_VERSION: '2025-07' });
      const transport = createGraphqlTransport(config, createLogger('silent'));
      const result = await transport.proxy(TEST_SHOP, 'tok', { query: '{ shop { id } }' });
      expect(calls).toBe(2);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ data: { shop: { id: '1' } } });
    } finally {
      vi.unstubAllGlobals();
      void realFetch;
    }
  });
});
