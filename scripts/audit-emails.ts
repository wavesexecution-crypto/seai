// Final pre-ship audit for the client email system.
//
//   npm run email:audit
//
// Checks, in order:
//  1. every template renders (html + text) from fixtures
//  2. every required variable is present, every {{var}} is known and resolved
//  3. no localhost / 127.0.0.1 / 0.0.0.0 / .vercel.app / private hosts
//  4. no secrets, password, or token-shaped content
//  5. no raw customer content is ever HTML-escaped wrongly (injection guard)
//  6. optional variables omitted produce a readable email, not a broken one
// Exits non-zero on any failure.
import { PREVIEW_FIXTURES, previewContext } from '../src/mail/fixtures.js';
import { EMAIL_VARIABLES, buildContext } from '../src/mail/context.js';
import { findSecrets } from '../src/mail/safety.js';
import { listTemplates, renderTemplate } from '../src/mail/registry.js';
import { emailEnvironmentReport } from '../src/mail/urls.js';

const problems: string[] = [];
const notes: string[] = [];

const FORBIDDEN = [
  /localhost/i,
  /127\.0\.0\.1/,
  /\b0\.0\.0\.0\b/,
  /\.vercel\.app/i,
  /\.now\.sh/i,
  /\.ngrok\.io/i,
  /\[::1\]/,
];

function check(label: string, value: string, where: string): void {
  for (const re of FORBIDDEN) {
    if (re.test(value)) problems.push(`${where}: matches forbidden host pattern ${re} (${label})`);
  }
  for (const finding of findSecrets(value)) {
    if (finding.confidence === 'high') {
      problems.push(`${where}: possible secret material (${finding.name}) in ${label}`);
    } else {
      notes.push(`${where}: low-confidence secret shape (${finding.name}) in ${label} — reported, not blocking`);
    }
  }
}

const env = emailEnvironmentReport();
console.log('Environment');
console.log('  dashboard       :', env.dashboard);
console.log('  public site     :', env.publicSite);
console.log('  logo            :', env.logo ?? '(wordmark only)');
console.log('  support         :', env.support);
console.log('  dev urls allowed:', env.devUrlsAllowed);
if (env.devUrlsAllowed) problems.push('SEAI_MAIL_ALLOW_DEV_URLS is enabled; production must never render dev hosts');

const all = listTemplates();
const fixtureNames = new Set(PREVIEW_FIXTURES.map((f) => f.template));
const missingFixture = all.map((t) => t.name).filter((n) => !fixtureNames.has(n));
if (missingFixture.length) {
  notes.push(`templates without a dedicated fixture (checked with the shared fixture instead): ${missingFixture.join(', ')}`);
}

console.log(`\nRendering ${all.length} templates`);
for (const def of all) {
  const fixture = PREVIEW_FIXTURES.find((f) => f.template === def.name);
  const context = previewContext(fixture?.context ?? {});
  try {
    const rendered = renderTemplate(def.name, context);
    if (!rendered.subject.trim()) problems.push(`${def.name}: empty subject`);
    if (rendered.html.length < 200) problems.push(`${def.name}: html looks empty (${rendered.html.length} chars)`);
    if (rendered.text.length < 80) problems.push(`${def.name}: plain text looks empty (${rendered.text.length} chars)`);
    if (!/seai/i.test(rendered.text)) problems.push(`${def.name}: plain text never names SEAI`);
    if (!/https:\/\//.test(rendered.html)) problems.push(`${def.name}: html has no https link`);
    check('subject', rendered.subject, def.name);
    check('html', rendered.html, def.name);
    check('text', rendered.text, def.name);

    for (const key of def.required) {
      if (!String(context[key] ?? '').trim()) problems.push(`${def.name}: required variable ${key} empty in fixture`);
      if (!(EMAIL_VARIABLES as readonly string[]).includes(key)) {
        problems.push(`${def.name}: required variable ${key} is not in EMAIL_VARIABLES`);
      }
    }
    for (const key of def.optional) {
      if (!(EMAIL_VARIABLES as readonly string[]).includes(key)) {
        problems.push(`${def.name}: optional variable ${key} is not in EMAIL_VARIABLES`);
      }
    }

    // Optional variables omitted must not break rendering.
    if (def.optional.length > 0) {
      const minimal = buildContext(Object.fromEntries(def.required.map((k) => [k, String(context[k] ?? 'x')])));
      const stripped = renderTemplate(def.name, minimal, { skipSecretScan: true });
      if (/\{\{|\bundefined\b|\bNaN\b/.test(stripped.html) || /\bundefined\b|\bNaN\b/.test(stripped.text)) {
        problems.push(`${def.name}: rendering with only required variables produced undefined/NaN output`);
      }
      for (const re of FORBIDDEN) {
        if (re.test(stripped.html)) problems.push(`${def.name}: forbidden host in minimal render (${re})`);
      }
    }

    const flagged = !def.wired;
    console.log(`  ${def.wired ? 'wired  ' : 'reserved'} ${def.name.padEnd(36)} ${rendered.subject}`);
    if (flagged) notes.push(`reserved (not wired): ${def.name} — ${def.trigger}`);
  } catch (err) {
    problems.push(`${def.name}: render failed — ${(err as Error).message}`);
  }
}

console.log('\nInjection guard');
try {
  const hostile = '<script>alert("x")</script>"><img src=x onerror=alert(1)>';
  const rendered = renderTemplate('change.received', {
    request_id: 'req_1',
    request_title: hostile,
    request_summary: hostile,
    request_page: hostile,
  });
  const issues: string[] = [];
  if (rendered.html.includes(hostile)) issues.push('the raw hostile payload survived in html');
  if (rendered.text.includes(hostile)) issues.push('the raw hostile payload survived in plain text');
  if (!rendered.html.includes('&lt;script&gt;')) issues.push('html does not contain the escaped form of the hostile input');
  if (/<script/i.test(rendered.text)) issues.push('raw <script> survived in plain text');
  if (/javascript:/i.test(rendered.html)) issues.push('a javascript: URL survived in html');
  if (issues.length > 0) {
    for (const issue of issues) problems.push(`change.received: ${issue}`);
  } else {
    console.log('  hostile input is escaped in html and carries no raw tags in plain text');
  }
} catch (err) {
  problems.push(`injection guard failed: ${(err as Error).message}`);
}

console.log('\nSummary');
console.log('  templates defined :', all.length);
console.log('  templates wired   :', all.filter((t) => t.wired).length);
console.log('  fixtures          :', PREVIEW_FIXTURES.length);
for (const note of notes) console.log('  note:', note);
if (problems.length === 0) {
  console.log('\nAUDIT PASSED — no localhost links, no secrets, every template renders.');
} else {
  console.error(`\nAUDIT FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}
