import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.SEAI_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
process.env.SEAI_GATEWAY_SECRET = 'test-gateway-secret-32-bytes-long!!';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://ops.seai.store/api/ops/social/oauth/google/callback';
process.env.SEAI_DATA_DIR = '';
process.env.NODE_ENV = 'test';

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let sessionCookie: string | null = null;

beforeAll(async () => {
  const { db } = await import('../src/db/db.js');
  await db.init();
  const { createUser, validateSession, createSession } = await import('../src/auth/service.js');
  try { await createUser('Test Owner', 'owner@seai.test', 'Test-Password-123'); } catch { /* exists */ }

  // Make the test user an owner so they can access staff routes
  const user = await db.list('users', { email: 'owner@seai.test' }, 1);
  if (user[0]) await db.update('users', user[0].id, { role: 'owner' });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { socialOAuthRouter } = await import('../src/ops/social-oauth.js');
  app.use('/api/ops/social/oauth', socialOAuthRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  // Create a session for the owner user
  const owner = await db.list('users', { email: 'owner@seai.test' }, 1);
  const token = await createSession(owner[0].id);
  sessionCookie = `seai_session=${token}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reqHeaders(cookie?: string) {
  const h: Record<string, string> = {};
  if (cookie) h['Cookie'] = cookie;
  return h;
}

describe('Google OAuth — callback method', () => {
  it('GET /google/url returns auth_url', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/url`, {
      headers: reqHeaders(sessionCookie),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.auth_url).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(body.auth_url).toContain('client_id=');
    expect(body.auth_url).toContain('redirect_uri=');
    expect(body.auth_url).toContain('state=');
    expect(body.auth_url).toContain('response_type=code');
    expect(body.auth_url).toContain('access_type=offline');
  });

  it('GET /google/url requires authentication', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/url`);
    expect(res.status).toBe(401);
  });

  it('GET /google/callback with missing params redirects with error', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback`, {
      headers: reqHeaders(sessionCookie),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=missing_params');
  });

  it('GET /google/callback with invalid state redirects with error', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback?code=fake_code&state=invalid_state_xyz`, {
      headers: reqHeaders(sessionCookie),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=invalid_state');
  });

  it('GET /google/callback requires authentication', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback?code=x&state=y`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
  });

  it('POST /google/callback with invalid state returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback`, {
      method: 'POST',
      headers: { ...reqHeaders(sessionCookie), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'fake_code', redirect_uri: 'https://ops.seai.store/api/ops/social/oauth/google/callback', state: 'invalid_state' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid or expired OAuth state');
  });

  it('POST /google/callback requires authentication', async () => {
    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x', redirect_uri: 'https://example.com/cb', state: 'y' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /google/callback with valid state and fake code returns error (no real Google creds)', async () => {
    // First get a valid state from /google/url
    const urlRes = await fetch(`${baseUrl}/api/ops/social/oauth/google/url`, {
      headers: reqHeaders(sessionCookie),
    });
    const urlBody = await urlRes.json();
    const authUrl = urlBody.auth_url as string;
    const stateMatch = authUrl.match(/state=([^&]+)/);
    const state = stateMatch ? decodeURIComponent(stateMatch[1]) : '';

    const res = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback?code=fake_auth_code&state=${encodeURIComponent(state)}`, {
      headers: reqHeaders(sessionCookie),
      redirect: 'manual',
    });
    // Since GOOGLE_CLIENT_ID/SECRET are not set in test env, callback returns error redirect
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=');
  });

  it('consumes state nonce (replay with same state is rejected)', async () => {
    const urlRes = await fetch(`${baseUrl}/api/ops/social/oauth/google/url`, {
      headers: reqHeaders(sessionCookie),
    });
    const urlBody = await urlRes.json();
    const authUrl = urlBody.auth_url as string;
    const stateMatch = authUrl.match(/state=([^&]+)/);
    const state = stateMatch ? decodeURIComponent(stateMatch[1]) : '';

    // First call with this state
    await fetch(`${baseUrl}/api/ops/social/oauth/google/callback?code=code1&state=${encodeURIComponent(state)}`, {
      headers: reqHeaders(sessionCookie),
      redirect: 'manual',
    });

    // Second call with same state should fail (already consumed)
    const res2 = await fetch(`${baseUrl}/api/ops/social/oauth/google/callback?code=code2&state=${encodeURIComponent(state)}`, {
      headers: reqHeaders(sessionCookie),
      redirect: 'manual',
    });
    expect(res2.status).toBe(302);
    expect(res2.headers.get('location')).toContain('error=invalid_state');
  });
});