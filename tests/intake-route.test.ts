import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { intakeRouter } from '../src/intake/routes.js';
import { setMailSender, resetMailSender, type MailSender } from '../src/mail/dispatch.js';
import type { OutgoingMail, SendResult } from '../src/mail/transport.js';

const OPS = 'ops-inbox@example.com';
const sent: OutgoingMail[] = [];
let server: ReturnType<typeof createServer>;
let baseUrl = '';
let priorRateLimit = 0;
let priorOpsInbox = '';

const fakeSender: MailSender = async (mail: OutgoingMail): Promise<SendResult> => {
  sent.push(mail);
  return { messageId: `<intake-${sent.length}@seai.store>`, response: '250 OK' };
};

function makeApp() {
  const app = express();
  // Production runs behind Vercel, so the client address arrives in
  // X-Forwarded-For. Trusting it here lets each case get its own rate-limit
  // bucket instead of sharing one for the whole file.
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));
  // Mounted exactly where src/app.ts mounts it: ahead of the /api session guard.
  app.use('/api', intakeRouter);
  return app;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: `key-${Math.random().toString(36).slice(2, 12)}`,
    businessName: 'Sharma Dental Studio',
    email: 'aarav@example.com',
    clientName: 'Aarav Sharma',
    phone: '+91 98765 43210',
    businessType: 'Healthcare',
    industry: 'Dental clinic',
    location: 'Pune, India',
    whatYouDo: 'Family dental care and implants',
    targetCustomers: 'Families in Pune',
    businessDescription: 'A ten year old practice run by the second-generation dentist.',
    sellingPoints: 'Same-day emergency slots',
    goals: 'Fill the appointment book online',
    preferredStyle: 'Calm and clinical',
    preferredColors: 'Deep teal, white',
    preferredTypography: 'Inter',
    pagesRequested: ['Home', 'Contact'],
    featuresRequested: ['Contact form'],
    references: 'https://example.com',
    competitors: 'Practo',
    specialInstructions: 'Keep the existing logo.',
    content: { about: 'Pune dental practice since 2014.', services: ['Implants', 'Cleaning'] },
    plan: 'Premium One-Page Website',
    amount: '9999',
    intakeSession: 'intake:test-session',
    files: [],
    ...overrides,
  };
}

let ipCounter = 0;

