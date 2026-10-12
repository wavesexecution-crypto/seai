import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { createSession } from '../src/auth/service.js';
import { storageRouter, __resetStorageRateLimits } from '../src/storage/router.js';
import { customerRouter } from '../src/customer/routes.js';
import { setMailSender, resetMailSender } from '../src/mail/dispatch.js';

// ---- Stub seai.storage ----------------------------------------------------
// Mimics the integration contract: service headers required, tenant scope
// from delegation headers (or body customerId for services), 404 for foreign
// tenants, privileged reads when no delegation is sent.
interface StubObject {
  id: string;
  customerId: string;
  websiteId: string | null;
  status: string;
  visibility: string;
  category: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}
const objects = new Map<string, StubObject>();
const seen: { method: string; path: string; headers: Record<string, string>; body: any }[] = [];

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c: any) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function scoped(obj: StubObject, headers: Record<string, string>): boolean {
  const obo = headers['x-on-behalf-of-customer'];
  if (!obo) return true; // privileged service read
  return obo === obj.customerId;
}

const stub = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const body = await readBody(req);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
  seen.push({ method: req.method ?? '', path: url.pathname, headers, body });
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (headers['x-seai-service'] !== 'cdf' || headers['x-seai-service-key'] !== 'test-cdf-key') {
    send(401, { ok: false, error: 'Unauthorized' });
    return;
  }
  const id = url.pathname.split('/')[4];
  if (req.method === 'POST' && url.pathname === '/api/v1/uploads') {
    const customerId = body.customerId ?? headers['x-on-behalf-of-customer'];
    if (!customerId) {
      send(400, { ok: false, error: 'customerId required' });
      return;
    }
    if (headers['x-on-behalf-of-customer'] && body.customerId && headers['x-on-behalf-of-customer'] !== body.customerId) {
      send(400, { ok: false, error: 'mismatch' });
      return;
    }
    const obj: StubObject = {
      id: randomUUID(),
      customerId,
      websiteId: body.websiteId ?? headers['x-on-behalf-of-website'] ?? null,
      status: 'UPLOADING',
      visibility: 'PRIVATE',
      category: body.category ?? 'other',
      originalFilename: body.originalFilename ?? 'file',
      mimeType: body.mimeType ?? 'application/octet-stream',
      sizeBytes: body.sizeBytes ?? 0,
    };
    objects.set(obj.id, obj);
    send(201, { ok: true, object: obj, uploadSessionId: randomUUID(), uploadUrl: 'https://storage.test/upload', expiresAt: new Date().toISOString() });
    return;
  }
  const obj = objects.get(id ?? '');
  if (!obj || obj.status === 'DELETED') {
    send(404, { ok: false, error: 'Not found' });
    return;
  }
  if (req.method === 'PUT' && url.pathname.endsWith('/bytes')) {
    if (!scoped(obj, headers)) {
      send(404, { ok: false, error: 'Not found' });
      return;
    }
    send(200, { ok: true, receivedBytes: 3 });
    return;
  }
  if (req.method === 'POST' && url.pathname.endsWith('/complete')) {
    if (!scoped(obj, headers)) {
      send(404, { ok: false, error: 'Not found' });
      return;
    }
    obj.status = 'READY';
    send(200, { ok: true, object: obj });
    return;
  }
  if (req.method === 'GET' && url.pathname.endsWith('/download')) {
    if (!scoped(obj, headers)) {
      send(404, { ok: false, error: 'Not found' });
      return;
    }
    if (obj.status !== 'READY') {
      send(409, { ok: false, error: 'not ready' });
      return;
    }
    send(200, { ok: true, downloadUrl: `https://storage.test/dl/${obj.id}`, expiresAt: new Date().toISOString(), mimeType: obj.mimeType });
    return;
  }
  if (req.method === 'DELETE') {
    if (!scoped(obj, headers)) {
      send(404, { ok: false, error: 'Not found' });
      return;
    }
    obj.status = 'DELETED';
    send(200, { ok: true, file: obj });
    return;
  }
  if (req.method === 'POST' && (url.pathname.endsWith('/publish') || url.pathname.endsWith('/unpublish'))) {
    if (!scoped(obj, headers)) {
      send(404, { ok: false, error: 'Not found' });
      return;
    }
    obj.visibility = url.pathname.endsWith('/publish') ? 'PUBLIC' : 'PRIVATE';
    send(200, { ok: true, file: { ...obj, publicUrl: obj.visibility === 'PUBLIC' ? `https://cdn.test/${obj.id}` : null } });
    return;
  }
  if (req.method === 'GET') {
    if (!scoped(obj, headers)) {
      send(404, { ok: false, error: 'Not found' });
      return;
    }
    send(200, { ok: true, file: obj });
    return;
  }
  send(404, { ok: false, error: 'Not found' });
});

