import { TEMPLATES } from '../src/mail/registry.js';
import { listSlots } from '../src/stores/registry.js';

const rows = TEMPLATES.map((t) => ({
  name: t.name,
  subject: t.subject,
  preheader: (t.preheader || '').slice(0, 60),
  required: (t.required || []).join(','),
}));
console.log('=== TEMPLATES (' + rows.length + ') ===');
for (const r of rows) {
  console.log([r.name, r.subject, r.required].join(' | '));
}
void listSlots;