async function post(body: unknown, ip?: string) {
  // Default to a fresh client address per call so cases cannot starve each
  // other out of the per-IP quota.
  const address = ip ?? `203.0.113.${(ipCounter += 1)}`;
  const res = await fetch(`${baseUrl}/api/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  priorOpsInbox = config.opsInbox;
  priorRateLimit = config.intakeRateLimitPerHour;
  // Keep the route pointed at a known internal address, and keep the per-IP
  // counter out of the way so unrelated cases cannot starve each other.
  config.opsInbox = OPS;
  config.intakeRateLimitPerHour = 500;
  setMailSender(fakeSender);
  await db.init();
  server = createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetMailSender();
  config.opsInbox = priorOpsInbox;
  config.intakeRateLimitPerHour = priorRateLimit;
  await db.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('public intake route', () => {
  it('accepts an anonymous submission and mails the internal report', async () => {
    const body = validBody();
    const { status, body: json } = await post(body);

    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(typeof json.reference).toBe('string');
    expect(json.reference).toHaveLength(8);

    // Exactly one mail, addressed to operations — never to the client.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(OPS);
    expect(sent[0].to).not.toContain('aarav@example.com');
    expect(sent[0].subject).toContain('Sharma Dental Studio');
  });

  it('never leaks the internal recipient or the report state to the client', async () => {
    const { body: json } = await post(validBody());
    const serialised = JSON.stringify(json);

    expect(serialised).not.toContain(OPS);
    expect(serialised).not.toContain('ops-inbox');
    expect(json).not.toHaveProperty('opsInbox');
    expect(json).not.toHaveProperty('reportStatus');
    expect(json).not.toHaveProperty('messageId');
  });

  it('puts the submitted answers in the report body', async () => {
    await post(validBody({ businessDescription: 'A ten year old practice run by the second-generation dentist.' }));

    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.html).toContain('A ten year old practice');
    expect(mail.html).toContain('aarav@example.com');
    expect(mail.html).toContain('Pune, India');
    expect(mail.text).toContain('aarav@example.com');
  });

  it('renders the report with the shared design system, not a raw dump', async () => {
    await post(validBody());

    const [mail] = sent;
    // Production mail carries a text wordmark; no remote logo image.
    expect(mail.html).toContain('SEAI');
    expect(mail.html).not.toMatch(/<img[^>]+src=["']https?:/i);
    // The stored row is JSON encoded, but the report itself must not be.
    expect(mail.html).not.toContain('{"');
  });

  it('persists the intake before any mail work', async () => {
    const body = validBody();
    const { body: json } = await post(body);

    const rows = await db.list('intakes', { idempotency_key: body.idempotencyKey }, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].business_name).toBe('Sharma Dental Studio');
    // Server-normalised, not whatever the browser sent.
    expect(rows[0].email).toBe('aarav@example.com');
    expect(rows[0].report_status).toBe('sent');
    expect(rows[0].report_message_id).toBeTruthy();
    expect(String(rows[0].id)).toMatch(new RegExp(`^${json.reference}`, 'i'));
  });

  it('treats a replayed idempotency key as a duplicate and sends no second report', async () => {
    const body = validBody();
    const first = await post(body);
    expect(first.status).toBe(201);
    expect(sent).toHaveLength(1);

    const second = await post(body);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    // One intake row, one email.
    const rows = await db.list('intakes', { idempotency_key: body.idempotencyKey }, 5);
    expect(rows).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('accepts a bare intake session id and still records the storage scope', async () => {
    // seai.store hands the browser a bare session id while the proxy scopes the
    // uploads to `intake:<session>`, so the route must expand it.
    const body = validBody({ intakeSession: 'abc123def456' });
    await post(body);

    const rows = await db.list('intakes', { idempotency_key: body.idempotencyKey }, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].storage_scope).toBe('intake:abc123def456');
  });

  it('leaves an already-prefixed intake scope untouched', async () => {
    const body = validBody({ intakeSession: 'intake:abc123def456' });
    await post(body);

    const rows = await db.list('intakes', { idempotency_key: body.idempotencyKey }, 5);
    expect(rows[0].storage_scope).toBe('intake:abc123def456');
  });

  it('rejects a submission with no business name', async () => {
    const { status, body } = await post(validBody({ businessName: '' }));
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('rejects a submission with an invalid email', async () => {
    const { status } = await post(validBody({ email: 'not-an-email' }));
    expect(status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('rejects a submission with no idempotency key', async () => {
    const { status } = await post(validBody({ idempotencyKey: '' }));
    expect(status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('silently drops a honeypot submission without storing or mailing it', async () => {
    const body = validBody({ website: 'http://spam.example' });
    const { status, body: json } = await post(body);

    // Answered as if accepted so a bot learns nothing.
    expect(status).toBe(202);
    expect(json.received).toBe(true);
    expect(sent).toHaveLength(0);
    const rows = await db.list('intakes', { idempotency_key: body.idempotencyKey }, 5);
    expect(rows).toHaveLength(0);
  });

  it('rate limits a flood from one client', async () => {
    config.intakeRateLimitPerHour = 2;
    const ip = '198.51.100.7';
    try {
      const first = await post(validBody(), ip);
      const second = await post(validBody(), ip);
      const third = await post(validBody(), ip);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(third.status).toBe(429);
      expect(sent).toHaveLength(2);
    } finally {
      config.intakeRateLimitPerHour = priorRateLimit;
    }
  });

  it('still stores the submission when the mail provider is down', async () => {
    setMailSender(async () => {
      throw new Error('smtp unavailable');
    });
    try {
      const body = validBody();
      const { status, body: json } = await post(body);

      // The client is not told the report failed.
      expect(status).toBe(201);
      expect(json.ok).toBe(true);

      const rows = await db.list('intakes', { idempotency_key: body.idempotencyKey }, 5);
      expect(rows).toHaveLength(1);
      expect(rows[0].report_status).not.toBe('sent');
    } finally {
      setMailSender(fakeSender);
    }
  });
});