// ---- CDF app under test ----------------------------------------------------
function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/storage', storageRouter);
  app.use('/api/customer', customerRouter);
  return app;
}

const SECRET = 'test-storage-jwt-secret-that-is-long-enough!!';
let app: ReturnType<typeof makeApp>;
let baseUrl = '';
let stubUrl = '';

async function makeUser(email: string): Promise<{ id: string; cookie: string }> {
  const id = randomUUID();
  await db.insert('users', { id, full_name: 'Test User', email, password_hash: 'x', email_verified: true });
  const token = await createSession(id);
  return { id, cookie: `seai_session=${token}` };
}

async function makeWebsite(userId: string): Promise<string> {
  const row = await db.insert('customer_websites', {
    id: randomUUID(),
    user_id: userId,
    site_name: 'Site',
    domain: 'example.com',
    deployment_status: 'unknown',
    ssl_status: 'unknown',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return row.id;
}

async function api(method: string, path: string, cookie: string | null, body?: unknown, query = '') {
  const res = await fetch(`${baseUrl}${path}${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

function lastSeen(path: string) {
  return [...seen].reverse().find((s) => s.path === path);
}

beforeAll(async () => {
  await new Promise<void>((resolve) => stub.listen(0, resolve));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  config.storageServiceUrl = stubUrl;
  config.storageServiceName = 'cdf';
  config.storageServiceKey = 'test-cdf-key';
  config.storageJwtSecret = SECRET;
  config.storageTokenTtlSec = 300;
  setMailSender(async (mail) => ({ messageId: '<t@t>', response: '250 OK', mail }));
  await db.init();
  const srv = createServer(makeApp());
  app = makeApp();
  void app;
  await new Promise<void>((resolve) => srv.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  (globalThis as any).__cdfSrv = srv;
});

afterAll(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
  await new Promise<void>((resolve) => ((globalThis as any).__cdfSrv as ReturnType<typeof createServer>).close(() => resolve()));
  resetMailSender();
  await db.close();
});

beforeEach(() => {
  seen.length = 0;
  objects.clear();
  __resetStorageRateLimits();
});

describe('storage proxy tenant isolation', () => {
  it('rejects unauthenticated access', async () => {
    const res = await api('POST', '/api/storage/uploads', null, {
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      category: 'logo',
    });
    expect(res.status).toBe(401);
  });

  it('derives scope from session and ignores forged browser IDs', async () => {
    const user = await makeUser(`a-${Date.now()}@t.co`);
    const site = await makeWebsite(user.id);
    const res = await api('POST', '/api/storage/uploads', user.cookie, {
      customerId: 'victim',
      websiteId: site,
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      category: 'logo',
    });
    expect(res.status).toBe(201);
    const fwd = lastSeen('/api/v1/uploads');
    expect(fwd?.headers['x-seai-service']).toBe('cdf');
    expect(fwd?.headers['x-seai-service-key']).toBe('test-cdf-key');
    expect(fwd?.headers['x-on-behalf-of-customer']).toBe(user.id);
    expect(fwd?.body.customerId).toBe(user.id);
    expect(fwd?.body.customerId).not.toBe('victim');
  });

  it('rejects forged websiteId with 404', async () => {
    const a = await makeUser(`a2-${Date.now()}@t.co`);
    const b = await makeUser(`b2-${Date.now()}@t.co`);
    const siteB = await makeWebsite(b.id);
    const res = await api('POST', '/api/storage/uploads', a.cookie, {
      websiteId: siteB,
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      category: 'logo',
    });
    expect(res.status).toBe(404);
  });

  it('cross-tenant file access fails safely across all operations', async () => {
    const a = await makeUser(`a3-${Date.now()}@t.co`);
    const b = await makeUser(`b3-${Date.now()}@t.co`);
    const up = await api('POST', '/api/storage/uploads', a.cookie, {
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      category: 'logo',
    });
    const fileId = up.body.file.storage_file_id as string;
    await api('POST', `/api/storage/uploads/${fileId}/complete`, a.cookie);
    for (const [method, path] of [
      ['GET', `/api/storage/files/${fileId}`],
      ['GET', `/api/storage/files/${fileId}/download`],
      ['DELETE', `/api/storage/files/${fileId}`],
      ['POST', `/api/storage/files/${fileId}/publish`],
    ] as const) {
      const res = await api(method, path, b.cookie);
      expect(res.status).toBe(404);
    }
    const list = await api('GET', '/api/storage/files', b.cookie);
    expect(list.status).toBe(200);
    expect(list.body.files).toEqual([]);
    // Owner still works.
    const own = await api('GET', `/api/storage/files/${fileId}/download`, a.cookie);
    expect(own.status).toBe(200);
    expect(own.body.downloadUrl).toContain('https://storage.test/dl/');
  });

  it('issues HS256 tokens bound to session user with website allowlist', async () => {
    const user = await makeUser(`tok-${Date.now()}@t.co`);
    const site = await makeWebsite(user.id);
    const res = await api('POST', '/api/storage/token', user.cookie);
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, SECRET, { algorithms: ['HS256'] }) as Record<string, any>;
    expect(payload.sub).toBe(user.id);
    expect(payload.websiteIds).toEqual([site]);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(900);
  });

  it('rejects expired sessions', async () => {
    const user = await makeUser(`exp-${Date.now()}@t.co`);
    const rows = await db.list('sessions', {}, 100);
    const mine = rows.find((r) => r.user_id === user.id);
    await db.update('sessions', mine.id, { expires_at: new Date(0).toISOString() });
    const res = await api('GET', '/api/storage/files', user.cookie);
    expect(res.status).toBe(401);
  });

  it('links modify attachments by file ID without storing bytes', async () => {
    const user = await makeUser(`att-${Date.now()}@t.co`);
    const up = await api('POST', '/api/storage/uploads', user.cookie, {
      originalFilename: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      category: 'image',
    });
    const fileId = up.body.file.storage_file_id as string;
    await api('POST', `/api/storage/uploads/${fileId}/complete`, user.cookie);
    const cr = await api('POST', '/api/customer/requests', user.cookie, {
      title: 'Change hero',
      description: 'Please update',
    });
    const link = await api('POST', `/api/customer/requests/${cr.body.request.id}/attachments/storage`, user.cookie, { fileId });
    expect(link.status).toBe(201);
    expect(link.body.attachment.file_id).toBe(fileId);
    expect(link.body.attachment.data_url).toBeNull();
    // Another customer cannot link the same file.
    const b = await makeUser(`attb-${Date.now()}@t.co`);
    const crB = await api('POST', '/api/customer/requests', b.cookie, { title: 'x', description: 'y' });
    const linkB = await api('POST', `/api/customer/requests/${crB.body.request.id}/attachments/storage`, b.cookie, { fileId });
    expect(linkB.status).toBe(404);
  });

  it('adopts verified intake files onto the website, rejects foreign ones', async () => {
    const user = await makeUser(`ad-${Date.now()}@t.co`);
    // Intake-scoped READY file (as the public proxy would create).
    const intakeObj: StubObject = {
      id: randomUUID(),
      customerId: 'intake:9f8a7b6c-5d4e-3f2a-1b0c-9d8e7f6a5b4c',
      websiteId: null,
      status: 'READY',
      visibility: 'PRIVATE',
      category: 'logo',
      originalFilename: 'logo.png',
      mimeType: 'image/png',
      sizeBytes: 12,
    };
    objects.set(intakeObj.id, intakeObj);
    const put = await api('PUT', '/api/customer/website', user.cookie, {
      siteName: 'Biz',
      domain: 'biz.example',
      intakeFileIds: [intakeObj.id],
      orderRef: 'order_123',
    });
    expect(put.status).toBe(201);
    const files = await api('GET', '/api/storage/files', user.cookie);
    expect(files.body.files.map((f: any) => f.storage_file_id)).toContain(intakeObj.id);

    const other = await makeUser(`ad2-${Date.now()}@t.co`);
    const bad = await api('PUT', '/api/customer/website', other.cookie, {
      siteName: 'Evil',
      domain: 'evil.example',
      intakeFileIds: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(bad.status).toBe(422);
  });

  it('relays attachment bytes under session scope without storing them in CDF', async () => {
    const user = await makeUser(`bytes-${Date.now()}@t.co`);
    const up = await api('POST', '/api/storage/uploads', user.cookie, {
      originalFilename: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 3,
      category: 'image',
    });
    const fileId = up.body.file.storage_file_id as string;
    const putRes = await fetch(`${baseUrl}/api/storage/uploads/${fileId}/bytes`, {
      method: 'PUT',
      headers: { Cookie: user.cookie, 'Content-Type': 'application/octet-stream' },
      body: Buffer.from([1, 2, 3]),
    });
    expect(putRes.status).toBe(200);
    expect(((await putRes.json()) as any).receivedBytes).toBe(3);
    const fwd = [...seen].reverse().find((s) => s.path.endsWith('/bytes'));
    expect(fwd?.headers['x-seai-service']).toBe('cdf');
    expect(fwd?.headers['x-on-behalf-of-customer']).toBe(user.id);
    // No inline bytes landed in the CDF database (file IDs only).
    const atts = await db.list('attachments', {}, 100);
    expect(atts.every((a) => a.data_url == null)).toBe(true);
    // Another customer cannot relay bytes to this upload.
    const b = await makeUser(`bytesb-${Date.now()}@t.co`);
    const putB = await fetch(`${baseUrl}/api/storage/uploads/${fileId}/bytes`, {
      method: 'PUT',
      headers: { Cookie: b.cookie, 'Content-Type': 'application/octet-stream' },
      body: Buffer.from([9]),
    });
    expect(putB.status).toBe(404);
  });

  it('legacy inline attachments keep working when storage is unconfigured', async () => {
    const user = await makeUser(`leg-${Date.now()}@t.co`);
    const cr = await api('POST', '/api/customer/requests', user.cookie, { title: 'Legacy', description: 'no storage' });
    const prev = config.storageServiceKey;
    config.storageServiceKey = '';
    try {
      const up = await api('POST', '/api/storage/uploads', user.cookie, {
        originalFilename: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        category: 'logo',
      });
      expect(up.status).toBe(503);
      const legacy = await api('POST', `/api/customer/requests/${cr.body.request.id}/attachments`, user.cookie, {
        filename: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        dataUrl: 'data:image/png;base64,AAA',
      });
      expect(legacy.status).toBe(201);
      expect(legacy.body.attachment.data_url).toBeUndefined();
    } finally {
      config.storageServiceKey = prev;
    }
  });

  it('never exposes the service key and maps storage outages safely', async () => {
    const user = await makeUser(`sec-${Date.now()}@t.co`);
    const up = await api('POST', '/api/storage/uploads', user.cookie, {
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      category: 'logo',
    });
    expect(JSON.stringify(up.body)).not.toContain('test-cdf-key');
    const prev = config.storageServiceUrl;
    config.storageServiceUrl = 'http://127.0.0.1:9';
    try {
      const res = await api('GET', '/api/storage/files', user.cookie);
      // List is mapping-local so it still works; force a live call instead.
      const live = await api('GET', `/api/storage/files/${up.body.file.storage_file_id}`, user.cookie);
      expect(live.status).toBe(503);
      expect(live.body.error).toBe('Storage unavailable');
      expect(JSON.stringify(live.body)).not.toContain('test-cdf-key');
    } finally {
      config.storageServiceUrl = prev;
    }
  });
});
