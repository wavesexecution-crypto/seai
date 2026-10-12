import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { mailEventsRouter, templateForEvent, verifyEventSignature } from '../src/mail/events.js';
import { setMailSender, resetMailSender, type MailSender } from '../src/mail/dispatch.js';
import type { OutgoingMail, SendResult } from '../src/mail/transport.js';

const SECRET = 'test-shared-secret-0123456789';
const sent: OutgoingMail[] = [];
let server: ReturnType<typeof createServer>;
let baseUrl = '';

const fakeSender: MailSender = async (mail: OutgoingMail): Promise<SendResult> => {
  sent.push(mail);
  return { messageId: '<evt@seai.store>', response: '250 OK' };
};

function makeApp() {
  // Mounted the same way as src/app.ts: the route must see the raw body so the
  // signature covers exactly what the sender signed.
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use('/api/internal/mail', mailEventsRouter);
  return app;
}

function sign(body: string, timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function postEvent(body: unknown, override: { ts?: string; sig?: string; raw?: string } = {}) {
  const raw = override.raw ?? JSON.stringify(body);
  const ts = override.ts ?? String(Date.now());
  const res = await fetch(`${baseUrl}/api/internal/mail/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-seai-event-timestamp': ts,
      'x-seai-event-signature': override.sig ?? sign(raw, ts),
    },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  config.eventsSharedSecret = SECRET;
  setMailSender(fakeSender);
  await db.init();
  server = createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetMailSender();
  config.eventsSharedSecret = '';
  await db.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('event template mapping', () => {
  it('accepts lifecycle events and rejects reserved/internal ones', () => {
    expect(templateForEvent('payment.successful')).toBe('payment.successful');
    expect(templateForEvent('change.received')).toBe('change.received');
    expect(templateForEvent('website.deployed')).toBe('website.deployed');
    expect(templateForEvent('maintenance.activated')).toBe('maintenance.activated');
    expect(templateForEvent('report.performance')).toBeNull();
    expect(templateForEvent('sales.cold_outreach')).toBeNull();
    expect(templateForEvent('account.new_sign_in_alert')).toBeNull();
    expect(templateForEvent('totally.made_up')).toBeNull();
  });
});

describe('signature verification', () => {
  it('accepts a correct signature and rejects wrong, stale, and malformed ones', () => {
    const body = '{"id":"evt_verify_1","name":"payment.successful"}';
    const now = String(Date.now());
    expect(verifyEventSignature(body, now, sign(body, now))).toBe(true);
    expect(verifyEventSignature(body, now, 'f'.repeat(64))).toBe(false);
    expect(verifyEventSignature(body, now, 'short')).toBe(false);
    const stale = String(Date.now() - 10 * 60 * 1000);
    expect(verifyEventSignature(body, stale, sign(body, stale))).toBe(false);
    expect(verifyEventSignature(body, 'not-a-number', sign(body, 'not-a-number'))).toBe(false);
  });
});

describe('intake route', () => {
  it('sends the mapped template for a signed payment event', async () => {
    const res = await postEvent({
      id: 'evt_pay_0001',
      name: 'payment.successful',
      recipient: 'payer@example.com',
      variables: { amount: '₹9,999', order_id: 'ord_1', status: 'Successful' },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.template).toBe('payment.successful');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('payer@example.com');
  });

  it('treats a replayed event id as a no-op', async () => {
    const body = { id: 'evt_replay_1', name: 'payment.successful', recipient: 'replay@example.com', variables: { amount: '₹1', order_id: 'ord_r', status: 'Successful' } };
    const first = await postEvent(body);
    const second = await postEvent(body);
    expect(first.body.status).toBe('sent');
    expect(second.body.status).toBe('duplicate');
    expect(sent).toHaveLength(1);
  });

  it('rejects an unsigned request', async () => {
    const res = await postEvent({ id: 'evt_unsigned_1', name: 'payment.successful', recipient: 'x@example.com' }, { sig: 'a'.repeat(64) });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('rejects a body that was changed after signing', async () => {
    const signed = JSON.stringify({ id: 'evt_tamper_1', name: 'payment.successful', recipient: 'x@example.com' });
    const res = await postEvent(null, {
      raw: JSON.stringify({ id: 'evt_tamper_1', name: 'payment.successful', recipient: 'attacker@evil.example' }),
      sig: sign(signed, String(Date.now())),
    });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('derives a missing status from the event name', async () => {
    const res = await postEvent({
      id: 'evt_derive_1',
      name: 'payment.successful',
      recipient: 'derive@example.com',
      variables: { amount: '₹499', order_id: 'ord_derive' },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(sent[0].html).toContain('Successful');
  });

  it('rejects an unsupported event name', async () => {
    const res = await postEvent({ id: 'evt_unknown_1', name: 'totally.made_up', recipient: 'x@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported event/);
  });

  it('rejects a reserved, unwired template', async () => {
    const res = await postEvent({ id: 'evt_sales_1', name: 'sales.cold_outreach', recipient: 'lead@example.com' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('requires a recorded domain before a readiness email is sent', async () => {
    const res = await postEvent({ id: 'evt_ready_1', name: 'website.ready', recipient: 'client@example.com', variables: { website_name: 'Sharma Dental' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domain/);
    expect(sent).toHaveLength(0);
  });

  it('builds the live url from the recorded domain', async () => {
    const res = await postEvent({
      id: 'evt_deploy_1',
      name: 'website.deployed',
      recipient: 'client@example.com',
      variables: { website_name: 'Sharma Dental', domain: 'sharmadental.example.com', status: 'Live' },
    });
    expect(res.status).toBe(200);
    expect(sent[0].html).toContain('https://sharmadental.example.com');
  });

  it('rejects an event with no resolvable recipient', async () => {
    const res = await postEvent({ id: 'evt_norcpt_1', name: 'payment.successful', variables: { amount: '₹1' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recipient/i);
  });

  it('reports a render failure as 502 without claiming success', async () => {
    const res = await postEvent({
      id: 'evt_renderfail_1',
      name: 'change.received',
      recipient: 'client@example.com',
      variables: { request_title: 'No request id supplied' },
    });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(/request_id/);
  });

  it('is disabled entirely when no shared secret is configured', async () => {
    config.eventsSharedSecret = '';
    const res = await postEvent({ id: 'evt_disabled_1', name: 'payment.successful', recipient: 'x@example.com' });
    expect(res.status).toBe(503);
    config.eventsSharedSecret = SECRET;
  });
});
