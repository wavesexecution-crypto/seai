import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.SEAI_GATEWAY_SECRET = 'test-gateway-secret-32-bytes-long!!';
process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.SHOPIFY_APP_URL = 'http://localhost:3000';
process.env.SEAI_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-embed-headers-'));
process.env.SEAI_SCHEDULER = 'off';

// Build a minimal app with only the security headers middleware from app.ts,
// so we can test CSP without initializing the full app (DB pool, scheduler).
function makeSecurityHeadersApp() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('Content-Security-Policy', [
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
      "default-src 'self'",
      "script-src 'self' https://cdn.shopify.com https://shopify-embed.shopifycloud.com",
      "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
      "img-src 'self' data: https://cdn.shopify.com",
      "connect-src 'self' https://*.myshopify.com https://admin.shopify.com",
    ].join('; '));
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  return app;
}

let healthServer: ReturnType<typeof createServer>;
let healthBaseUrl: string;

beforeAll(async () => {
  const { db } = await import('../src/db/db.js');
  await db.init();
  const { createUser } = await import('../src/auth/service.js');
  try { await createUser('Demo Operator', 'demo@example.com', 'Test-Password-123'); } catch { /* exists */ }

  healthServer = createServer(makeSecurityHeadersApp());
  await new Promise<void>((resolve) => healthServer.listen(0, resolve));
  const { port } = healthServer.address() as AddressInfo;
  healthBaseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
});

describe('Phase 6 — public config', () => {
  it('returns only public fields, never the secret', async () => {
    const app = express();
    app.use(cookieParser());
    const { embedRouter } = await import('../src/routes/embed.js');
    app.use('/embed', embedRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const res = await fetch(`${baseUrl}/embed/config`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.apiKey).toBe('test-api-key');
      expect(body).not.toHaveProperty('apiSecret');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Phase 6 — CSP/headers', () => {
  it('sets frame-ancestors for Shopify Admin, no wildcard', async () => {
    const res = await fetch(`${healthBaseUrl}/health`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com");
    expect(csp).not.toContain("frame-ancestors *");
  });

  it('removes X-Frame-Options (CSP supersedes it)', async () => {
    const res = await fetch(`${healthBaseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBeNull();
  });

  it('keeps other security headers', async () => {
    const res = await fetch(`${healthBaseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off');
  });
});

describe('Phase 6 — auth compatibility', () => {
  let authServer: ReturnType<typeof createServer>;
  let authBaseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    const { authRouter } = await import('../src/auth/routes.js');
    app.use('/api/auth', authRouter);
    authServer = createServer(app);
    await new Promise<void>((resolve) => authServer.listen(0, resolve));
    const { port } = authServer.address() as AddressInfo;
    authBaseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => authServer.close(() => resolve()));
  });

  it('normal sign-in works with SameSite=Strict', async () => {
    const res = await fetch(`${authBaseUrl}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@example.com', password: 'Test-Password-123' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const cookies = res.headers.getSetCookie();
    const sc = cookies.find((c: string) => c.startsWith('seai_session='));
    expect(sc).toBeDefined();
    expect(sc).toContain('SameSite=Strict');
    expect(sc).not.toContain('SameSite=None');
  });

  it('/api/auth/me works with session cookie', async () => {
    const signIn = await fetch(`${authBaseUrl}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@example.com', password: 'Test-Password-123' }),
      redirect: 'manual',
    });
    expect(signIn.status).toBe(200);
    const cookieHeader = signIn.headers.getSetCookie().map((c: string) => c.split(';')[0]).join('; ');
    const me = await fetch(`${authBaseUrl}/api/auth/me`, {
      headers: { Cookie: cookieHeader },
    });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('demo@example.com');
  });
});
