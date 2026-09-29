/**
 * Handler-level tests for the Vercel functions in api/storage/**.
 *
 * The property that matters most here is tenant isolation: intake is anonymous
 * and pre-payment, so a file must only ever be completed or written to by the
 * session that created it. A client-supplied customerId is never honoured.
 *
 * Run with: node --import tsx --test api/storage/handlers.test.ts
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.SEAI_STORAGE_API_BASE = 'https://storage.test';
process.env.SEAI_STORAGE_SERVICE_NAME = 'seai-public';
process.env.SEAI_STORAGE_SERVICE_KEY = 'test-storage-key';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

const state: { owner: string; uploadStatus: number; initStatus: number } = {
  owner: `intake:${SESSION_A}`,
  uploadStatus: 200,
  initStatus: 201,
};
const seen: any[] = [];

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  if (!u.startsWith('https://storage.test')) return realFetch(url, init);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[String(k).toLowerCase()] = String(v);
  let body: any = null;
  if (Buffer.isBuffer(init.body)) {
    // Byte relay: record the raw payload so we can assert it is forwarded
    // verbatim, not re-encoded.
    body = { __raw: true, length: init.body.length, bytes: init.body };
  } else if (init.body && typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = { __raw: true, length: init.body.length };
    }
  }
  seen.push({ url: u, method: init.method || 'GET', headers, body });

  if (headers['x-seai-service-key'] !== 'test-storage-key') {
    return jsonResponse(401, { ok: false, error: 'bad service key' });
  }

  if (u === 'https://storage.test/api/v1/uploads' && init.method === 'POST') {
    if (state.initStatus !== 201) return jsonResponse(state.initStatus, { ok: false, error: 'rejected' });
    return jsonResponse(201, {
      object: { id: 'file_abc123', status: 'pending' },
      uploadUrl: 'https://s3.test/signed-put',
      expiresAt: '2026-01-01T00:00:00Z',
    });
  }
  if (u.startsWith('https://storage.test/api/v1/files/')) {
    const id = u.split('/').pop();
    if (id !== 'file_abc123') return jsonResponse(404, { ok: false, error: 'Not found' });
    return jsonResponse(200, { file: { id, customerId: state.owner, mimeType: 'image/png' } });
  }
  if (u.endsWith('/complete')) return jsonResponse(state.uploadStatus, { object: { id: 'file_abc123', status: 'available' } });
  if (u.endsWith('/bytes')) return jsonResponse(200, { ok: true });

  return jsonResponse(404, { ok: false, error: 'Not found' });
}) as typeof globalThis.fetch;

const { default: initUpload } = await import('./intake/uploads/index.ts');
const { default: completeUpload } = await import('./intake/uploads/[id]/complete.ts');
const { default: putBytes } = await import('./intake/uploads/[id]/bytes.ts');

function request(method: string, opts: { query?: any; cookie?: string; body?: unknown; raw?: Buffer } = {}) {
  const req: any = Readable.from(opts.raw ? [opts.raw] : []);
  Object.defineProperty(req, 'readableEnded', { value: !opts.raw, configurable: true });
  req.method = method;
  req.headers = {
    cookie: opts.cookie,
    'content-type': 'application/json',
    'x-forwarded-for': '203.0.113.9',
  };
  req.query = opts.query ?? {};
  req.body = opts.raw ? undefined : opts.body;
  req.socket = { remoteAddress: '203.0.113.9' };
  return req;
}

function mockRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as any };
  res.setHeader = (k: string, v: string) => {
    res.headers[String(k).toLowerCase()] = v;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (p: unknown) => {
    res.body = p;
    return res;
  };
  return res;
}

const validUpload = {
  originalFilename: 'logo.png',
  mimeType: 'image/png',
  sizeBytes: 12_345,
  category: 'logo',
};

beforeEach(() => {
  state.owner = `intake:${SESSION_A}`;
  state.uploadStatus = 200;
  state.initStatus = 201;
  seen.length = 0;
});

describe('POST /api/storage/intake/uploads', () => {
  it('mints a session, scopes the tenant server-side, and returns a signed URL', async () => {
    const res = mockRes();
    await initUpload(request('POST', { body: validUpload }), res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.fileId, 'file_abc123');
    assert.match(res.body.uploadUrl, /^https:\/\//);
    assert.match(res.body.intakeSessionId, /^[0-9a-f-]{36}$/);
    assert.equal(res.body.bytesEndpoint, '/api/storage/intake/uploads/file_abc123/bytes');

    // The tenant is `intake:<minted session>`, matching the cookie we set.
    const cookie = res.headers['set-cookie'];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const minted = /seai_intake=([^;]+)/.exec(cookie)![1];
    assert.equal(seen[0].body.customerId, `intake:${minted}`);
    assert.equal(seen[0].headers['x-on-behalf-of-customer'], `intake:${minted}`);
  });

  it('reuses an existing valid session instead of minting a new one', async () => {
    const res = mockRes();
    await initUpload(request('POST', { body: validUpload, cookie: `seai_intake=${SESSION_A}` }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.intakeSessionId, SESSION_A);
    assert.equal(seen[0].body.customerId, `intake:${SESSION_A}`);
    assert.equal(res.headers['set-cookie'], undefined, 'no new cookie needed');
  });

  it('never forwards a browser-supplied customerId', async () => {
    const res = mockRes();
    await initUpload(
      request('POST', { body: { ...validUpload, customerId: 'intake:someone-else', websiteId: 'victim' } }),
      res,
    );
    assert.equal(res.statusCode, 201);
    assert.match(seen[0].body.customerId, /^intake:[0-9a-f-]{36}$/);
    assert.notEqual(seen[0].body.customerId, 'intake:someone-else');
    assert.equal(seen[0].body.websiteId, null);
  });

  it('replaces a malformed session cookie', async () => {
    const res = mockRes();
    await initUpload(request('POST', { body: validUpload, cookie: 'seai_intake=not-a-uuid' }), res);
    assert.equal(res.statusCode, 201);
    assert.notEqual(res.body.intakeSessionId, 'not-a-uuid');
  });

  it('rejects a bad category, size, mime, and filename', async () => {
    const cases: Array<[any, number]> = [
      [{ ...validUpload, category: 'exe' }, 400],
      [{ ...validUpload, sizeBytes: 0 }, 413],
      [{ ...validUpload, sizeBytes: 5 * 1024 * 1024 + 1 }, 413],
      [{ ...validUpload, sizeBytes: 1.5 }, 413],
      [{ ...validUpload, mimeType: '' }, 400],
      [{ ...validUpload, originalFilename: '' }, 400],
      [{ ...validUpload, originalFilename: 'x'.repeat(300) }, 400],
    ];
    for (const [body, expected] of cases) {
      const res = mockRes();
      await initUpload(request('POST', { body }), res);
      assert.equal(res.statusCode, expected, JSON.stringify(body));
    }
    assert.equal(seen.length, 0, 'no upstream calls for invalid requests');
  });

  it('maps an upstream 422 safety rejection', async () => {
    state.initStatus = 422;
    const res = mockRes();
    await initUpload(request('POST', { body: validUpload }), res);
    assert.equal(res.statusCode, 422);
  });

  it('maps an upstream 429 to a retryable error', async () => {
    state.initStatus = 429;
    const res = mockRes();
    await initUpload(request('POST', { body: validUpload }), res);
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /too many requests/i);
  });

  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await initUpload(request('GET'), res);
    assert.equal(res.statusCode, 405);
  });
});

describe('POST /api/storage/intake/uploads/:id/complete', () => {
  it('completes a file owned by the calling session', async () => {
    state.owner = `intake:${SESSION_A}`;
    const res = mockRes();
    await completeUpload(
      request('POST', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_A}` }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, 'available');
  });

  it('refuses to complete another session\'s file', async () => {
    // The file belongs to A; B must not be able to complete it.
    state.owner = `intake:${SESSION_A}`;
    const res = mockRes();
    await completeUpload(
      request('POST', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_B}` }),
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Not found');
    // It must not have reached the complete call.
    assert.equal(seen.filter((s) => s.url.endsWith('/complete')).length, 0);
  });

  it('requires an intake session', async () => {
    const res = mockRes();
    await completeUpload(request('POST', { query: { id: 'file_abc123' } }), res);
    assert.equal(res.statusCode, 401);
  });

  it('rejects a traversal-shaped id', async () => {
    for (const id of ['../secrets', 'a/b', 'a b', 'x'.repeat(200), '']) {
      const res = mockRes();
      await completeUpload(request('POST', { query: { id }, cookie: `seai_intake=${SESSION_A}` }), res);
      assert.equal(res.statusCode, 400, id);
    }
    assert.equal(seen.length, 0);
  });

  it('propagates an expired upload as 410', async () => {
    state.uploadStatus = 410;
    const res = mockRes();
    await completeUpload(
      request('POST', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_A}` }),
      res,
    );
    assert.equal(res.statusCode, 410);
    assert.match(res.body.error, /expired/i);
  });

  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await completeUpload(request('GET', { query: { id: 'file_abc123' } }), res);
    assert.equal(res.statusCode, 405);
  });
});

describe('PUT /api/storage/intake/uploads/:id/bytes', () => {
  it('relays bytes verbatim for the owning session', async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const res = mockRes();
    await putBytes(
      request('PUT', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_A}`, raw: payload }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.receivedBytes, payload.length);
    // The forwarded content type is the stored mime, not the client's claim.
    assert.equal(seen.at(-1).headers['content-type'], 'image/png');
    assert.equal(seen.at(-1).body.__raw, true);
    assert.equal(seen.at(-1).body.length, payload.length);
    // Byte-for-byte identical, including the 0xff that a lossy re-encode of a
    // PNG would corrupt.
    assert.deepEqual(seen.at(-1).body.bytes, payload);
  });

  it('refuses to write bytes for another session\'s file', async () => {
    state.owner = `intake:${SESSION_A}`;
    const res = mockRes();
    await putBytes(
      request('PUT', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_B}`, raw: Buffer.from('x') }),
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.equal(seen.filter((s) => s.url.endsWith('/bytes')).length, 0);
  });

  it('rejects an empty or oversized body', async () => {
    const empty = mockRes();
    await putBytes(request('PUT', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_A}`, raw: Buffer.alloc(0) }), empty);
    assert.equal(empty.statusCode, 400);

    const huge = mockRes();
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 1);
    await putBytes(request('PUT', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_A}`, raw: big }), huge);
    assert.equal(huge.statusCode, 400);
  });

  it('requires an intake session', async () => {
    const res = mockRes();
    await putBytes(request('PUT', { query: { id: 'file_abc123' }, raw: Buffer.from('x') }), res);
    assert.equal(res.statusCode, 401);
  });

  it('rejects non-PUT with 405', async () => {
    const res = mockRes();
    await putBytes(request('POST', { query: { id: 'file_abc123' }, cookie: `seai_intake=${SESSION_A}` }), res);
    assert.equal(res.statusCode, 405);
  });
});
