import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/db.js';

export type KeyStatus = 'healthy' | 'degraded' | 'rate_limited' | 'cooldown' | 'failed' | 'unknown';
export type ErrorClass =
  | 'rate_limited'
  | 'auth'
  | 'model_not_found'
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad_request'
  | 'provider_unavailable';

export interface KeyHealth {
  keyId: string;
  slot: number;
  status: KeyStatus;
  lastSuccess: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  requestCount: number;
  avgLatencyMs: number;
  rateLimitCount: number;
  cooldownUntil: string | null;
}

export interface ModelCaps {
  name: string;
  capabilities: string[];
  contextLength: number | null;
  parameterSize: string | null;
  vision: boolean;
  toolSupport: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  availability: string;
  health: string;
  avgLatencyMs: number;
  score: number;
}

export interface GenerateOpts {
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

const inMemHealth: Map<string, KeyHealth> = new Map();
for (let i = 1; i <= 6; i++) {
  inMemHealth.set(`key_${i}`, {
    keyId: `key_${i}`, slot: i, status: 'unknown',
    lastSuccess: null, lastFailure: null, consecutiveFailures: 0,
    requestCount: 0, avgLatencyMs: 0, rateLimitCount: 0, cooldownUntil: null,
  });
}

export function classifyError(status: number | null, message: string): ErrorClass {
  const m = (message || '').toLowerCase();
  if (status === 429 || m.includes('rate limit') || m.includes('too many requests')) return 'rate_limited';
  if (status === 401 || status === 403 || m.includes('unauthorized') || m.includes('invalid api key')) return 'auth';
  if (status === 404 || m.includes('model') && m.includes('not found')) return 'model_not_found';
  if (m.includes('timeout') || m.includes('aborted')) return 'timeout';
  if (m.includes('fetch failed') || m.includes('network') || m.includes('econn')) return 'network';
  if (status && status >= 500) return 'server';
  if (status === 400 || status === 422) return 'bad_request';
  return 'server';
}

function cooldownMs(consecutiveFailures: number, errorClass: ErrorClass): number {
  if (errorClass === 'rate_limited') return Math.min(5 * 60_000, 15_000 * 2 ** Math.min(consecutiveFailures, 4));
  return Math.min(2 * 60_000, 5_000 * 2 ** Math.min(consecutiveFailures, 4));
}

async function getHealth(keyId: string): Promise<KeyHealth> {
  const base = inMemHealth.get(keyId)!;
  try {
    const rows = await db.list('ai_keys', { id: keyId } as any, 1);
    if (rows[0]) {
      return {
        keyId,
        slot: rows[0].slot ?? base.slot,
        status: (rows[0].status as KeyStatus) ?? base.status,
        lastSuccess: rows[0].last_success ?? base.lastSuccess,
        lastFailure: rows[0].last_failure ?? base.lastFailure,
        consecutiveFailures: rows[0].consecutive_failures ?? 0,
        requestCount: Number(rows[0].request_count ?? 0),
        avgLatencyMs: rows[0].avg_latency_ms ?? 0,
        rateLimitCount: rows[0].rate_limit_count ?? 0,
        cooldownUntil: rows[0].cooldown_until ?? null,
      };
    }
  } catch { /* memory fallback */ }
  return { ...base };
}

async function setHealth(h: KeyHealth): Promise<void> {
  inMemHealth.set(h.keyId, { ...h });
  try {
    const existing = await db.list('ai_keys', { id: h.keyId } as any, 1);
    const row = {
      id: h.keyId, key_id: h.keyId, slot: h.slot, status: h.status,
      last_success: h.lastSuccess, last_failure: h.lastFailure,
      consecutive_failures: h.consecutiveFailures, request_count: h.requestCount,
      rate_limit_count: h.rateLimitCount, cooldown_until: h.cooldownUntil,
      avg_latency_ms: h.avgLatencyMs, updated_at: new Date().toISOString(),
    };
    if (existing[0]) await db.update('ai_keys', h.keyId, row);
    else await db.insert('ai_keys', row);
  } catch { /* ignore */ }
}

function keyAvailable(h: KeyHealth, now: number): boolean {
  if (h.cooldownUntil && new Date(h.cooldownUntil).getTime() > now) return false;
  if (h.status === 'failed' && h.consecutiveFailures >= 10) return false;
  return true;
}

/** Order key slots healthiest-first. Never exposes raw keys. */
export async function orderedKeys(): Promise<{ keyId: string; slot: number; key: string }[]> {
  const now = Date.now();
  const out: { keyId: string; slot: number; key: string; h: KeyHealth }[] = [];
  for (let i = 0; i < config.ollamaKeys.length; i++) {
    const keyId = `key_${i + 1}`;
    const h = await getHealth(keyId);
    out.push({ keyId, slot: i + 1, key: config.ollamaKeys[i], h });
  }
  const rank = (s: KeyStatus) =>
    s === 'healthy' ? 0 : s === 'unknown' ? 1 : s === 'degraded' ? 2 : s === 'rate_limited' ? 3 : s === 'cooldown' ? 4 : 5;
  out.sort((a, b) => {
    const aa = keyAvailable(a.h, now) ? 0 : 1;
    const bb = keyAvailable(b.h, now) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    if (rank(a.h.status) !== rank(b.h.status)) return rank(a.h.status) - rank(b.h.status);
    return a.h.avgLatencyMs - b.h.avgLatencyMs;
  });
  return out;
}

async function recordSuccess(keyId: string, latencyMs: number) {
  const h = await getHealth(keyId);
  h.status = 'healthy';
  h.lastSuccess = new Date().toISOString();
  h.consecutiveFailures = 0;
  h.requestCount += 1;
  h.avgLatencyMs = Math.round(h.avgLatencyMs === 0 ? latencyMs : h.avgLatencyMs * 0.8 + latencyMs * 0.2);
  h.cooldownUntil = null;
  await setHealth(h);
}

async function recordFailure(keyId: string, errorClass: ErrorClass) {
  const h = await getHealth(keyId);
  h.lastFailure = new Date().toISOString();
  h.consecutiveFailures += 1;
  h.requestCount += 1;
  if (errorClass === 'rate_limited') {
    h.rateLimitCount += 1;
    h.status = 'rate_limited';
  } else if (errorClass === 'auth') {
    h.status = 'failed';
  } else if (h.consecutiveFailures >= 5) {
    h.status = 'failed';
  } else if (h.consecutiveFailures >= 2) {
    h.status = 'degraded';
  }
  h.cooldownUntil = new Date(Date.now() + cooldownMs(h.consecutiveFailures, errorClass)).toISOString();
  await setHealth(h);
}

async function logRequest(storeId: string | null, keyId: string, model: string, kind: string, latencyMs: number, ok: boolean, errorClass?: string) {
  try {
    await db.insert('ai_requests', {
      id: randomUUID(), store_id: storeId, key_id: keyId, model, kind, latency_ms: latencyMs, ok, error_class: errorClass ?? null,
    });
  } catch { /* ignore */ }
}

async function doFetch(path: string, key: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    return await fetch(`${config.ollamaBaseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ---- Experiential gateway (OpenAI Chat Completions compatible) ----
// Routes the model claude-fable-5.1 through api.experientiallabs.ai instead of
// calling the provider directly. This is a base-URL + key swap onto the OpenAI
// protocol (/v1/chat/completions).

const EXPER_MODEL = 'claude-fable-5.1';

/** True when the given model should be routed through the Experiential gateway. */
export function isExperModel(model: string): boolean {
  return model === EXPER_MODEL;
}

function requireExperKey(): string {
  const key = config.experKey;
  if (!key) {
    const e: any = new Error(
      'SEAI_EXPLABS_KEY_MISSING: EXPLABS_API_KEY is not set. Create one under Settings -> API keys and export it (e.g. set EXPLABS_API_KEY=xpl_... ) before using model claude-fable-5.1.'
    );
    e.code = 'SEAI_EXPLABS_KEY_MISSING';
    throw e;
  }
  return key;
}

async function doExperFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const key = requireExperKey();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    return await fetch(`${config.experBaseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

interface ChatMessage {
  role: string;
  content: string;
}

interface ExperResponse {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Non-streaming OpenAI Chat Completions call against the Experiential gateway.
 * Preserves the existing streaming/tool-call behavior of the caller by returning
 * the assistant text; tool args are passed as JSON-in-content and validated
 * downstream exactly as before.
 * Exported for the test/verification script, which needs the token usage.
 */
export async function experChat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number }
): Promise<ExperResponse> {
  const timeoutMs = opts.timeoutMs ?? config.agentTimeoutMs;
  const body: Record<string, unknown> = {
    model: EXPER_MODEL,
    messages,
    stream: false,
    max_tokens: opts.maxTokens ?? 2000,
  };
  // The claude-fable-5.1 route only accepts temperature 1.0; omit it to use
  // the route default rather than sending the Ollama-world default of 0.2.
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: 'json_object' };
  const res = await doExperFetch('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) throw errWithStatus(`experiential chat failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
  const j = await parseJsonSafe(res);
  const content: string = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? '';
  const usage = j?.usage;
  return { content, usage };
}

/**
 * Streaming OpenAI Chat Completions call against the Experiential gateway.
 * Yields assistant text deltas as they arrive (SSE). Token usage is surfaced
 * via the caller-provided `onUsage` callback when present.
 */
async function* experChatStream(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; onUsage?: (u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => void }
): AsyncGenerator<string> {
  const timeoutMs = opts.timeoutMs ?? config.agentTimeoutMs;
  const body: Record<string, unknown> = {
    model: EXPER_MODEL,
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 2000,
  };
  // The claude-fable-5.1 route only accepts temperature 1.0; omit it to use
  // the route default rather than sending the Ollama-world default of 0.2.
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const res = await doExperFetch('/chat/completions', { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
  if (!res.ok) throw errWithStatus(`experiential stream failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
  const reader = res.body?.getReader();
  if (!reader) { yield ''; return; }
  const dec = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload);
        const delta = j?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
        if (j?.usage) opts.onUsage?.(j.usage);
      } catch { /* partial SSE */ }
    }
  }
}

/** Core resilient executor: failover across all 6 keys with backoff. Keys never leave this module. */
async function execWithFailover<T>(kind: string, model: string, storeId: string | null, timeoutMs: number, fn: (key: string, keyId: string, model: string) => Promise<T>): Promise<T> {
  const keys = await orderedKeys();
  if (!keys.length) {
    const e: any = new Error('SEAI AI_PROVIDER_UNAVAILABLE: no Ollama API keys configured');
    e.code = 'SEAI_AI_PROVIDER_UNAVAILABLE';
    throw e;
  }
  let lastErr: any = null;
  let attempted = 0;
  for (const k of keys) {
    const h = await getHealth(k.keyId);
    if (!keyAvailable(h, Date.now())) continue;
    attempted++;
    const start = Date.now();
    try {
      const out = await fn(k.key, k.keyId, model);
      await recordSuccess(k.keyId, Date.now() - start);
      await logRequest(storeId, k.keyId, model, kind, Date.now() - start, true);
      return out;
    } catch (err: any) {
      const status = err?.status ?? null;
      const cls = classifyError(status, err?.message || '');
      await recordFailure(k.keyId, cls);
      await logRequest(storeId, k.keyId, model, kind, Date.now() - start, false, cls);
      lastErr = err;
      // auth errors: try next key (may be per-key quota); rate limit: next key immediately
      // small jittered backoff between keys (not exponential sleep wall)
      await new Promise((r) => setTimeout(r, Math.min(1000, 100 * attempted)));
      continue;
    }
  }
  const e: any = new Error(`SEAI AI_PROVIDER_UNAVAILABLE: all ${attempted} available Ollama keys failed (${lastErr?.message || 'unknown'})`);
  e.code = 'SEAI_AI_PROVIDER_UNAVAILABLE';
  e.cause = lastErr;
  throw e;
}

function errWithStatus(message: string, status: number | null): Error {
  const e: any = new Error(message);
  e.status = status;
  return e;
}

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// ---- Model discovery + capability scoring ----

const CONTEXT_HINTS: [RegExp, number][] = [
  [/128k/i, 128000], [/64k/i, 64000], [/32k/i, 32000], [/16k/i, 16000],
];
const KNOWN_CONTEXT: [RegExp, number][] = [
  [/gpt-oss:?(120b|20b)?/i, 128000], [/qwen3/i, 128000], [/deepseek-r1/i, 128000],
  [/llama3\.3/i, 128000], [/llama3\.2/i, 128000], [/llama3\.1/i, 128000],
  [/mistral-large/i, 128000], [/qwen2\.5/i, 128000], [/gemma3/i, 128000],
  [/llama3/i, 32000], [/mistral/i, 32000], [/llava/i, 16000],
];

export function inferCapabilities(name: string): Omit<ModelCaps, 'availability' | 'health' | 'avgLatencyMs' | 'score'> {
  const n = name.toLowerCase();
  const toolSupport = /gpt-oss|qwen3|qwen3\.5|llama3\.[123]|mistral-large|mistral-small|qwen2\.5|deepseek|phi4|command-r|firefunction|hermes|tool|nemotron|kimi|glm|minimax|gemma4/i.test(name);
  const reasoning = /deepseek-r1|r1|qwen3|gpt-oss|reasoning|thinking|o1|qwq|nemotron|deepseek-v4|glm|qwen3\.5/i.test(name);
  const vision = /vision|llava|qwen.*vl|gemma3|llama3\.2-vision|multimodal/i.test(name);
  const structuredOutput = toolSupport || /qwen|llama3|mistral|gpt-oss|gemma/i.test(name);
  let contextLength: number | null = null;
  for (const [re, v] of CONTEXT_HINTS) if (re.test(name)) contextLength = v;
  if (!contextLength) for (const [re, v] of KNOWN_CONTEXT) if (re.test(name)) { contextLength = v; break; }
  let parameterSize: string | null = null;
  const pm = name.match(/(\d+(?:\.\d+)?b)\b/i);
  if (pm) parameterSize = pm[1].toLowerCase();
  const capabilities: string[] = [];
  if (toolSupport) capabilities.push('tools');
  if (reasoning) capabilities.push('reasoning');
  if (vision) capabilities.push('vision');
  if (structuredOutput) capabilities.push('structured-output');
  if ((contextLength ?? 0) >= 64000) capabilities.push('long-context');
  return { name, capabilities, contextLength, parameterSize, vision, toolSupport, reasoning, structuredOutput };
}

export function scoreModel(m: { toolSupport: boolean; reasoning: boolean; contextLength: number | null; vision: boolean; structuredOutput: boolean }): number {
  let s = 0;
  if (m.toolSupport) s += 30;
  if (m.reasoning) s += 25;
  const ctx = m.contextLength ?? 8000;
  s += Math.min(20, Math.round((Math.min(ctx, 256000) / 256000) * 20));
  if (m.vision) s += 10;
  if (m.structuredOutput) s += 10;
  s += 5; // availability baseline
  return s;
}

let modelCache: { at: number; models: ModelCaps[] } | null = null;

async function fetchModelNames(key: string, timeoutMs: number): Promise<string[]> {
  // Ollama Cloud: GET /api/tags (native API). Host is https://ollama.com.
  for (const path of ['/api/tags', '/v1/models']) {
    try {
      const res = await doFetch(path, key, { method: 'GET' }, Math.min(timeoutMs, 20000));
      if (!res.ok) continue;
      const j = await parseJsonSafe(res);
      const names: string[] = [];
      const list = j.models ?? j.data ?? [];
      for (const m of list) {
        const nm = m.name ?? m.id ?? m.model;
        if (typeof nm === 'string') names.push(nm);
      }
      if (names.length) return names;
    } catch { /* try next */ }
  }
  return [];
}

// ---- Public gateway interface (ONLY way the rest of SEAI touches Ollama) ----

export const aiGateway = {
  async listModels(opts: { timeoutMs?: number; refresh?: boolean } = {}): Promise<ModelCaps[]> {
    const timeoutMs = opts.timeoutMs ?? 20000;
    if (modelCache && !opts.refresh && Date.now() - modelCache.at < 5 * 60_000) return modelCache.models;
    const keys = await orderedKeys();
    if (!keys.length) return [];
    let lastErr: any = null;
    for (const k of keys.slice(0, 3)) {
      try {
        const names = await fetchModelNames(k.key, timeoutMs);
        if (!names.length) continue;
        const models: ModelCaps[] = names.map((name) => {
          const caps = inferCapabilities(name);
          return { ...caps, availability: 'available', health: 'unknown', avgLatencyMs: 0, score: scoreModel(caps) };
        });
        models.sort((a, b) => b.score - a.score);
        // persist registry (best-effort)
        for (const m of models.slice(0, 50)) {
          try {
            const ex = await db.list('ai_models', { name: m.name } as any, 1);
            const row = {
              name: m.name, capabilities: JSON.stringify(m.capabilities),
              context_length: m.contextLength, parameter_size: m.parameterSize,
              vision: m.vision, tool_support: m.toolSupport, reasoning: m.reasoning,
              structured_output: m.structuredOutput, availability: 'available', score: m.score,
              updated_at: new Date().toISOString(),
            };
            if (ex[0]) await db.update('ai_models', m.name, row);
            else await db.insert('ai_models', { ...row, id: m.name });
          } catch { /* ignore */ }
        }
        modelCache = { at: Date.now(), models };
        await recordSuccess(k.keyId, 200);
        return models;
      } catch (e) { lastErr = e; continue; }
    }
    if (modelCache) return modelCache.models;
    if (lastErr) throw lastErr;
    return [];
  },

  async getModelCapabilities(name: string): Promise<ModelCaps> {
    const caps = inferCapabilities(name);
    return { ...caps, availability: 'unknown', health: 'unknown', avgLatencyMs: 0, score: scoreModel(caps) };
  },

  /** Select strongest suitable model: prefers tools+reasoning+long context. Optional override via AI_PRIMARY_MODEL. */
  async selectBestModel(opts: { requireTools?: boolean; timeoutMs?: number } = {}): Promise<string> {
    const override = process.env.AI_PRIMARY_MODEL || config.aiPrimaryModel;
    if (override) return override;
    const models = await this.listModels({ timeoutMs: opts.timeoutMs ?? 20000 });
    if (!models.length) {
      // Sensible default when discovery is unreachable (still resolved dynamically at runtime)
      return 'qwen3:32b';
    }
    let pool = models.filter((m) => m.availability === 'available');
    if (opts.requireTools !== false) {
      const withTools = pool.filter((m) => m.toolSupport);
      if (withTools.length) pool = withTools;
    }
    pool.sort((a, b) => b.score - a.score);
    return pool[0].name;
  },

  async generate(prompt: string, opts: GenerateOpts = {}, storeId: string | null = null): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? config.agentTimeoutMs;
    const model = opts.model ?? (await this.selectBestModel());
    if (isExperModel(model)) {
      // Single best-effort key for Experiential (the 6-key failover pool is Ollama-specific).
      const out = await experChat([{ role: 'user', content: prompt }], { maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature, timeoutMs });
      return out.content;
    }
    return execWithFailover('generate', model, storeId, timeoutMs, async (key) => {
      const res = await doFetch('/api/generate', key, {
        method: 'POST',
        body: JSON.stringify({ model, prompt, stream: false, options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 2000 } }),
      }, timeoutMs);
      if (!res.ok) throw errWithStatus(`ollama generate failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
      const j = await parseJsonSafe(res);
      return j.response ?? j.message?.content ?? j.text ?? '';
    });
  },

  async chat(messages: { role: string; content: string }[], opts: GenerateOpts = {}, storeId: string | null = null): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? config.agentTimeoutMs;
    const model = opts.model ?? (await this.selectBestModel());
    if (isExperModel(model)) {
      // Single best-effort key for Experiential (the 6-key failover pool is Ollama-specific).
      const out = await experChat(messages, { maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature, json: opts.json, timeoutMs });
      return out.content;
    }
    return execWithFailover('chat', model, storeId, timeoutMs, async (key) => {
      const res = await doFetch('/api/chat', key, {
        method: 'POST',
        body: JSON.stringify({
          model, messages, stream: false,
          format: opts.json ? 'json' : undefined,
          options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 2000 },
        }),
      }, timeoutMs);
      if (!res.ok) throw errWithStatus(`ollama chat failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
      const j = await parseJsonSafe(res);
      // Reasoning models may return thinking with short/empty content (e.g. token budget spent thinking)
      return j.message?.content || j.message?.thinking || j.response || '';
    });
  },

  /** Structured tool-call: asks the model to emit JSON args for a named tool, validated downstream. */
  async toolCall(toolName: string, toolDescription: string, inputSchema: unknown, context: string, opts: GenerateOpts = {}, storeId: string | null = null): Promise<unknown> {
    const out = await this.chat([
      { role: 'system', content: `You are SEAI, an autonomous commerce operator. Emit ONLY valid JSON args for tool "${toolName}". ${toolDescription}. Schema: ${JSON.stringify(inputSchema)}. No markdown fences.` },
      { role: 'user', content: context },
    ], { ...opts, json: true }, storeId);
    const cleaned = out.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch { return { _raw: out }; }
  },

  async *stream(prompt: string, opts: GenerateOpts = {}, storeId: string | null = null): AsyncGenerator<string> {
    const timeoutMs = opts.timeoutMs ?? config.agentTimeoutMs;
    const model = opts.model ?? (await this.selectBestModel());
    if (isExperModel(model)) {
      requireExperKey();
      const gen = experChatStream([{ role: 'user', content: prompt }], { maxTokens: opts.maxTokens ?? 2000, temperature: opts.temperature, timeoutMs });
      for await (const part of gen) {
        yield part;
      }
      return;
    }
    const keys = await orderedKeys();
    if (!keys.length) throw Object.assign(new Error('SEAI AI_PROVIDER_UNAVAILABLE'), { code: 'SEAI_AI_PROVIDER_UNAVAILABLE' });
    let lastErr: any = null;
    for (const k of keys) {
      try {
        const res = await doFetch('/api/generate', k.key, {
          method: 'POST', body: JSON.stringify({ model, prompt, stream: true }),
        }, timeoutMs);
        if (!res.ok) throw errWithStatus(`stream failed ${res.status}`, res.status);
        await recordSuccess(k.keyId, 300);
        const reader = res.body?.getReader();
        if (!reader) { yield ''; return; }
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line);
              if (j.response) yield j.response as string;
            } catch { /* ndjson partial */ }
          }
        }
        return;
      } catch (e) { lastErr = e; continue; }
    }
    throw lastErr ?? new Error('stream failed');
  },

  async keyHealth(): Promise<KeyHealth[]> {
    const out: KeyHealth[] = [];
    for (let i = 1; i <= 6; i++) {
      const h = await getHealth(`key_${i}`);
      const configured = i <= config.ollamaKeys.length;
      out.push({ ...h, status: configured ? h.status : 'unknown' });
    }
    return out;
  },

  /** Validate all six keys: returns per-key status without exposing secrets. */
  async validateKeys(timeoutMs = 12000): Promise<{ keyId: string; configured: boolean; ok: boolean; latencyMs: number; error?: string }[]> {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const keyId = `key_${i + 1}`;
      const key = config.ollamaKeys[i];
      if (!key) { out.push({ keyId, configured: false, ok: false, latencyMs: 0, error: 'not configured' }); continue; }
      const start = Date.now();
      try {
        const names = await fetchModelNames(key, timeoutMs);
        const h = await getHealth(keyId);
        h.status = 'healthy'; h.lastSuccess = new Date().toISOString(); h.consecutiveFailures = 0;
        h.avgLatencyMs = Date.now() - start; h.cooldownUntil = null;
        await setHealth(h);
        out.push({ keyId, configured: true, ok: true, latencyMs: Date.now() - start });
        void names;
      } catch (e: any) {
        await recordFailure(keyId, classifyError(e?.status ?? null, e?.message || ''));
        out.push({ keyId, configured: true, ok: false, latencyMs: Date.now() - start, error: (e?.message || 'failed').slice(0, 200) });
      }
    }
    return out;
  },
};

export type AIGateway = typeof aiGateway;
