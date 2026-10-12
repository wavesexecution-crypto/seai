import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { mailEventsRouter } from '../src/mail/events.js';
import { resetMailSender, setMailSender } from '../src/mail/dispatch.js';
import type { OutgoingMail, SendResult } from '../src/mail/transport.js';

const SECRET = 'test-payment-provision-secret';
let server: ReturnType<typeof createServer>;
let baseUrl = '';

const fakeSender = async (_mail: OutgoingMail): Promise<SendResult> => {
  return { messageId: '<provision@seai.store>', response: '250 OK' };
};

function makeApp() {
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

function sign(body: string, timestamp: string): string {
  return createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
}

async function postEvent(body: unknown) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const res = await fetch(`${baseUrl}/api/internal/mail/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-seai-event-timestamp': ts,
      'x-seai-event-signature': sign(raw, ts),
    },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('paid payment provisioning', () => {
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

  it('provisions the dashboard user and paid website exactly once for repeated payment events', async () => {
    const marker = `paid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `${marker}@example.com`;
    const orderId = `ord_${marker}`;
    const body = {
      id: `evt_${marker}`,
      name: 'payment.successful',
      recipient: email,
      occurredAt: new Date().toISOString(),
      variables: {
        amount: '₹ 7999.00',
        amount_paise: 799900,
        currency: 'INR',
        status: 'Successful',
        plan_name: 'COMPLETE',
        order_id: orderId,
        payment_id: `pay_${marker}`,
        purchased_at: new Date().toISOString(),
        receipt_id: orderId,
        business_name: 'ACME Restaurant',
      },
    };

    const first = await postEvent(body);
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const users = await db.list('users', { email }, 1);
    expect(users).toHaveLength(1);

    const websites = await db.list('customer_websites', { user_id: users[0].id }, 1);
    expect(websites).toHaveLength(1);
    expect(websites[0].order_id).toBe(orderId);
    expect(websites[0].plan_name).toBe('COMPLETE');
    expect(websites[0].order_amount_paise).toBe(799900);

    const duplicate = await postEvent(body);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.status).toBe('duplicate');

    expect(await db.list('users', { email }, 1)).toHaveLength(1);
    expect(await db.list('customer_websites', { user_id: users[0].id }, 1)).toHaveLength(1);

    await db.deleteWhere('customer_websites', { user_id: users[0].id });
    await db.deleteWhere('users', { id: users[0].id });
  });
});
