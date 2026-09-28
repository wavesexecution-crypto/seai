/**
 * Intake storage proxy tests (no dependencies — node:test + global fetch).
 * Storage is stubbed at the fetch layer; assertions prove the integration
 * contract: server-minted scope, exact service headers, no secret leakage.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SEAI_STORAGE_API_BASE = 'http://storage.test';
process.env.SEAI_STORAGE_SERVICE_NAME = 'seai-public';
process.env.SEAI_STORAGE_SERVICE_KEY = 'test-public-key';
process.env.ALLOWED_ORIGIN = 'https://seai.store';

const seen = [];
const files = new Map();

function jsonResponse(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const realFetch = globalThis.fetch.bind(globalThis);

async function stubFetch(url, init = {}) {
  const u = String(url);
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[String(k).toLowerCase()] = v;
  let body = null;
  try {
    body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }
  seen.push({ url: u, method: init.method || 'GET', headers, body });
  if (headers['x-seai-service'] !== 'seai-public' || headers['x-seai-service-key'] !== 'test-public-key') {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }
  if (u === 'http://storage.test/api/v1/uploads' && (init.method || 'GET') === 'POST') {
    if (!body?.customerId || !String(body.customerId).startsWith('intake:')) {
      return jsonResponse(400, { ok: false, error: 'customerId required' });
    }
    if (headers['x-on-behalf-of-customer'] && headers['x-on-behalf-of-customer'] !== body.customerId) {
      return jsonResponse(400, { ok: false, error: 'mismatch' });
    }
    const id = `obj-${files.size + 1}`;
    files.set(id, { id, customerId: body.customerId, status: 'UPLOADING', category: body.category });
    return jsonResponse(201, {
      ok: true,
      object: files.get(id),
      uploadSessionId: 'sess-1',
      uploadUrl: 'https://storage.test/upload',
      expiresAt: new Date().toISOString(),
    });
  }
  const m = u.match(/\/api\/v1\/(files|uploads)\/([^/]+)(\/complete|\/bytes)?$/);
  if (m) {
    const [, kind, id, suffix] = m;
    const obj = files.get(id);
    if (!obj || obj.status === 'DELETED') return jsonResponse(404, { ok: false, error: 'Not found' });
    if (kind === 'files' && !suffix) {
      return jsonResponse(200, { ok: true, file: obj });
    }
    if (headers['x-on-behalf-of-customer'] && headers['x-on-behalf-of-customer'] !== obj.customerId) {
      return jsonResponse(403, { ok: false, error: 'Forbidden' });
    }
    if (suffix === '/complete') {
      obj.status = 'READY';
      return jsonResponse(200, { ok: true, object: obj });
    }
    if (suffix === '/bytes') {
      obj.status = 'RECEIVED';
      return jsonResponse(200, { ok: true, receivedBytes: 3 });
    }
  }
  return jsonResponse(404, { ok: false, error: 'Not found' });
}

// Intercept storage calls only; everything else (the proxy under test)
// goes through the real network stack.
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://storage.test')) return stubFetch(url, init);
  return realFetch(url, init);
};

const { app } = await import('./storage-proxy.js');

let server;
let base;
let cookie = '';

async function call(method, path, { body, raw, cookieHeader } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...(cookieHeader !== undefined ? { Cookie: cookieHeader } : cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : raw,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.includes('seai_intake=')) {
    cookie = setCookie.split(';')[0];
  }
  return { status: res.status, body: await res.json() };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('intake storage proxy', () => {
  it('mints a server-side intake session and scopes uploads to it', async () => {
    const res = await call('POST', '/api/storage/intake/uploads', {
      body: { originalFilename: 'logo.png', mimeType: 'image/png', sizeBytes: 100, category: 'logo' },
    });
    assert.equal(res.status, 201);
    assert.match(res.body.fileId, /^obj-/);
    assert.ok(res.body.uploadUrl);
    assert.ok(res.body.intakeSessionId);
    assert.ok(cookie.includes('seai_intake='));
    assert.ok(res.body.bytesEndpoint.includes(res.body.fileId));
    const fwd = seen.find((s) => s.url.endsWith('/api/v1/uploads'));
    assert.ok(String(fwd.body.customerId).startsWith('intake:'));
    assert.equal(fwd.headers['x-on-behalf-of-customer'], fwd.body.customerId);
  });

  it('ignores browser-supplied customer identity', async () => {
    const res = await call('POST', '/api/storage/intake/uploads', {
      body: { customerId: 'victim', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: 50, category: 'image' },
    });
    assert.equal(res.status, 201);
    const fwd = seen.filter((s) => s.url.endsWith('/api/v1/uploads')).pop();
    assert.notEqual(fwd.body.customerId, 'victim');
    assert.ok(String(fwd.body.customerId).startsWith('intake:'));
  });

  it('sends exact service headers and never leaks the key', async () => {
    const res = await call('POST', '/api/storage/intake/uploads', {
      body: { originalFilename: 'b.png', mimeType: 'image/png', sizeBytes: 50, category: 'image' },
    });
    assert.equal(res.status, 201);
    assert.ok(!JSON.stringify(res.body).includes('test-public-key'));
    const fwd = seen.filter((s) => s.url.endsWith('/api/v1/uploads')).pop();
    assert.equal(fwd.headers['x-seai-service'], 'seai-public');
    assert.equal(fwd.headers['x-seai-service-key'], 'test-public-key');
  });

  it('rejects oversize files and unsupported categories', async () => {
    const big = await call('POST', '/api/storage/intake/uploads', {
      body: { originalFilename: 'big.png', mimeType: 'image/png', sizeBytes: 6 * 1024 * 1024, category: 'image' },
    });
    assert.equal(big.status, 413);
    const bad = await call('POST', '/api/storage/intake/uploads', {
      body: { originalFilename: 'x.bin', mimeType: 'application/octet-stream', sizeBytes: 10, category: 'other' },
    });
    assert.equal(bad.status, 400);
  });

  it('completes only within the same intake scope', async () => {
    const up = await call('POST', '/api/storage/intake/uploads', {
      body: { originalFilename: 'c.png', mimeType: 'image/png', sizeBytes: 60, category: 'logo' },
    });
    const done = await call('POST', `/api/storage/intake/uploads/${up.body.fileId}/complete`);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'READY');
    // A different intake session cannot complete it.
    const foreign = await call(
      'POST',
      `/api/storage/intake/uploads/${up.body.fileId}/complete`,
      { cookieHeader: 'seai_intake=11111111-2222-3333-4444-555555555555' },
    );
    assert.equal(foreign.status, 404);
  });

  it('relays bytes only after scope verification', async () => {
    const up = await call('POST', '/api/storage/intake/uploads', {
      body: { originalFilename: 'd.png', mimeType: 'image/png', sizeBytes: 3, category: 'logo' },
    });
    const put = await call('PUT', `/api/storage/intake/uploads/${up.body.fileId}/bytes`, { raw: Buffer.from([1, 2, 3]) });
    assert.equal(put.status, 200);
    assert.equal(put.body.receivedBytes, 3);
    const foreign = await call('PUT', `/api/storage/intake/uploads/${up.body.fileId}/bytes`, {
      raw: Buffer.from([9]),
      cookieHeader: 'seai_intake=11111111-2222-3333-4444-555555555555',
    });
    assert.equal(foreign.status, 404);
  });
});
