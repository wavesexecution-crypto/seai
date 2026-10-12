/**
 * PHASE 3 TESTS part 2: connect callback (link-code verification + binding).
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { TEST_CREDENTIALS, TEST_SHOP } from './harness.js';
import { encodeBody, h, startLinkFlow } from './phase3-helpers.js';

export function mintLinkCode(params: {
  shopDomain: string;
  seaiAccountId: string;
  machineToken: string;
  nonce: string;
  expiresInSec?: number;
}): string {
  const now = Math.trunc(Date.now() / 1000);
  const body = encodeBody({
    version: 1,
    kind: 'seai-link',
    shopDomain: params.shopDomain,
    seaiAccountId: params.seaiAccountId,
    machineToken: params.machineToken,
    nonce: params.nonce,
    iat: now,
    exp: now + (params.expiresInSec ?? 300),
  });
  const sig = createHmac('sha256', TEST_CREDENTIALS.seaiWebhookSecret).update(body).digest('base64');
  return `${body}.${sig}`;
}

const callbackPath = (claim: string, code: string, shop: string = TEST_SHOP): string =>
  `/connect/callback?shop=${encodeURIComponent(shop)}&connect_claim=${encodeURIComponent(claim)}&code=${encodeURIComponent(code)}`;

const MACHINE = 'machine-token-0123456789abcdef';

describe('connect callback', () => {
  it('links the store and redirects to /embed/activity', async () => {
    const claim = await startLinkFlow();
    const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'acct-42', machineToken: MACHINE, nonce: 'cb-1' });
    const res = await h.req().get(callbackPath(claim, code));
    expect(res.status).toBe(302);
    expect(String(res.headers.location)).toContain('/embed/activity');
    const row = await h.store.findStore(TEST_SHOP);
    expect(row?.linkState).toBe('linked');
    expect(row?.seaiAccountId).toBe('acct-42');
    expect(row?.seaiMachineTokenHash).toBeTruthy();
    const machine = await h.store.findMachineToken(TEST_SHOP);
    expect(machine?.ciphertext).toBeTruthy();
    expect(machine?.ciphertext).not.toContain(MACHINE);
  });

  it('rejects a tampered claim signature', async () => {
    const claim = await startLinkFlow();
    const parsed = JSON.parse(Buffer.from(claim.split('.')[0] as string, 'base64url').toString('utf-8')) as Record<string, unknown>;
    const tamperedBody = encodeBody({ ...parsed, shopDomain: 'evil.myshopify.com' });
    const tampered = `${tamperedBody}.${claim.split('.')[1]}`;
    const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'a', machineToken: MACHINE, nonce: 'cb-tamper' });
    const res = await h.req().get(callbackPath(tampered, code));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_claim');
  });

  it('rejects a claim bound to a different shop', async () => {
    const claim = await startLinkFlow();
    const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'a', machineToken: MACHINE, nonce: 'cb-shop' });
    const res = await h.req().get(callbackPath(claim, code, 'other.myshopify.com'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_claim');
  });

  it('rejects a reused claim nonce (replay)', async () => {
    const claim = await startLinkFlow();
    const first = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'a', machineToken: MACHINE, nonce: 'cb-r-a' });
    const second = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'a', machineToken: MACHINE, nonce: 'cb-r-b' });
    await h.req().get(callbackPath(claim, first)).expect(302);
    const res = await h.req().get(callbackPath(claim, second));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_claim');
  });

  it('rejects a link code with the wrong secret', async () => {
    const claim = await startLinkFlow();
    const now = Math.trunc(Date.now() / 1000);
    const body = encodeBody({
      version: 1, kind: 'seai-link', shopDomain: TEST_SHOP, seaiAccountId: 'a',
      machineToken: MACHINE, nonce: 'cb-wrong', iat: now, exp: now + 300,
    });
    const badSig = createHmac('sha256', 'wrong-secret').update(body).digest('base64');
    const res = await h.req().get(callbackPath(claim, `${body}.${badSig}`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_code');
  });

  it('rejects a replayed link-code nonce', async () => {
    const firstClaim = await startLinkFlow();
    const secondClaim = await startLinkFlow();
    const shared = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'a', machineToken: MACHINE, nonce: 'cb-shared' });
    await h.req().get(callbackPath(firstClaim, shared)).expect(302);
    const res = await h.req().get(callbackPath(secondClaim, shared));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_code');
  });

  it('rejects a missing code', async () => {
    const claim = await startLinkFlow();
    const res = await h.req().get(`/connect/callback?shop=${encodeURIComponent(TEST_SHOP)}&connect_claim=${encodeURIComponent(claim)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_callback');
  });

  it('preserves the link across session refresh (reinstall)', async () => {
    const claim = await startLinkFlow();
    const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'acct-keep', machineToken: MACHINE, nonce: 'cb-reinstall' });
    await h.req().get(callbackPath(claim, code)).expect(302);
    await h.installSession(TEST_SHOP);
    const row = await h.store.findStore(TEST_SHOP);
    expect(row?.linkState).toBe('linked');
    expect(row?.seaiAccountId).toBe('acct-keep');
  });

  it('rejects an expired claim', async () => {
    const claim = await startLinkFlow();
    const parsed = JSON.parse(
      Buffer.from(claim.split('.')[0] as string, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    // Expire the claim by hand: re-sign with an `exp` in the past. The
    // callback must reject it as expired (not accept the signature as proof).
    const now = Math.trunc(Date.now() / 1000);
    const expiredBody = encodeBody({ ...parsed, iat: now - 700, exp: now - 100 });
    const expiredSig = createHmac('sha256', TEST_CREDENTIALS.seaiWebhookSecret)
      .update(expiredBody)
      .digest('base64');
    const expiredClaim = `${expiredBody}.${expiredSig}`;
    const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'a', machineToken: MACHINE, nonce: 'cb-expired' });
    const res = await h.req().get(callbackPath(expiredClaim, code));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('claim_expired');
  });
});
