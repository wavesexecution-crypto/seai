import { getTool } from '../agent/tools.js';

// Security boundaries: model output is data, never code.
export function validateToolArgs(toolName: string, args: unknown): { ok: boolean; value?: Record<string, any>; error?: string } {
  const def = getTool(toolName);
  if (!def) return { ok: false, error: `unknown tool: ${toolName} (not in allowlist)` };
  if (typeof args !== 'object' || args === null) return { ok: false, error: 'args must be an object' };
  const parsed = def.inputSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: `schema validation failed: ${parsed.error.message.slice(0, 500)}` };
  // Block prototype pollution / unexpected giants
  const raw = args as Record<string, any>;
  for (const k of Object.keys(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return { ok: false, error: 'forbidden key' };
  }
  if (JSON.stringify(raw).length > 20000) return { ok: false, error: 'args too large' };
  return { ok: true, value: parsed.data as Record<string, any> };
}

export function sanitizeForModel(value: unknown): unknown {
  // Strip anything that looks like a secret before it could reach model context
  const s = JSON.stringify(value);
  const scrubbed = s.replace(/(shpat_|sk-ant-|ollama[^"]{0,8}|bearer\s+)[A-Za-z0-9_\-]{6,}/gi, '[REDACTED]');
  try { return JSON.parse(scrubbed); } catch { return value; }
}

export function assertNoSecretsInResponse(obj: unknown): void {
  const s = JSON.stringify(obj ?? {});
  if (/shpat_[A-Za-z0-9]+/i.test(s)) throw new Error('secret leak blocked: shopify token pattern in response');
  if (/OLLAMA_API_KEY/i.test(s)) throw new Error('secret leak blocked: key name in response');
}
