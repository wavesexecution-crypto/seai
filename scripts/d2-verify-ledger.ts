// D2 delivery-ledger verification: proves what the production DB recorded for
// the QA pack. Read-only. No secrets are printed.
import { db } from '../src/db/db.js';
const { listDeliveries, listEvents } = await import('../src/mail/store.js');
const QA = 'waves.execution@gmail.com';
await db.init();

const deliveries = await listDeliveries({ limit: 500 });
const events = await listEvents({ limit: 500 });
const mine = deliveries.filter((d) => String(d.recipient).toLowerCase() === QA);

const byTemplate = new Map<string, { sent: number; failed: number; ids: string[] }>();
for (const d of mine) {
  const k = d.template;
  const e = byTemplate.get(k) ?? { sent: 0, failed: 0, ids: [] };
  if (d.status === 'sent') { e.sent++; if (d.provider_message_id) e.ids.push(d.provider_message_id); }
  else e.failed++;
  byTemplate.set(k, e);
}

console.log(`deliveries_total=${deliveries.length} to_QA=${mine.length} distinct_templates=${byTemplate.size}`);
const withId = mine.filter((d) => Boolean(d.provider_message_id)).length;
const failed = mine.filter((d) => d.status !== 'sent');
console.log(`with_provider_message_id=${withId} not_sent=${failed.length}`);
for (const d of failed) console.log(`  NOT_SENT ${d.template} status=${d.status} err=${String(d.error).slice(0, 90)}`);

const anyRecipient = new Set(mine.map((d) => String(d.recipient).toLowerCase()));
console.log(`recipients_this_pack=${[...anyRecipient].join(',')}`);

const subjects = mine.filter((d) => d.status === 'sent').map((d) => `${d.template} :: ${d.subject}`);
console.log('\n=== SENT (template :: subject) ===');
for (const s of subjects.sort()) console.log('  ' + s);

// Secret-shaped leakage check across the recorded ledger.
const blob = JSON.stringify(mine);
const leaks = [
  ['smtp/app password', /irsjytqfzvedxgdd/i],
  ['nvapi key', /nvapi-[A-Za-z0-9_-]{20,}/],
  ['neon url', /neondb_owner|postgresql:\/\//i],
  ['bearer', /Bearer\s+[A-Za-z0-9._-]{16,}/],
];
for (const [label, re] of leaks) console.log(`LEAKCHECK ${label}=${re.test(blob) ? 'FOUND' : 'clean'}`);

const evStatuses = events.reduce<Record<string, number>>((a, e) => { a[String(e.status)] = (a[String(e.status)] ?? 0) + 1; return a; }, {});
console.log(`event_statuses=${JSON.stringify(evStatuses)}`);
await db.close();
