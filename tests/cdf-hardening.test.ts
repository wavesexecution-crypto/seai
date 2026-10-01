import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { setMailDryRun, resetMailSender } from '../src/mail/dispatch.js';
import { drainPendingMail } from '../src/mail/pending.js';

// K-20 (completion authorisation), K-59 (health disclosure), K-60 (website
// lifecycle emitters) and the scheduled-maintenance route, exercised over real
// HTTP so status codes, guards and tenant scoping are proven at the boundary.
// The harness matches tests/embed-route.test.ts (node:http + fetch) rather than
// adding a test-only dependency.

const STAFF = 'test-staff-key-0123456789';
let server: Server;
let base = '';
let customerACookie = '';
let customerAId = '';
let customerBId = '';
let requestAId = '';
const createdUserIds: string[] = [];

interface Res { status: number; body: any; cookie: string }

async function call(
  method: string,
  path: string,
  opts: { cookie?: string; bearer?: string; body?: unknown } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* html error page */ }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((c) => c.startsWith('seai_session='));
  return { status: res.status, body, cookie: session ? session.split(';')[0] : '' };
}

const pw = (tag: string) => `Seai-Test-${tag}-2026-x`;

async function signUp(tag: string): Promise<{ cookie: string; id: string }> {
  const email = `hardening-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  const res = await call('POST', '/api/auth/sign-up', {
    body: { fullName: `Test ${tag}`, email, password: pw(tag), confirmPassword: pw(tag) },
  });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return { cookie: res.cookie, id: res.body.user.id };
}

beforeAll(async () => {
  config.staffApiKey = STAFF;
  setMailDryRun(true);
  const app = await createApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;

  const a = await signUp('a');
  customerACookie = a.cookie;
  customerAId = a.id;
  const b = await signUp('b');
  customerBId = b.id;

  await call('PUT', '/api/customer/website', { cookie: a.cookie, body: { siteName: 'A Site', domain: 'a-site.example.com' } });
  const created = await call('POST', '/api/customer/requests', {
    cookie: a.cookie,
    body: { title: 'Change the hero', description: 'please', page: '/', priority: 'normal' },
  });
  expect(created.status).toBe(201);
  requestAId = created.body.request.id;
});

afterAll(async () => {
  resetMailSender();
  setMailDryRun(false);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.deleteWhere('change_messages', { request_id: requestAId });
  await db.deleteWhere('change_requests', { id: requestAId });
  for (const id of createdUserIds) {
    await db.deleteWhere('change_messages', { user_id: id });
    await db.deleteWhere('change_requests', { user_id: id });
    await db.deleteWhere('customer_websites', { user_id: id });
    await db.deleteWhere('email_deliveries', { customer_id: id });
    await db.deleteWhere('email_events', { customer_id: id });
    await db.deleteWhere('password_resets', { user_id: id });
    await db.deleteWhere('sessions', { user_id: id });
    await db.deleteWhere('email_verifications', { user_id: id });
    await db.deleteWhere('users', { id });
  }
});

describe('K-59 health information disclosure', () => {
  it('exposes only safe operational fields', async () => {
    const res = await call('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'runtime', 'service']);
  });

  it('discloses no AI keys, latency, Shopify config, operator or autonomy', async () => {
    const raw = JSON.stringify((await call('GET', '/api/health')).body);
    for (const leak of ['ollama', 'keyId', 'avgLatencyMs', 'shopify', 'appConfigured', 'operator', 'autonomy', 'apiVersion', 'driver']) {
      expect(raw, leak).not.toContain(leak);
    }
  });

  it('keeps the detailed view behind a session', async () => {
    expect((await call('GET', '/api/health/detail')).status).toBe(401);
    const authed = await call('GET', '/api/health/detail', { cookie: customerACookie });
    expect(authed.status).toBe(200);
    expect(JSON.stringify(authed.body)).toContain('shopify');
  });
});

describe('K-20 completion authorisation', () => {
  it('refuses to let a customer mark their own request completed', async () => {
    const res = await call('POST', `/api/customer/requests/${requestAId}/status`, {
      cookie: customerACookie, body: { status: 'completed' },
    });
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/only seai/i);
  });

  it('leaves the request untouched after the refusal', async () => {
    const row = (await db.list('change_requests', { id: requestAId }, 1))[0];
    expect(row.status).not.toBe('completed');
  });

  it('still permits the collaborative customer transitions', async () => {
    for (const status of ['reviewing', 'in_progress', 'waiting_for_client', 'submitted']) {
      const res = await call('POST', `/api/customer/requests/${requestAId}/status`, {
        cookie: customerACookie, body: { status },
      });
      expect(res.status, `status ${status}`).toBe(200);
      expect(res.body.request.status).toBe(status);
    }
  });

  it('keeps tenant isolation: another customer gets 404, not 403', async () => {
    const other = await signUp('iso');
    const res = await call('POST', `/api/customer/requests/${requestAId}/status`, {
      cookie: other.cookie, body: { status: 'completed' },
    });
    // Ownership is checked before the status rule so existence is not leaked.
    expect(res.status).toBe(404);
  });

  it('completes the request when the staff key is presented', async () => {
    const res = await call('POST', `/api/customer/requests/${requestAId}/complete`, {
      bearer: STAFF, body: { summary: 'Deployed', note: 'All done.' },
    });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('completed');
    expect((await db.list('change_requests', { id: requestAId }, 1))[0].status).toBe('completed');
  });

  it('is idempotent and does not re-notify completion', async () => {
    await drainPendingMail(3000);
    const before = (await db.list('email_deliveries', { customer_id: customerAId }, 200))
      .filter((d) => d.event_name === 'change.completed').length;
    const res = await call('POST', `/api/customer/requests/${requestAId}/complete`, { bearer: STAFF, body: { summary: 'again' } });
    expect(res.status).toBe(200);
    expect(res.body.alreadyCompleted).toBe(true);
    await drainPendingMail(3000);
    const after = (await db.list('email_deliveries', { customer_id: customerAId }, 200))
      .filter((d) => d.event_name === 'change.completed').length;
    expect(after).toBe(before);
  });

  it('rejects the completion route without a valid staff key', async () => {
    for (const opts of [{}, { cookie: customerACookie }, { bearer: 'wrong-key' }]) {
      const res = await call('POST', `/api/customer/requests/${requestAId}/complete`, { ...opts, body: {} });
      expect(res.status).toBe(403);
    }
  });
});

describe('K-60 website lifecycle emitters', () => {
  const lifecycle = (body: unknown) => call('POST', '/api/customer/website/lifecycle', { bearer: STAFF, body });

  it('refuses the lifecycle route without the staff key', async () => {
    const res = await call('POST', '/api/customer/website/lifecycle', {
      cookie: customerACookie, body: { userId: customerAId, domain: 'x.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('emits purchase_confirmed and domain_connected on the first real transition', async () => {
    const res = await lifecycle({
      userId: customerAId,
      domain: 'a-site-new.example.com',
      purchase: { orderId: `ord-${Date.now()}`, planName: 'STARTER', amountPaise: 299900, currency: 'INR' },
    });
    expect(res.status).toBe(200);
    expect(res.body.emitted).toContain('website.purchase_confirmed');
    expect(res.body.emitted).toContain('website.domain_connected');
    expect(res.body.emitted).not.toContain('website.deployed');
    expect(res.body.emitted).not.toContain('website.ready');
  });

  it('emits website.deployed and website.ready when deployment and TLS land', async () => {
    const res = await lifecycle({ userId: customerAId, deploymentStatus: 'deployed', sslStatus: 'active', deploymentId: 'dep-1' });
    expect(res.status).toBe(200);
    expect(res.body.emitted).toContain('website.deployed');
    expect(res.body.emitted).toContain('website.ready');
  });

  it('emits nothing when nothing changed', async () => {
    const res = await lifecycle({ userId: customerAId, deploymentStatus: 'deployed', sslStatus: 'active', deploymentId: 'dep-1' });
    expect(res.status).toBe(200);
    expect(res.body.emitted).toEqual([]);
  });

  it('does not emit website.ready without active TLS', async () => {
    const res = await lifecycle({ userId: customerAId, deploymentStatus: 'deployed', sslStatus: 'pending', deploymentId: 'dep-2' });
    expect(res.body.emitted).toEqual([]);
    // restore TLS so the exactly-once check below still sees a single ready
    await lifecycle({ userId: customerAId, sslStatus: 'active' });
  });

  it('emits each lifecycle event exactly once across the whole sequence', async () => {
    await drainPendingMail(5000);
    const rows = await db.list('email_deliveries', { customer_id: customerAId }, 300);
    for (const ev of ['website.purchase_confirmed', 'website.domain_connected', 'website.deployed', 'website.ready']) {
      expect(rows.filter((d) => d.event_name === ev && d.status === 'sent'), ev).toHaveLength(1);
    }
  });

  it('404s for an unknown customer and for one with no website', async () => {
    expect((await lifecycle({ userId: 'no-such-user', domain: 'z.example.com' })).status).toBe(404);
    const bare = await signUp('bare');
    expect((await lifecycle({ userId: bare.id, domain: 'z.example.com' })).status).toBe(404);
  });

  it('never lets a customer assert deployment state through the customer route', async () => {
    const bare = await signUp('assert');
    const res = await call('PUT', '/api/customer/website', {
      cookie: bare.cookie,
      body: { siteName: 'X', domain: 'x.example.com', deploymentStatus: 'live', sslStatus: 'active' },
    });
    expect([200, 201]).toContain(res.status);
    const row = (await db.list('customer_websites', { user_id: bare.id }, 1))[0];
    expect(row.deployment_status).toBe('unknown');
    expect(row.ssl_status).toBe('unknown');
    await drainPendingMail(2000);
    const rows = await db.list('email_deliveries', { customer_id: bare.id }, 200);
    expect(rows.filter((d) => d.event_name === 'website.deployed')).toHaveLength(0);
    expect(rows.filter((d) => d.event_name === 'website.ready')).toHaveLength(0);
  });
});

describe('scheduled maintenance route', () => {
  it('is closed without the staff key', async () => {
    expect((await call('GET', '/api/internal/maintenance')).status).toBe(403);
  });

  it('runs the reaper and token purge for the staff key', async () => {
    const res = await call('GET', '/api/internal/maintenance', { bearer: STAFF });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(String(res.body.reaped)).toContain('scanned=');
    expect(typeof res.body.resetTokensPurged).toBe('number');
  });

  it('tolerates an absurd limit', async () => {
    const res = await call('GET', '/api/internal/maintenance?limit=99999', { bearer: STAFF });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

void customerBId;
