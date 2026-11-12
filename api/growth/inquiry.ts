// @ts-nocheck
/**
 * POST /api/growth/inquiry
 *
 * Public inquiry intake for the SEAI contact form (seai.public).
 * Validates, rate-limits, persists to the growth_inquiries table, and
 * attempts the internal notification email (best-effort).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { createHash } from 'node:crypto';

import { readJsonBody, bodyErrorResponse } from '../../server/payments-core.js';

// Compiled modules produced by `npm run build` (tsc server).
import { db } from '../../dist/db/db.js';
import { createInquiry } from '../../dist/growth/service.js';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string): boolean {
  const nowMs = Date.now();
  const b = buckets.get(ip);
  if (!b || nowMs > b.reset) { buckets.set(ip, { count: 1, reset: nowMs + WINDOW_MS }); return true; }
  b.count += 1;
  return b.count <= MAX_PER_WINDOW;
}

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(6).max(32).regex(/^[0-9+()\-\s]+$/, 'Phone may only contain digits and + ( ) -'),
  industry: z.string().trim().max(120).optional(),
  website: z.string().trim().max(300).optional(),
  servicesRequired: z.union([z.array(z.string()).max(12), z.string().max(500)]).optional(),
  monthlyMarketingBudget: z.string().trim().max(60).optional(),
  advertisingBudget: z.string().trim().max(60).optional(),
  objective: z.string().trim().max(500).optional(),
  details: z.string().trim().max(4000).optional(),
  _gotcha: z.string().optional(),
});

let booted = false;
async function ensureBoot() {
  if (booted) return;
  try { await db.init(); } catch { /* memory fallback */ }
  booted = true;
}

function setCors(res: VercelResponse, origin: string | undefined) {
  const allowed = origin && /^https?:\/\/(.*\.)?seai\.store$/.test(origin) ? origin : '*';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
  const origin = req.headers.origin as string | undefined;
  setCors(res, origin);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).send(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }
  await ensureBoot();
  const ip = String(req.headers['x-forwarded-for'] ?? (req as any).socket?.remoteAddress ?? '').split(',')[0].trim();
  if (!rateLimit(ip)) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(429).send(JSON.stringify({ ok: false, error: 'Too many submissions — please try again later.' }));
  }
  let bodyResult: { ok: boolean; value?: any; error?: string };
  try {
    bodyResult = await readJsonBody(req);
  } catch (err: any) {
    console.error('[growth-inquiry] readJsonBody threw', err);
    // Fall back to reading the raw stream.
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req as any) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      bodyResult = text ? (() => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, error: 'invalid_json' }; } })() : { ok: false, error: 'empty_body' };
    } catch (e: any) {
      console.error('[growth-inquiry] stream read failed', e);
      bodyResult = { ok: false, error: 'body_read_failed' };
    }
  }
  if (!bodyResult.ok) {
    const { status, message } = bodyErrorResponse(bodyResult.error as any);
    res.setHeader('Content-Type', 'application/json');
    return res.status(status).send(JSON.stringify({ ok: false, error: message }));
  }
  const parsed = inquirySchema.safeParse(bodyResult.value ?? {});
  if (!parsed.success) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).send(JSON.stringify({ ok: false, error: parsed.error?.errors?.[0]?.message ?? 'Invalid submission' }));
  }
  const { _gotcha, ...input } = parsed.data;
  if (_gotcha) {
    return res.status(200).json({ ok: true, message: 'Thanks — we will be in touch shortly.' });
  }
  const ipHash = createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 16);
  try {
    const result = await createInquiry(input as any, ipHash);
    return res.status(200).json({ ok: true, id: result.id, message: 'Thanks — we will reach out within one working day.' });
  } catch (err: any) {
    console.error('[growth-inquiry] createInquiry failed', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).send(JSON.stringify({ ok: false, error: 'Submission failed — please try again.' }));
  }
  } catch (err: any) {
    console.error('[growth-inquiry] unhandled', err);
    try { res.setHeader('Content-Type', 'application/json'); } catch {}
    if (!res.headersSent) res.status(500).send(JSON.stringify({ ok: false, error: 'Submission failed — please try again.' }));
  }
}