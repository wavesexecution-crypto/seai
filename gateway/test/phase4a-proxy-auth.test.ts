/**
 * PHASE 4 TESTS part 1: exchange + auth guards.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { TEST_CREDENTIALS, TEST_SHOP } from './harness.js';
import { h } from './phase3-helpers.js';
import { createCryptoBox } from '../src/services/crypto.js';

const MACHINE = 'machine-token-0123456789abcdef-proxy';

async function seedLinkedStore(shop: string = TEST_SHOP, account = 'acct-proxy'): Promise<void> {
  const box = createCryptoBox(TEST_CREDENTIALS.sessionStorageKey);
  await h.installSession(shop);
  const now = new Date();
  const hash = createHmac('sha256', 'seai-gateway:machine:v1').update(`${shop}:${MACHINE}`).digest('hex');
  await h.store.saveStore({
    shopDomain: shop,
    seaiAccountId: account,
    linkState: 'linked',
    seaiMachineTokenHash: hash,
    createdAt: now,
    updatedAt: now,
  });
  await h.store.saveMachineToken(shop, await box.encrypt(MACHINE), now);
}

describe('proxy exchange', () => {
  it('exchanges a valid machine token for a short-lived gateway token', async () => {
    await seedLinkedStore();
    const res = await h.req().post('/v1/graphql/exchange').send({ shop: TEST_SHOP, machineToken: MACHINE });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.split('.').length).toBe(3);
  });

  it('rejects a wrong machine token', async () => {
    await seedLinkedStore();
    const res = await h.req().post('/v1/graphql/exchange').send({ shop: TEST_SHOP, machineToken: 'wrong-token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_machine_token');
  });

  it('rejects exchange for an unlinked store', async () => {
    const res = await h.req().post('/v1/graphql/exchange').send({ shop: 'nope.myshopify.com', machineToken: MACHINE });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('store_not_linked');
  });
});

describe('proxy auth guards', () => {
  it('requires a gateway token', async () => {
    const res = await h.req().post(`/v1/graphql/${TEST_SHOP}`).send({ query: '{ shop { id } }' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('rejects a token issued for another shop', async () => {
    await seedLinkedStore();
    await seedLinkedStore('other.myshopify.com', 'acct-other');
    const ex = await h.req().post('/v1/graphql/exchange').send({ shop: TEST_SHOP, machineToken: MACHINE });
    const token = String(ex.body.token);
    const res = await h.req().post('/v1/graphql/other.myshopify.com')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ shop { id } }' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('shop_mismatch');
  });

  it('rejects unsupported api_version overrides', async () => {
    await seedLinkedStore();
    const ex = await h.req().post('/v1/graphql/exchange').send({ shop: TEST_SHOP, machineToken: MACHINE });
    const res = await h.req().post(`/v1/graphql/${TEST_SHOP}?api_version=2026-07`)
      .set('Authorization', `Bearer ${ex.body.token}`)
      .send({ query: '{ shop { id } }' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('unsupported_api_version');
  });

  it('rejects a missing query', async () => {
    await seedLinkedStore();
    const ex = await h.req().post('/v1/graphql/exchange').send({ shop: TEST_SHOP, machineToken: MACHINE });
    const res = await h.req().post(`/v1/graphql/${TEST_SHOP}`)
      .set('Authorization', `Bearer ${ex.body.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_query');
  });
});
