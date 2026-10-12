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

describe('experiential gateway routing (claude-fable-5.1)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('isExperModel matches only claude-fable-5.1', async () => {
    const { isExperModel } = await import('../src/ai/gateway.js');
    expect(isExperModel('claude-fable-5.1')).toBe(true);
    expect(isExperModel('claude-fable-5.1-extra')).toBe(false);
    expect(isExperModel('qwen3:32b')).toBe(false);
  });

  it('chat routes to the Experiential base URL with Bearer key and returns content', async () => {
    vi.stubEnv('EXPLABS_API_KEY', 'xpl_testsecret');
    vi.stubEnv('AI_PRIMARY_MODEL', 'claude-fable-5.1');
    vi.resetModules();
    const g = await import('../src/ai/gateway.js');
    const calls: { url: string; init: any }[] = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'hello from experiential' } }],
        usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
      }), { status: 200 });
    });
    try {
      const out = await g.aiGateway.chat([{ role: 'user', content: 'hi' }], { model: 'claude-fable-5.1' });
      expect(out).toBe('hello from experiential');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.experientiallabs.ai/v1/chat/completions');
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer xpl_testsecret');
      const body = JSON.parse(calls[0].init.body);
      expect(body.model).toBe('claude-fable-5.1');
      expect(body.stream).toBe(false);
      expect(body.temperature).toBeUndefined(); // route only accepts 1.0; omitted on purpose
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  it('throws SEAI_EXPLABS_KEY_MISSING with Settings guidance when key is absent', async () => {
    vi.stubEnv('EXPLABS_API_KEY', '');
    vi.stubEnv('AI_PRIMARY_MODEL', 'claude-fable-5.1');
    vi.resetModules();
    const g = await import('../src/ai/gateway.js');
    await expect(g.aiGateway.chat([{ role: 'user', content: 'hi' }], { model: 'claude-fable-5.1' }))
      .rejects.toMatchObject({ code: 'SEAI_EXPLABS_KEY_MISSING' });
  });
});
