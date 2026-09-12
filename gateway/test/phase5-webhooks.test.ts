/**
 * PHASE 5 TESTS: webhook HMAC, idempotency, lifecycle handlers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { TEST_CREDENTIALS, TEST_SHOP, createHarness, type Harness } from './harness.js';

let h: Harness;
beforeEach(() => {
  h = createHarness();
});

function signBody(rawBody: string): string {
  return createHmac('sha256', TEST_CREDENTIALS.apiSecret).update(rawBody, 'utf-8').digest('base64');
}

function postWebhook(topic: string, payload: object, webhookId: string, shop: string = TEST_SHOP) {
  const rawBody = JSON.stringify(payload);
  return h.req().post(`/webhooks/${topic}`)
    .set('Content-Type', 'application/json')
    .set('X-Shopify-Topic', topic.toUpperCase().replace('/', '_'))
    .set('X-Shopify-Shop-Domain', shop)
    .set('X-Shopify-Hmac-Sha256', signBody(rawBody))
    .set('X-Shopify-Webhook-Id', webhookId)
    .set('X-Shopify-Api-Version', '2025-07')
    .send(rawBody);
}

describe('webhook security', () => {
  it('rejects an invalid HMAC without processing', async () => {
    const rawBody = JSON.stringify({ id: 1 });
    const res = await h.req().post('/webhooks/app/uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'APP_UNINSTALLED')
      .set('X-Shopify-Shop-Domain', TEST_SHOP)
      .set('X-Shopify-Hmac-Sha256', 'invalid-hmac')
      .set('X-Shopify-Webhook-Id', 'w-bad')
      .set('X-Shopify-Api-Version', '2025-07')
      .send(rawBody)
      .expect(401);
    expect(res.body.error).toBe('invalid_hmac');
  });

  it('rejects a tampered body (signature over different bytes)', async () => {
    const signed = JSON.stringify({ id: 1 });
    const res = await h.req().post('/webhooks/app/uninstalled')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'APP_UNINSTALLED')
      .set('X-Shopify-Shop-Domain', TEST_SHOP)
      .set('X-Shopify-Hmac-Sha256', signBody(signed))
      .set('X-Shopify-Webhook-Id', 'w-tamper')
      .set('X-Shopify-Api-Version', '2025-07')
      .send(JSON.stringify({ id: 2 }))
      .expect(401);
    expect(res.body.error).toBe('invalid_hmac');
  });

  it('rejects unknown topics', async () => {
    const res = await postWebhook('orders/create', { id: 1 }, 'w-unknown');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_topic');
  });
});

describe('webhook idempotency', () => {
  it('processes once and marks duplicates without re-running handlers', async () => {
    await h.installSession();
    const first = await postWebhook('shop/update', { name: 'Shop A' }, 'w-dup-1');
    expect(first.status).toBe(200);
    const second = await postWebhook('shop/update', { name: 'Shop A' }, 'w-dup-1');
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    const row = await h.store.findStore(TEST_SHOP);
    expect(row?.storeName).toBe('Shop A');
  });
});

describe('lifecycle handlers', () => {
  it('app/uninstalled revokes the session, machine token, and link', async () => {
    const box = (await import('../src/services/crypto.js')).createCryptoBox(TEST_CREDENTIALS.sessionStorageKey);
    await h.installSession();
    const now = new Date();
    await h.store.saveStore({
      shopDomain: TEST_SHOP, seaiAccountId: 'acct-u', linkState: 'linked',
      seaiMachineTokenHash: 'hash', createdAt: now, updatedAt: now,
    });
    await h.store.saveMachineToken(TEST_SHOP, await box.encrypt('machine-token-0123456789abcdef'), now);
    const res = await postWebhook('app/uninstalled', {}, 'w-uninstall-1');
    expect(res.status).toBe(200);
    expect(await h.store.findSession(TEST_SHOP)).toBeUndefined();
    expect(await h.store.findMachineToken(TEST_SHOP)).toBeUndefined();
    expect((await h.store.findStore(TEST_SHOP))?.linkState).toBe('revoked');
  });

  it('shop/update refreshes the store name', async () => {
    const res = await postWebhook('shop/update', { name: 'New Name' }, 'w-shop-1');
    expect(res.status).toBe(200);
    expect((await h.store.findStore(TEST_SHOP))?.storeName).toBe('New Name');
  });

  it('app/update is acknowledged', async () => {
    const res = await postWebhook('app/update', {}, 'w-appupd-1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('shop/redact purges all local data', async () => {
    await h.installSession();
    const now = new Date();
    await h.store.saveStore({ shopDomain: TEST_SHOP, linkState: 'pending', createdAt: now, updatedAt: now });
    const res = await postWebhook('shop/redact', { shop_domain: TEST_SHOP }, 'w-redact-1');
    expect(res.status).toBe(200);
    expect(await h.store.findSession(TEST_SHOP)).toBeUndefined();
    expect(await h.store.findStore(TEST_SHOP)).toBeUndefined();
  });
});

