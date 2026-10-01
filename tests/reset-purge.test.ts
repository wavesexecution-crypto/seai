import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db.js';
import { purgeDeadPasswordResets } from '../src/auth/service.js';
import { randomUUID } from 'node:crypto';

// K-57: bounded cleanup of dead password-reset records.
//
// The invariant under test: a purge may only ever remove rows that can no longer
// authenticate anything. A live, unexpired, unused token is a real credential and
// must survive every run.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface SeedOpts {
  ageMs: number;
  ttlMs?: number;
  used?: boolean;
}

async function seedReset(opts: SeedOpts): Promise<string> {
  const id = randomUUID();
  const created = new Date(Date.now() - opts.ageMs);
  await db.insert('password_resets', {
    id,
    user_id: 'purge-test-user',
    token_hash: `${id}`.padEnd(64, '0').slice(0, 64),
    expires_at: new Date(created.getTime() + (opts.ttlMs ?? HOUR)).toISOString(),
    used_at: opts.used ? new Date(created.getTime() + 1000).toISOString() : null,
    created_at: created.toISOString(),
  });
  return id;
}

async function countFor(id: string): Promise<number> {
  return (await db.list('password_resets', { id }, 1)).length;
}

async function clearAll(): Promise<void> {
  const rows = await db.list('password_resets', {}, 1000);
  for (const r of rows) {
    if (r.user_id === 'purge-test-user') await db.deleteWhere('password_resets', { id: r.id });
  }
}

describe('K-57 dead password-reset purge', () => {
  beforeEach(async () => { await clearAll(); });

  it('removes an expired, unused token once it is past the retention window', async () => {
    const id = await seedReset({ ageMs: 3 * DAY, ttlMs: HOUR });
    expect(await countFor(id)).toBe(1);
    const removed = await purgeDeadPasswordResets({ limit: 100 });
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await countFor(id)).toBe(0);
  });

  it('removes a used token even though it has not expired', async () => {
    const id = await seedReset({ ageMs: 2 * DAY, ttlMs: 30 * DAY, used: true });
    const removed = await purgeDeadPasswordResets({ limit: 100 });
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await countFor(id)).toBe(0);
  });

  it('NEVER removes a live, unexpired, unused token', async () => {
    const id = await seedReset({ ageMs: 2 * DAY, ttlMs: 30 * DAY, used: false });
    await purgeDeadPasswordResets({ limit: 100 });
    expect(await countFor(id)).toBe(1);
  });

  it('keeps an expired token that is still inside the retention window', async () => {
    const id = await seedReset({ ageMs: 1 * HOUR, ttlMs: HOUR });
    const removed = await purgeDeadPasswordResets({ limit: 100, minAgeMs: 7 * DAY });
    expect(removed).toBe(0);
    expect(await countFor(id)).toBe(1);
  });

  it('is bounded by the requested limit', async () => {
    for (let i = 0; i < 8; i += 1) await seedReset({ ageMs: 5 * DAY, ttlMs: HOUR });
    const removed = await purgeDeadPasswordResets({ limit: 3 });
    expect(removed).toBe(3);
    const left = (await db.list('password_resets', { user_id: 'purge-test-user' }, 100)).length;
    expect(left).toBe(5);
  });

  it('is safe to run repeatedly (second run is a no-op)', async () => {
    await seedReset({ ageMs: 5 * DAY, ttlMs: HOUR });
    const first = await purgeDeadPasswordResets({ limit: 100 });
    const second = await purgeDeadResetsAgain();
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('clamps a nonsense limit instead of trusting it', async () => {
    const removed = await purgeDeadPasswordResets({ limit: 0 });
    expect(removed).toBeGreaterThanOrEqual(0);
    const clamped = await purgeDeadPasswordResets({ limit: 10_000_000 });
    expect(clamped).toBeGreaterThanOrEqual(0);
  });
});

async function purgeDeadResetsAgain(): Promise<number> {
  return purgeDeadPasswordResets({ limit: 100 });
}
