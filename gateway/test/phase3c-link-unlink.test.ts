/**
 * PHASE 3 TESTS part 3: unlink + no-token-leak invariant.
 */
import { describe, expect, it } from 'vitest';
import { TEST_SHOP } from './harness.js';
import { AUTH, h, startLinkFlow } from './phase3-helpers.js';
import { mintLinkCode } from './phase3b-link-callback.test.js';

const MACHINE = 'machine-token-0123456789abcdef';

async function linkForUnlink(nonce: string, account = 'acct-7'): Promise<void> {
  const claim = await startLinkFlow();
  const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: account, machineToken: MACHINE, nonce });
  await h.req().get(`/connect/callback?shop=${encodeURIComponent(TEST_SHOP)}&connect_claim=${encodeURIComponent(claim)}&code=${encodeURIComponent(code)}`).expect(302);
}

describe('unlink', () => {
  it('revokes the link, clears the machine token, keeps the session', async () => {
    await linkForUnlink('cb-unlink-1');
    const res = await h.req().post('/connect/unlink').set(AUTH(h.mintSessionToken())).expect(200);
    expect(res.body.linkState).toBe('revoked');
    const row = await h.store.findStore(TEST_SHOP);
    expect(row?.linkState).toBe('revoked');
    expect(row?.seaiMachineTokenHash).toBeUndefined();
    expect(await h.store.findMachineToken(TEST_SHOP)).toBeUndefined();
    expect(await h.store.findSession(TEST_SHOP)).toBeTruthy();
  });

  it('returns 404 when nothing is linked', async () => {
    await h.installSession();
    await h.linkStore({});
    const res = await h.req().post('/connect/unlink').set(AUTH(h.mintSessionToken()));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_linked');
  });

  it('requires Shopify auth', async () => {
    const res = await h.req().post('/connect/unlink');
    expect(res.status).toBe(401);
  });
});

describe('no token leak', () => {
  it('never exposes Shopify or machine tokens in connect responses', async () => {
    const machineToken = 'machine-token-0123456789abcdef-secret';
    const claim = await startLinkFlow();
    const code = mintLinkCode({ shopDomain: TEST_SHOP, seaiAccountId: 'acct-1', machineToken, nonce: 'cb-leak-1' });
    const cb = await h.req().get(`/connect/callback?shop=${encodeURIComponent(TEST_SHOP)}&connect_claim=${encodeURIComponent(claim)}&code=${encodeURIComponent(code)}`);
    expect(JSON.stringify(cb.body ?? '')).not.toContain(machineToken);
    expect(String(cb.headers.location ?? '')).not.toContain(machineToken);
  });
});
