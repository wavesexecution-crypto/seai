/**
 * PHASE 2 SECURITY TEST SUITE (against the ACTUAL gateway API surface).
 *
 * Session-token validation, shop binding, SEAI tickets (one-time use, Replay protection), and the embedded entry routes. * All assertions are aligned to the gateway source (harness, embed route,  * ticket.issue/verify), not to placeholders. */

import { beforeAll, describe, expect, it } from 'vitest';
import { b64urlJson, createHarness, OMIT_ISS, TEST_CREDENTIALS, TEST_SHOP, type Harness } from './harness.js';
import { createHmac } from 'node:crypto';

let h: Harness;

beforeAll(() => {
  h = createHarness();
});

const AUTH = (token: string) => ({ Authorization: `Bearer ${token}`, 'x-shopify-shop-domain': TEST_SHOP });

function signJwt(payload: object, secret: string): string {
  const b64url = (value: Buffer) => value.toString('base64url').replaceAll('=', '');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const signature = b64url(createHmac('sha256', secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------- sessions --

describe('session-token validation', () => {
  it('accepts a valid JWT and responds 302 to SEAI dashboard with ticket', async () => {
    await h.linkStore({ seaiAccountId: 'acct-1' });
    await h.installSession();
    const res = await h.req().get('/embed/activity').set(AUTH(h.mintSessionToken()));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${TEST_CREDENTIALS.seaiBaseUrl}/activity`);
    expect(res.headers.location).toContain('shop=' + encodeURIComponent(TEST_SHOP));
    expect(res.headers.location).toContain('ticket=');
  });

  it('rejects an expired JWT', async () => {
    const res = await h.req().get('/embed/activity')
      .set(AUTH(h.mintSessionToken({ expiresInSec: -60 })))
      .expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects an invalid JWT (bad signature)', async () => {
    const res = await h.req().get('/embed/activity')
      .set(AUTH(h.mintSessionToken({ signingSecret: 'wrong-signing-secret' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a JWT that is not yet valid (nbf in the future)', async () => {
    const now = Math.trunc(Date.now() / 1000);
    const payload = {
      iss: `https://${TEST_SHOP}/admin`,
      dest: `https://${TEST_SHOP}`,
      aud: TEST_CREDENTIALS.apiKey,
      sub: 'u',
      exp: now + 60,
      nbf: now + 30,
      iat: now,
      jti: 'x',
      sid: 's',
    };
    const token = signJwt(payload, TEST_CREDENTIALS.apiSecret);
    const res = await h.req().get('/embed/activity').set(AUTH(token)).expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a JWT with a wrong audience (aud != api key)', async () => {
    const res = await h.req().get('/embed/activity')
      .set(AUTH(h.mintSessionToken({ aud: 'some-other-app' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a JWT with a wrong destination (dest != verified shop)', async () => {
    const token = h.mintSessionToken({ dest: 'https://other-shop.myshopify.com' });
    const res = await h.req().get('/embed/activity')
      .set({ Authorization: `Bearer ${token}`, 'x-shopify-shop-domain': TEST_SHOP })
      .expect(401);
    expect(res.body.error).toBe('shop_mismatch');
  });

  it('rejects a JWT with a malformed destination', async () => {
    const res = await h.req().get('/embed/activity')
      .set(AUTH(h.mintSessionToken({ dest: 'not-a-shop-domain' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a JWT with a missing subject (sub)', async () => {
    const now = Math.trunc(Date.now() / 1000);
    const payload = {
      iss: `https://${TEST_SHOP}/admin`,
      dest: `https://${TEST_SHOP}`,
      aud: TEST_CREDENTIALS.apiKey,
      exp: now + 60,
      nbf: now - 1,
      iat: now,
      jti: 'x',
      sid: 's',
    };
    const token = signJwt(payload, TEST_CREDENTIALS.apiSecret);
    const res = await h.req().get('/embed/activity').set(AUTH(token)).expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a JWT with a missing issuer (iss)', async () => {
    const res = await h.req().get('/embed/activity').set(AUTH(h.mintSessionToken({ iss: OMIT_ISS }))).expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a JWT with a mismatched issuer (iss != https://shop/admin)', async () => {
    const res = await h.req().get('/embed/activity')
      .set(AUTH(h.mintSessionToken({ iss: 'https://evil.example.test/admin' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('rejects a request missing the x-shopify-shop-domain header', async () => {
    const res = await h.req().get('/embed/activity').set({ Authorization: `Bearer ${h.mintSessionToken()}` }).expect(401);
    expect(res.body.error).toBe('missing_shop_header');
  });

  it('rejects a request with a shop header mismatch', async () => {
    const res = await h.req().get('/embed/activity')
      .set({ Authorization: `Bearer ${h.mintSessionToken()}`, 'x-shopify-shop-domain': 'other-shop.myshopify.com' })
      .expect(401);
    expect(res.body.error).toBe('shop_mismatch');
  });

  it('rejects a request with a missing Authorization header', async () => {
    const res = await h.req().get('/embed/activity').expect(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('rejects a request with a non-Bearer Authorization header', async () => {
    const res = await h.req().get('/embed/activity')
      .set({ Authorization: `Basic ${b64urlJson({ user: 'x' })}`, 'x-shopify-shop-domain': TEST_SHOP })
      .expect(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('rejects a completely malformed token', async () => {
    const res = await h.req().get('/embed/activity')
      .set({ Authorization: 'Bearer not-a-jwt', 'x-shopify-shop-domain': TEST_SHOP })
      .expect(401);
    expect(res.body.error).toBe('invalid_token');
  });
});

// ----------------------------------------------------------------- tickets --

describe('SEAI ticket security', () => {
  it('mints a one-time ticket and redeems it exactly once (replay rejection)', async () => {
    const ticket = await h.tickets.issue(TEST_SHOP, 'acct-1', 300);
    await h.tickets.verify(ticket);
    await expect(h.tickets.verify(ticket)).rejects.toThrow(/already been used/i);
  });

  it('rejects an expired ticket', async () => {
    const ticket = await h.tickets.issue(TEST_SHOP, 'acct-1', -1);
    await expect(h.tickets.verify(ticket)).rejects.toThrow(/expired/i);
  });

  it('rejects a ticket with an invalid signature', async () => {
    const ticket = await h.tickets.issue(TEST_SHOP, 'acct-1', 300);
    const [encoded] = ticket.split('.') as [string, string];
    const forgedBody = b64urlJson({
      version: 1,
      shopDomain: 'evil-shop.myshopify.com',
      seaiAccountId: 'x',
      nonce: 'forged-nonce-invalid-sig',
      iat: 0,
      exp: 9999999999,
    });
    // Body swapped, original signature retained -> HMAC must fail.
    void encoded;
    const [, originalSignature] = ticket.split('.') as [string, string];
    await expect(h.tickets.verify(`${forgedBody}.${originalSignature}`)).rejects.toThrow(
      /signature verification failed/i,
    );
  });

  it('rejects a tampered payload (body modified, signature unchanged)', async () => {
    const ticket = await h.tickets.issue(TEST_SHOP, 'acct-1', 300);
    const [, signature] = ticket.split('.') as [string, string];
    const forgedBody = b64urlJson({
      shopDomain: 'evil-shop.myshopify.com',
      nonce: 'x',
      exp: 9999999999,
      version: 1,
      seaiAccountId: 'x',
      iat: 0,
    });
    await expect(h.tickets.verify(`${forgedBody}.${signature}`)).rejects.toThrow();
  });

  it('rejects a completely malformed ticket', async () => {
    await expect(h.tickets.verify('not-a-ticket')).rejects.toThrow();
  });

  it('rejects a ticket whose payload is not valid JSON', async () => {
    const notJson = Buffer.from('this is not json {{{', 'utf-8').toString('base64url');
    const forged = `${notJson}.${signTicketBody(notJson)}`;
    await expect(h.tickets.verify(forged)).rejects.toThrow(/not valid JSON/i);
  });

  it('rejects a ticket with a future not_yet_valid iat', async () => {
    const payload = {
      version: 1,
      shopDomain: TEST_SHOP,
      seaiAccountId: 'acct-1',
      nonce: 'future-nonce',
      iat: Math.trunc(Date.now() / 1000) + 300,
      exp: Math.trunc(Date.now() / 1000) + 600,
    };
    const forged = `${b64urlJson(payload)}.${signTicketBody(b64urlJson(payload))}`;
    await expect(h.tickets.verify(forged)).rejects.toThrow(/not yet valid/i);
  });

  it('ticket payload does not leak the Shopify access token', async () => {
    const ticket = await h.tickets.issue(TEST_SHOP, 'acct-1', 300);
    const parts = ticket.split('.');
    expect(parts.length).toBe(2);
const payload = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf-8'));
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(['version', 'shopDomain', 'seaiAccountId', 'nonce', 'iat', 'exp']),
    );
    expect(JSON.stringify(payload)).not.toContain('accessToken');
    expect(JSON.stringify(payload)).not.toContain('ciphertext');
  });
});

// ------------------------------------------------------ embedded routes ---

describe('embedded entry routes', () => {
  it('GET /embed/activity (linked store) -> 302 to SEAI dashboard with ticket', async () => {
    await h.linkStore({ seaiAccountId: 'acct-1' });
    const res = await h.req().get('/embed/activity').set(AUTH(h.mintSessionToken()));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${TEST_CREDENTIALS.seaiBaseUrl}/activity`);
    expect(res.headers.location).toContain('shop=' + encodeURIComponent(TEST_SHOP));
    expect(res.headers.location).toContain('ticket=');
  });

  it('GET /embed/activity (unlinked store) -> 302 to /connect/start', async () => {
    await h.linkStore({ state: 'pending' });
    const res = await h.req().get('/embed/activity').set(AUTH(h.mintSessionToken()));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/connect/start');
    expect(res.headers.location).toContain(encodeURIComponent(TEST_SHOP));
  });

  it('GET /embed/activity (not installed) -> 401 store_not_installed', async () => {
    const token = h.mintSessionToken({ shopDomain: 'unknown-shop.myshopify.com' });
    const res = await h.req().get('/embed/activity')
      .set({ Authorization: `Bearer ${token}`, 'x-shopify-shop-domain': 'unknown-shop.myshopify.com' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('store_not_installed');
  });

  it('GET /embed returns HTML (App Bridge bootstrap) for a valid shop param', async () => {
    const res = await h.req().get(`/embed?shop=${encodeURIComponent(TEST_SHOP)}`).expect(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('app-bridge');
    expect(res.text).toContain('apiKey:');
    expect(res.text).toContain(escapeHtml(TEST_SHOP));
  });

  it('GET /embed returns 400 when shop param is missing', async () => {
    const res = await h.req().get('/embed').expect(400);
    expect(res.text).toContain('Missing shop');
  });
});

function signTicketBody(encodedBody: string): string {
  // Tickets are HMAC-SHA256(base64) over the base64url body, keyed by the
  // gateway ticket signing key (GATEWAY_TOKEN_SIGNING_KEY in production;
  // TEST_CREDENTIALS.gatewayTokenSigningKey here).
  return createHmac('sha256', TEST_CREDENTIALS.gatewayTokenSigningKey)
    .update(encodedBody)
    .digest('base64');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}