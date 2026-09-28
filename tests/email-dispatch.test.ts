import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db } from '../src/db/db.js';
import {
  dispatchEmail,
  dispatchMany,
  isValidRecipient,
  resetMailSender,
  setMailDryRun,
  setMailSender,
  type MailSender,
} from '../src/mail/dispatch.js';
import { listDeliveries, listEvents, normalizeRecipient, buildDedupeKey, MAX_ATTEMPTS } from '../src/mail/store.js';
import { previewContext } from '../src/mail/fixtures.js';
import type { OutgoingMail, SendResult } from '../src/mail/transport.js';

const sent: OutgoingMail[] = [];
let failNext = false;
let messageCounter = 0;

const fakeSender: MailSender = async (mail: OutgoingMail): Promise<SendResult> => {
  if (failNext) {
    failNext = false;
    throw new Error('smtp connect ECONNREFUSED 10.0.0.25:587');
  }
  sent.push(mail);
  messageCounter += 1;
  return { messageId: `<test-${messageCounter}@seai.store>`, response: '250 2.0.0 OK queued' };
};

const welcomeVars = () => previewContext({ customer_name: 'Aarav Sharma' });

beforeAll(async () => {
  await db.init();
  setMailSender(fakeSender);
});

afterAll(async () => {
  resetMailSender();
  await db.close();
});

beforeEach(() => {
  sent.length = 0;
  failNext = false;
  setMailDryRun(false);
});

describe('recipient and dedupe helpers', () => {
  it('validates and normalises addresses', () => {
    expect(isValidRecipient('a@b.co')).toBe(true);
    expect(isValidRecipient('a@b')).toBe(false);
    expect(isValidRecipient('not-an-email')).toBe(false);
    expect(normalizeRecipient('  Aarav@Example.COM ')).toBe('aarav@example.com');
  });

  it('builds a stable dedupe key from the same inputs', () => {
    expect(buildDedupeKey('change.received', ['req_1', 'a@b.co'])).toBe(buildDedupeKey('change.received', ['req_1', 'a@b.co']));
    expect(buildDedupeKey('change.received', ['req_1'])).not.toBe(buildDedupeKey('change.received', ['req_2']));
  });
});

