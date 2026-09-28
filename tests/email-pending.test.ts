import { describe, it, expect, beforeEach } from 'vitest';
import { trackPendingMail, drainPendingMail, pendingMailCount } from '../src/mail/pending.js';

describe('serverless-safe background mail', () => {
  beforeEach(async () => {
    await drainPendingMail(2000);
  });

  it('reports no pending work when nothing is tracked', async () => {
    await drainPendingMail(500);
    expect(pendingMailCount()).toBe(0);
  });

  it('completes a tracked send before drain resolves', async () => {
    let done = false;
    trackPendingMail(async () => {
      await new Promise((r) => setTimeout(r, 30));
      done = true;
    });
    // The task must not be finished yet, but it is registered.
    expect(done).toBe(false);
    await drainPendingMail(2000);
    expect(done).toBe(true);
    expect(pendingMailCount()).toBe(0);
  });

  it('never rejects when a tracked send fails', async () => {
    trackPendingMail(async () => {
      throw new Error('smtp down');
    });
    await expect(drainPendingMail(2000)).resolves.toBeUndefined();
  });

  it('caps the wait instead of hanging past the budget', async () => {
    // Deliberately long: this task outlives the cap and is cleaned up after.
    const slow = trackPendingMail(() => new Promise((r) => setTimeout(r, 300)));
    const started = Date.now();
    await drainPendingMail(20);
    // The cap stops *waiting*; it deliberately does not cancel in-flight work.
    expect(Date.now() - started).toBeLessThan(2000);
    await slow;
    await drainPendingMail(2000);
  });

  it('drains a task that finishes inside the budget', async () => {
    let done = false;
    trackPendingMail(async () => {
      await new Promise((r) => setTimeout(r, 20));
      done = true;
    });
    await drainPendingMail(2000);
    expect(done).toBe(true);
    expect(pendingMailCount()).toBe(0);
  });

  it('drops a settled task from the pending set', async () => {
    trackPendingMail(async () => undefined);
    await drainPendingMail(2000);
    expect(pendingMailCount()).toBe(0);
  });
});
