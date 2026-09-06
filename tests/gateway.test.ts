import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => { vi.stubEnv('AI_PRIMARY_MODEL', ''); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('gateway pure logic', () => {
  it('classifies errors', async () => {
    const { classifyError } = await import('../src/ai/gateway.js');
    expect(classifyError(429, 'x')).toBe('rate_limited');
    expect(classifyError(401, 'unauthorized')).toBe('auth');
    expect(classifyError(null, 'timeout aborted')).toBe('timeout');
    expect(classifyError(500, 'boom')).toBe('server');
  });
  it('infers capabilities + scores strongest model first', async () => {
    const { inferCapabilities, scoreModel, aiGateway } = await import('../src/ai/gateway.js');
    const weak = inferCapabilities('llama2:7b');
    const strong = inferCapabilities('qwen3:32b');
    expect(scoreModel(strong)).toBeGreaterThan(scoreModel(weak));
    expect(strong.toolSupport).toBe(true);
    void aiGateway;
  });
  it('fails over across keys on rate limit (chat)', async () => {
    vi.resetModules();
    process.env.OLLAMA_API_KEY_1 = 'k1';
    process.env.OLLAMA_API_KEY_2 = 'k2';
    process.env.OLLAMA_API_KEY_3 = '';
    const g = await import('../src/ai/gateway.js');
    // discovery first (selectBestModel -> listModels uses orderedKeys -> fetch /api/tags)
    const calls: string[] = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
      calls.push(String(url));
      const auth = (init?.headers as any)?.Authorization ?? '';
      if (String(url).endsWith('/api/tags') || String(url).endsWith('/tags') || String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen3:32b' }] }), { status: 200 });
      }
      if (auth.includes('k1')) return new Response('rate limited', { status: 429 });
      return new Response(JSON.stringify({ message: { content: 'ok-from-k2' } }), { status: 200 });
    });
    try {
      const out = await g.aiGateway.chat([{ role: 'user', content: 'hi' }], { model: 'qwen3:32b' });
      expect(out).toBe('ok-from-k2');
      expect(calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      (globalThis as any).fetch = origFetch;
      delete process.env.OLLAMA_API_KEY_1;
      delete process.env.OLLAMA_API_KEY_2;
    }
  });
  it('returns SEAI_AI_PROVIDER_UNAVAILABLE when all keys fail', async () => {
    vi.resetModules();
    process.env.OLLAMA_API_KEY_1 = 'bad1';
    const g = await import('../src/ai/gateway.js');
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    try {
      await expect(g.aiGateway.chat([{ role: 'user', content: 'hi' }], { model: 'm' })).rejects.toMatchObject({ code: 'SEAI_AI_PROVIDER_UNAVAILABLE' });
    } finally {
      (globalThis as any).fetch = origFetch;
      delete process.env.OLLAMA_API_KEY_1;
    }
  });
  it('validateKeys never exposes secrets', async () => {
    vi.resetModules();
    process.env.OLLAMA_API_KEY_1 = 'secret-abc';
    const g = await import('../src/ai/gateway.js');
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'qwen3:32b' }] }), { status: 200 }));
    try {
      const rows = await g.aiGateway.validateKeys(2000);
      expect(JSON.stringify(rows)).not.toContain('secret-abc');
      expect(rows[0].keyId).toBe('key_1');
    } finally {
      (globalThis as any).fetch = origFetch;
      delete process.env.OLLAMA_API_KEY_1;
    }
  });
});

describe('model discovery ordering', () => {
  it('selectBestModel prefers tools+reasoning', async () => {
    vi.resetModules();
    process.env.OLLAMA_API_KEY_1 = 'k1';
    const g = await import('../src/ai/gateway.js');
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'llama2:7b' }, { name: 'qwen3:32b' }, { name: 'llava:7b' }] }), { status: 200 }));
    try {
      const best = await g.aiGateway.selectBestModel();
      expect(best).toBe('qwen3:32b');
    } finally {
      (globalThis as any).fetch = origFetch;
      delete process.env.OLLAMA_API_KEY_1;
    }
  });
});