describe('dispatch pipeline', () => {
  it('sends once and records a sent delivery', async () => {
    const result = await dispatchEmail({
      eventName: 'account.welcome',
      template: 'account.welcome',
      to: 'aarav@example.com',
      variables: welcomeVars(),
      customerId: 'usr_1',
      dedupeKey: 'test:welcome:usr_1',
      correlationId: 'corr_welcome_1',
    });
    expect(result.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('aarav@example.com');
    expect(sent[0].headers?.['X-SEAI-Event']).toBe('account.welcome');

    const deliveries = await listDeliveries({ event_name: 'account.welcome' });
    const mine = deliveries.filter((d) => d.recipient === 'aarav@example.com');
    expect(mine.some((d) => d.status === 'sent')).toBe(true);
    const events = await listEvents({ event_name: 'account.welcome' });
    expect(events.some((e) => e.customer_id === 'usr_1' && e.status === 'sent')).toBe(true);
  });

  it('never sends twice for a repeated dedupe key', async () => {
    const input = {
      eventName: 'change.received',
      template: 'change.received',
      to: 'dup@example.com',
      variables: previewContext({ request_id: 'req_dup', request_title: 'Update the hours' }),
      dedupeKey: 'test:change:req_dup',
    };
    const first = await dispatchEmail(input);
    const second = await dispatchEmail(input);
    expect(first.status).toBe('sent');
    expect(second.status).toBe('duplicate');
    expect(second.duplicateEventId).toBe(first.eventId);
    expect(sent).toHaveLength(1);
  });

  it('sends again for a different dedupe key', async () => {
    const base = {
      eventName: 'change.received',
      template: 'change.received',
      to: 'seq@example.com',
      variables: previewContext({ request_title: 'Update the hours' }),
    };
    await dispatchEmail({ ...base, dedupeKey: 'test:seq:1' });
    await dispatchEmail({ ...base, dedupeKey: 'test:seq:2' });
    expect(sent).toHaveLength(2);
  });

  it('bypasses dedupe when idempotent is false', async () => {
    const base = {
      eventName: 'account.welcome',
      template: 'account.welcome',
      to: 'repeat@example.com',
      variables: welcomeVars(),
    };
    const a = await dispatchEmail({ ...base, dedupeKey: 'test:repeat:key' });
    const b = await dispatchEmail({ ...base, dedupeKey: 'test:repeat:key', idempotent: false });
    expect(a.status).toBe('sent');
    expect(b.status).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('rejects an invalid recipient before claiming or sending', async () => {
    const result = await dispatchEmail({
      eventName: 'account.welcome',
      template: 'account.welcome',
      to: 'nope',
      variables: welcomeVars(),
      dedupeKey: 'test:invalid:1',
    });
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/invalid recipient/i);
    expect(sent).toHaveLength(0);
    const events = await listEvents({ event_name: 'account.welcome' });
    expect(events.filter((e) => e.dedupe_key === 'test:invalid:1')).toHaveLength(0);
  });

  it('records a failure when the provider throws', async () => {
    failNext = true;
    const failed = await dispatchEmail({
      eventName: 'payment.failed',
      template: 'payment.failed',
      to: 'pay-fail@example.com',
      variables: previewContext({ status: 'Failed' }),
      dedupeKey: 'test:provider-fail:1',
    });
    expect(failed.status).toBe('failed');
    expect(failed.reason).toMatch(/ECONNREFUSED|connect/i);
    const deliveries = await listDeliveries({ event_name: 'payment.failed', recipient: 'pay-fail@example.com' });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].error).toMatch(/ECONNREFUSED/);
    const events = await listEvents({ event_name: 'payment.failed' });
    expect(events.some((e) => e.dedupe_key === 'test:provider-fail:1' && e.status === 'failed')).toBe(true);
  });

  it('retries the same event after a provider failure instead of losing the email', async () => {
    failNext = true;
    const first = await dispatchEmail({
      eventName: 'maintenance.payment_required',
      template: 'maintenance.payment_required',
      to: 'retry@example.com',
      variables: previewContext({ status: 'Payment required' }),
      dedupeKey: 'test:retry:1',
    });
    expect(first.status).toBe('failed');
    expect(first.attempt).toBe(1);

    // The provider is healthy again; the same business event must still reach
    // the customer rather than being swallowed as a duplicate.
    const second = await dispatchEmail({
      eventName: 'maintenance.payment_required',
      template: 'maintenance.payment_required',
      to: 'retry@example.com',
      variables: previewContext({ status: 'Payment required' }),
      dedupeKey: 'test:retry:1',
    });
    expect(second.status).toBe('sent');
    expect(second.attempt).toBe(2);
    expect(second.eventId).toBe(first.eventId);

    const deliveries = await listDeliveries({ event_name: 'maintenance.payment_required', recipient: 'retry@example.com' });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.filter((d) => d.status === 'sent')).toHaveLength(1);
    expect(deliveries.filter((d) => d.status === 'failed')).toHaveLength(1);
  });

  it('does not send a third time once an event has been delivered', async () => {
    const third = await dispatchEmail({
      eventName: 'maintenance.payment_required',
      template: 'maintenance.payment_required',
      to: 'retry@example.com',
      variables: previewContext({ status: 'Payment required' }),
      dedupeKey: 'test:retry:1',
    });
    expect(third.status).toBe('duplicate');
    expect(third.duplicateEventId).toBeTruthy();
    const deliveries = await listDeliveries({ event_name: 'maintenance.payment_required', recipient: 'retry@example.com' });
    expect(deliveries).toHaveLength(2);
  });

  it('stops retrying after MAX_ATTEMPTS so a bad destination cannot loop forever', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      failNext = true;
      const attempt = await dispatchEmail({
        eventName: 'website.deployed',
        template: 'website.deployed',
        to: 'exhausted@example.com',
        variables: previewContext(),
        dedupeKey: 'test:exhausted:1',
      });
      expect(attempt.status).toBe('failed');
    }
    const blocked = await dispatchEmail({
      eventName: 'website.deployed',
      template: 'website.deployed',
      to: 'exhausted@example.com',
      variables: previewContext(),
      dedupeKey: 'test:exhausted:1',
    });
    expect(blocked.status).toBe('duplicate');
    const deliveries = await listDeliveries({ event_name: 'website.deployed', recipient: 'exhausted@example.com' });
    expect(deliveries).toHaveLength(MAX_ATTEMPTS);
  });

  it('fails a render error as a delivery without calling the provider', async () => {
    const result = await dispatchEmail({
      eventName: 'account.password_reset',
      template: 'account.password_reset',
      to: 'reset@example.com',
      variables: previewContext({ reset_url: '' }),
      dedupeKey: 'test:render-fail:1',
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/reset_url/);
    expect(sent).toHaveLength(0);
  });

  it('renders but does not send in dry-run mode', async () => {
    setMailDryRun(true);
    const result = await dispatchEmail({
      eventName: 'website.deployed',
      template: 'website.deployed',
      to: 'dry@example.com',
      variables: previewContext(),
      dedupeKey: 'test:dry:1',
    });
    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('dry-run');
    expect(sent).toHaveLength(0);
  });

  it('sends every message in a batch and reports each result', async () => {
    const results = await dispatchMany([
      { eventName: 'account.welcome', template: 'account.welcome', to: 'b1@example.com', variables: welcomeVars(), dedupeKey: 'test:batch:1' },
      { eventName: 'change.received', template: 'change.received', to: 'b2@example.com', variables: previewContext(), dedupeKey: 'test:batch:2' },
      { eventName: 'change.received', template: 'change.received', to: 'bad-address', variables: previewContext(), dedupeKey: 'test:batch:3' },
    ]);
    expect(results.map((r) => r.status)).toEqual(['sent', 'sent', 'skipped']);
    expect(sent).toHaveLength(2);
  });

  it('never leaks a reset token into the log line or the stored subject', async () => {
    const result = await dispatchEmail({
      eventName: 'account.password_reset',
      template: 'account.password_reset',
      to: 'token@example.com',
      variables: previewContext({ reset_url: 'https://dash.seai.store/reset-password?token=abc123secrettokenvalue' }),
      dedupeKey: 'test:token:1',
    });
    expect(result.status).toBe('sent');
    const deliveries = await listDeliveries({ event_name: 'account.password_reset' });
    expect(deliveries.every((d) => !JSON.stringify(d).includes('abc123secrettokenvalue'))).toBe(true);
  });
});
