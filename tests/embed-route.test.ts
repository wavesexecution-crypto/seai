import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.SEAI_GATEWAY_SECRET = 'test-gateway-secret-32-bytes-long!!';
process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.SHOPIFY_APP_URL = 'http://localhost:3000';
process.env.SEAI_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-embed-route-'));
process.env.SEAI_SCHEDULER = 'off';

const b64url = (value: Buffer) => value.toString('base64url').replaceAll('=', '');
let testAccountId = 'user-123';
function mintTicket(o: Record<string, unknown> = {}): string {
  const now = Math.trunc(Date.now() / 1000);
  const p = { version: 1, shopDomain: 'demo-store.myshopify.com', seaiAccountId: testAccountId, nonce: randomBytes(16).toString('hex'), iat: now, exp: now + 300, ...o };
  const e = b64url(Buffer.from(JSON.stringify(p), 'utf-8'));
  return `${e}.${b64url(createHmac('sha256', process.env.SEAI_GATEWAY_SECRET!).update(e).digest())}`;
}

async function makeEmbedApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  const { embedRouter } = await import('../src/routes/embed.js');
  app.use('/embed', embedRouter);
  return app;
}

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(async () => {
  const { db } = await import('../src/db/db.js');
  await db.init();
  await db.migrate();
  const { createUser } = await import('../src/auth/service.js');
  const user = await createUser('Demo Operator', 'demo@example.com', 'Test-Password-123').catch(async () => {
    const { findUserByEmail } = await import('../src/auth/service.js');
    return findUserByEmail('demo@example.com');
  });
  if (user) testAccountId = user.id;
  await db.insert('shopify_sessions', { id: 'seed-route', shop: 'demo-store.myshopify.com', access_token_enc: 'tok', scope: 'read_products', is_online: false, updated_at: new Date().toISOString() } as Record<string, unknown>);

  server = createServer(await makeEmbedApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: any }> {
  const res = await fetch(baseUrl + path, { redirect: 'manual', headers });
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, body };
}

async function post(path: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: any }> {
  const isJson = typeof body !== 'string';
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: isJson ? JSON.stringify(body) : body,
    redirect: 'manual',
  });
  const contentType = res.headers.get('content-type') || '';
  const responseBody = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, body: responseBody };
}

function getSetCookies(headers: Headers): string[] {
  const raw: string[] = [];
  // Headers.getSetCookie() is available in Node 18+; fall back to raw header.
  if (typeof (headers as any).getSetCookie === 'function') {
    return (headers as any).getSetCookie();
  }
  const rawHeader = (headers as any).raw?.()['set-cookie'];
  return rawHeader || [];
}

describe('Phase 6 — /embed/activity route', () => {
  it('redirects to /activity?shop= with embedded cookie (SameSite=None + Secure)', async () => {
    const { db } = await import('../src/db/db.js');
    await db.insert('shopify_sessions', { id: 's-' + Date.now(), shop: 'demo-store.myshopify.com', access_token_enc: 'tok', scope: 'read_products', is_online: false, updated_at: new Date().toISOString() } as Record<string, unknown>);
    const res = await get(`/embed/activity?shop=demo-store.myshopify.com&ticket=${mintTicket()}`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    expect(location).toContain('/activity?shop=demo-store.myshopify.com');
    expect(location).not.toContain('ticket=');
    const cookies = getSetCookies(res.headers);
    const ec = cookies.find((c: string) => c.startsWith('seai_session_embedded='));
    expect(ec).toBeDefined();
    expect(ec).toContain('SameSite=None');
    expect(ec).toContain('Secure');
  });

  it('rejects invalid ticket (401)', async () => {
    const res = await get('/embed/activity?shop=demo-store.myshopify.com&ticket=bad.sig');
    expect(res.status).toBe(401);
  });

  it('rejects expired ticket (410)', async () => {
    const res = await get(`/embed/activity?shop=demo-store.myshopify.com&ticket=${mintTicket({ exp: Math.trunc(Date.now() / 1000) - 100 })}`);
    expect(res.status).toBe(410);
  });

  it('rejects replayed ticket (409)', async () => {
    const { verifyGatewayTicket, claimNonce } = await import('../src/shopify/embed-ticket.js');
    const t = mintTicket();
    const p = verifyGatewayTicket(t);
    await claimNonce(p.nonce, new Date(p.exp * 1000));
    const res = await get(`/embed/activity?shop=demo-store.myshopify.com&ticket=${t}`);
    expect(res.status).toBe(409);
  });

  it('rejects shop mismatch (400)', async () => {
    const res = await get(`/embed/activity?shop=demo-store.myshopify.com&ticket=${mintTicket({ shopDomain: 'other.myshopify.com' })}`);
    expect(res.status).toBe(400);
  });

  it('rejects unknown shop with unknown account (403)', async () => {
    const res = await get(`/embed/activity?shop=unknown.myshopify.com&ticket=${mintTicket({ shopDomain: 'unknown.myshopify.com', seaiAccountId: 'nonexistent-user-' + Date.now() })}`);
    expect(res.status).toBe(403);
  });

  it('allows delegated gateway ticket without local shopify_sessions (302)', async () => {
    // Delegated flow: gateway owns the Shopify token, SEAI has no local
    // shopify_sessions row for this shop, but a valid HMAC ticket for a
    // real SEAI user should still create an embedded session (gateway is
    // source of truth). This verifies the soft-check change.
    const res = await get(`/embed/activity?shop=unknown.myshopify.com&ticket=${mintTicket({ shopDomain: 'unknown.myshopify.com' })}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location') || '').toContain('/activity?shop=unknown.myshopify.com');
  });

  it('rejects missing params (400)', async () => {
    const res = await get('/embed/activity');
    expect(res.status).toBe(400);
  });

  it('does not leak secrets in errors', async () => {
    const res = await get('/embed/activity?shop=demo-store.myshopify.com&ticket=bad');
    expect(res.status).toBe(401);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.error).not.toContain(process.env.SEAI_GATEWAY_SECRET!);
  });
});
