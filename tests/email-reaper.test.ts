import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/db/db.js';
import { config } from '../src/config.js';
import { dispatchEmail, resetMailSender, isValidRecipient, setMailSender, setMailDryRun } from '../src/mail/dispatch.js';
import { reapStaleSends, describeReapResult } from '../src/mail/reaper.js';
import { listStaleSendEvents, claimStaleEvent, encodeReapableVariables, decodeReapableVariables, NOT_REAPABLE_TEMPLATES, STALE_SEND_MS, MAX_ATTEMPTS } from '../src/mail/store.js';
import { drainPendingMail } from '../src/mail/pending.js';

const RECIPIENT = 'reaper-test@example.invalid';

function sentEvents(name: string): Array<Record<string, unknown>> {
  return [];
}

async function resetMailTables(): Promise<void> {
  await db.deleteWhere('email_events', { recipient: RECIPIENT });
  await db.deleteWhere('email_deliveries', { recipient: RECIPIENT });
}

describe('K-56 stale-send reaper', () => {
  beforeEach(async () => {
    resetMailSender();
    setMailDryRun(true);
    await resetMailTables();
  });
  afterEach(async () => {
    resetMailSender();
    setMailDryRun(false);
    await resetMailTables();
  });

  describe('K-58 recipient validation', () => {
    it('rejects a NUL byte', () => {
      expect(isValidRecipient(`a${String.fromCharCode(0)}b@example.com`)).toBe(false);
    });
    it('rejects other control characters', () => {
      for (const code of [0x01, 0x07, 0x0b, 0x1b, 0x1f, 0x7f]) {
        expect(isValidRecipient(`a${String.fromCharCode(code)}b@example.com`)).toBe(false);
      }
    });
    it('still rejects CRLF and LF header injection', () => {
      expect(isValidRecipient('a@b.com\r\nBcc: v@evil.test')).toBe(false);
      expect(isValidRecipient('a@b.com\nBcc: v@evil.test')).toBe(false);
    });
    it('still rejects multi-recipient and malformed values', () => {
      expect(isValidRecipient('a@b.com,c@d.com')).toBe(false);
      expect(isValidRecipient('a@b.com d@e.com')).toBe(false);
      expect(isValidRecipient('"A" <a@b.com>')).toBe(false);
      expect(isValidRecipient('a@b')).toBe(false);
      expect(isValidRecipient('')).toBe(false);
    });
    it('accepts ordinary addresses including plus tags', () => {
      expect(isValidRecipient('a@b.com')).toBe(true);
      expect(isValidRecipient('a+tag@gmail.com')).toBe(true);
      expect(isValidRecipient('first.last@sub.example.co.uk')).toBe(true);
    });
  });

  describe('render-variable persistence', () => {
    it('encodes non-secret variables for reconstruction', () => {
      const json = encodeReapableVariables('change.received', { request_id: 'r1', request_title: 'T' });
      expect(json).toBeTruthy();
      expect(decodeReapableVariables(json)).toEqual({ request_id: 'r1', request_title: 'T' });
    });
    it('never persists token-bearing variables', () => {
      const json = encodeReapableVariables('account.welcome', {
        reset_url: 'https://dash.seai.store/reset-password?token=SECRET',
        token: 'SECRET',
        password: 'SECRET',
        customer_name: 'Real Name',
      });
      expect(json).not.toContain('SECRET');
      expect(decodeReapableVariables(json)).toEqual({ customer_name: 'Real Name' });
    });
    it('refuses to persist variables for token-bearing templates', () => {
      expect(NOT_REAPABLE_TEMPLATES.has('account.password_reset')).toBe(true);
      expect(encodeReapableVariables('account.password_reset', { reset_url: 'x' })).toBeNull();
    });
    it('tolerates undecodable stored JSON', () => {
      expect(decodeReapableVariables('{not json')).toEqual({});
      expect(decodeReapableVariables(null)).toEqual({});
    });
  });

  describe('stale detection', () => {
    it('ignores a fresh queued event', async () => {
      await dispatchEmail({
        eventName: 'change.received', template: 'change.received', to: RECIPIENT,
        variables: { request_id: 'fresh-1', request_title: 'Fresh' }, dedupeKey: 'fresh-1',
      });
      await drainPendingMail(2000);
      const stale = await listStaleSendEvents(50);
      expect(stale.find((e) => e.dedupe_key === 'fresh-1')).toBeUndefined();
    });

    it('finds a stale queued event', async () => {
      await seedStale('stale-queued', 'queued', { request_id: 'r', request_title: 'T' });
      const stale = await listStaleSendEvents(50);
      expect(stale.map((e) => e.dedupe_key)).toContain('stale-queued');
    });

    it('finds a stale sending event', async () => {
      await seedStale('stale-sending', 'sending', { request_id: 'r', request_title: 'T' });
      const stale = await listStaleSendEvents(50);
      expect(stale.map((e) => e.dedupe_key)).toContain('stale-sending');
    });

    it('never lists a sent event', async () => {
      await dispatchEmail({
        eventName: 'change.received', template: 'change.received', to: RECIPIENT,
        variables: { request_id: 'done-1', request_title: 'Done' }, dedupeKey: 'done-1',
      });
      await drainPendingMail(2000);
      await db.updateWhere('email_events', { dedupe_key: 'done-1' }, {
        updated_at: new Date(Date.now() - STALE_SEND_MS - 60_000).toISOString(),
      });
      const stale = await listStaleSendEvents(50);
      expect(stale.map((e) => e.dedupe_key)).not.toContain('done-1');
    });
  });

  describe('compare-and-set claim', () => {
    it('grants the claim to exactly one caller', async () => {
      await seedStale('cas-1', 'sending', { request_id: 'r', request_title: 'T' });
      const [a, b] = await Promise.all([listStaleSendEvents(50), listStaleSendEvents(50)]);
      const first = await claimStaleEvent(a.find((e) => e.dedupe_key === 'cas-1')!);
      const second = await claimStaleEvent(b.find((e) => e.dedupe_key === 'cas-1')!);
      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it('returns false once the row has moved on', async () => {
      await seedStale('cas-2', 'queued', { request_id: 'r', request_title: 'T' });
      const rows = await listStaleSendEvents(50);
      const ev = rows.find((e) => e.dedupe_key === 'cas-2')!;
      expect(await claimStaleEvent(ev)).toBe(true);
      expect(await claimStaleEvent(ev)).toBe(false);
    });
  });

  describe('recovery', () => {
    it('recovers a stale one-shot welcome email exactly once', async () => {
      await seedStale('welcome-orphan', 'sending', { customer_name: 'Real Name', dashboard_url: 'https://dash.seai.store/overview' }, 'account.welcome');
      const result = await reapStaleSends({ limit: 10 });
      expect(result.recovered).toContain('evt-welcome-orphan');
      await drainPendingMail(3000);
      const deliveries = await db.list('email_deliveries', { recipient: RECIPIENT }, 50);
      const welcome = deliveries.filter((d) => d.event_name === 'account.welcome');
      expect(welcome.filter((d) => d.status === 'sent')).toHaveLength(1);
    });

    it('recovers a stale change.received exactly once across two sweeps', async () => {
      await seedStale('change-orphan', 'queued', { request_id: 'r9', request_title: 'Fix hero' }, 'change.received');
      const first = await reapStaleSends({ limit: 10 });
      expect(first.recovered).toContain('evt-change-orphan');
      const second = await reapStaleSends({ limit: 10 });
      expect(second.recovered).not.toContain('evt-change-orphan');
      await drainPendingMail(3000);
      const deliveries = await db.list('email_deliveries', { recipient: RECIPIENT }, 50);
      expect(deliveries.filter((d) => d.event_name === 'change.received' && d.status === 'sent')).toHaveLength(1);
    });

    it('does not re-send an already-sent event even when marked stale', async () => {
      await dispatchEmail({
        eventName: 'change.received', template: 'change.received', to: RECIPIENT,
        variables: { request_id: 'sent-1', request_title: 'Sent' }, dedupeKey: 'sent-1',
      });
      await drainPendingMail(2000);
      // Force it back to a stale non-terminal state, as a freeze would.
      await db.updateWhere('email_events', { dedupe_key: 'sent-1' }, {
        status: 'sending', updated_at: new Date(Date.now() - STALE_SEND_MS - 60_000).toISOString(),
      });
      const before = (await db.list('email_deliveries', { recipient: RECIPIENT }, 50)).filter((d) => d.status === 'sent').length;
      await reapStaleSends({ limit: 10 });
      await drainPendingMail(3000);
      const after = (await db.list('email_deliveries', { recipient: RECIPIENT }, 50)).filter((d) => d.status === 'sent').length;
      expect(after).toBe(before);
    });

    it('skips a token-bearing template instead of re-rendering a secret', async () => {
      await seedStale('reset-orphan', 'sending', { reset_url: 'https://dash.seai.store/reset-password?token=SECRET' }, 'account.password_reset');
      const result = await reapStaleSends({ limit: 10 });
      expect(result.recovered).not.toContain('evt-reset-orphan');
      expect(result.skipped.find((s) => s.id === 'evt-reset-orphan')?.reason).toBe('template_not_reapable');
      await drainPendingMail(2000);
      const deliveries = await db.list('email_deliveries', { recipient: RECIPIENT }, 50);
      expect(deliveries).toHaveLength(0);
    });

    it('skips an event with no reconstructable variables', async () => {
      await seedStale('no-vars', 'queued', undefined, 'change.received');
      const result = await reapStaleSends({ limit: 10 });
      expect(result.skipped.find((s) => s.id === 'evt-no-vars')?.reason).toBe('no_stored_variables');
    });

    it('does not retry an event that exhausted its attempts', async () => {
      await seedStale('exhausted-1', 'sending', { request_id: 'r', request_title: 'T' }, 'change.received', MAX_ATTEMPTS);
      const result = await reapStaleSends({ limit: 10 });
      expect(result.exhausted).toContain('evt-exhausted-1');
      expect(result.recovered).not.toContain('evt-exhausted-1');
    });
  });

  describe('bounded sweep', () => {
    it('never processes more than the requested limit', async () => {
      for (let i = 0; i < 6; i += 1) {
        await seedStale(`bound-${i}`, 'queued', { request_id: `r${i}`, request_title: `T${i}` }, 'change.received');
      }
      const result = await reapStaleSends({ limit: 2 });
      expect(result.scanned).toBeLessThanOrEqual(2);
      expect(result.recovered.length + result.skipped.length + result.exhausted.length).toBeLessThanOrEqual(2);
    });

    it('clamps an absurd limit instead of trusting it', async () => {
      const result = await reapStaleSends({ limit: 100000 });
      expect(result.scanned).toBeLessThanOrEqual(200);
    });

    it('is safe to run when there is nothing to do', async () => {
      const result = await reapStaleSends({ limit: 10 });
      expect(result.scanned).toBe(0);
      expect(result.recovered).toHaveLength(0);
      expect(describeReapResult(result)).toContain('scanned=0');
    });
  });

  describe('no secret leakage in the sweep summary', () => {
    it('describes the result without addresses or variables', async () => {
      await seedStale('leak-check', 'sending', { customer_name: 'Jane' }, 'account.welcome');
      const result = await reapStaleSends({ limit: 5 });
      const line = describeReapResult(result);
      expect(line).not.toContain(RECIPIENT);
      expect(line).not.toContain('Jane');
      expect(JSON.stringify(result)).not.toContain(RECIPIENT);
    });
  });
});

/** Insert an event row that looks exactly like one orphaned by a serverless freeze. */
async function seedStale(
  dedupeKey: string,
  status: 'queued' | 'sending',
  variables: Record<string, unknown> | undefined,
  template = 'change.received',
  attempts = 1,
): Promise<void> {
  const stale = new Date(Date.now() - STALE_SEND_MS - 60_000).toISOString();
  await db.insert('email_events', {
    id: `evt-${dedupeKey}`,
    event_name: template,
    template,
    dedupe_key: dedupeKey,
    customer_id: null,
    recipient: RECIPIENT,
    status,
    attempts,
    correlation_id: null,
    variables: variables ? encodeReapableVariables(template, variables) : null,
    created_at: stale,
    updated_at: stale,
  });
}
