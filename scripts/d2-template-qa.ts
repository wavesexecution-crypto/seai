// D2 template content QA. Renders every production template in memory (no send)
// and scans the output for the defects the brief lists.
//
// Env MUST be set before config.ts is evaluated. config.ts reads process.env
// once at module load, so it is imported dynamically below (a static import
// would be hoisted above these assignments and freeze the wrong APP_URL).
process.env.APP_URL = 'https://dash.seai.store';
process.env.PUBLIC_URL = 'https://seai.store';
process.env.SEI_MAIL_QA_RECIPIENT = 'waves.execution@gmail.com';
process.env.SEI_MAIL_ALLOW_DEV_URLS = 'false';

const { config } = await import('../src/config.js');
if (!/^https:\/\/dash\.seai\.store$/.test(config.appUrl)) {
  throw new Error(`Refusing to QA with non-production APP_URL: ${config.appUrl}`);
}
const { TEMPLATES, renderTemplate } = await import('../src/mail/registry.js');
const { PREVIEW_FIXTURES, previewContext } = await import('../src/mail/fixtures.js');
const { dashboardUrl, changeRequestUrl, websiteUrl, passwordResetUrl } = await import('../src/mail/urls.js');
// Per-template fixture context (supplies required `status` and friends).
const byTemplate = new Map(PREVIEW_FIXTURES.map((f) => [f.template, f]));

const QA = {
  customer_name: 'SEAI Production QA', email: 'waves.execution@gmail.com',
  website_name: 'SEAI QA Demo', domain: 'qa-demo.seai.store',
  plan_name: 'BUSINESS', amount: '₹4,999', order_total: '₹4,999',
  maintenance_price: '₹4,999', order_id: 'QA-EMAIL-TEST', payment_id: 'pay_QAEMAILTEST',
  receipt_id: 'rcpt_QAEMAILTEST', request_id: 'QA-EMAIL-TEST',
  request_title: 'QA: change the homepage hero image', request_page: 'Homepage',
  purchased_at: '14 March 2026, 09:04', changed_at: '14 March 2026, 09:31',
  activated_at: '14 March 2026, 09:05', next_billing_date: '12 October 2026, 00:00',
  billing_date: '12 October 2026', refund_amount: '₹4,999',
  website_url: 'https://qa-demo.seai.store',
};

const checks: [string, RegExp][] = [
  ['localhost', /localhost/i],
  ['private-ip', /\b(127\.0\.0\.1|10\.\d|192\.168\.\d)/],
  ['vercel-preview', /\.vercel\.app/i],
  ['other-preview', /\.(now\.sh|ngrok\.io|trycloudflare\.com)/i],
  ['unresolved-var', /\{\{[^}]+\}\}/],
  ['undefined', /\bundefined\b/],
  ['null-literal', />\s*null\s*<|\bnull\s*\|\s/],
  ['NaN', /\bNaN\b/],
  ['debug-text', /\b(console\.log|DEBUG|TODO|FIXME|localhost:)\b/i],
  ['internal-path', /\/api\/(?!auth)/i],
  ['jwt-like', /\beyJ[A-Za-z0-9_-]{10,}/],
  ['nvapi-key', /nvapi-[A-Za-z0-9_-]{20,}/],
  ['app-password', /\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/],
  ['placeholder-brackets', /\[(business|customer|name|domain|amount)[^\]]*\]/i],
  ['order-internal-id', /\bord_[0-9a-f]{8}/i],
];

let bad = 0;
const rows: string[] = [];
for (const t of TEMPLATES) {
  const fx = byTemplate.get(t.name);
  const ctx: Record<string, unknown> = {
    ...(previewContext() as Record<string, unknown>), ...QA,
    ...((fx?.context ?? {}) as Record<string, unknown>),
    dashboard_url: dashboardUrl('/overview'),
    reset_url: passwordResetUrl('QA-SYNTHETIC-TOKEN-NOT-REAL'),
    request_url: changeRequestUrl(QA.request_id as string),
    website_url: websiteUrl(QA.domain as string),
  };
  let r;
  try { r = renderTemplate(t.name, ctx as never); }
  catch (e) { rows.push(`${t.name} RENDER_FAIL ${(e as Error).message}`); bad++; continue; }

  const hay = `${r.html}\n${r.text}\n${r.subject}`;
  const hits: string[] = [];
  for (const [label, re] of checks) if (re.test(hay)) hits.push(label);

  // Structural / a11y / mobile sanity checks.
  if (!/^\s*<!doctype html>/i.test(r.html)) hits.push('no-doctype');
  if (!/<meta name="viewport"/i.test(r.html)) hits.push('no-viewport');
  if (!/<style[\s>]/i.test(r.html)) hits.push('no-mobile-style');
  if (!/@media/i.test(r.html)) hits.push('no-media-query');
  if (!r.text.trim()) hits.push('no-text-fallback');
  if (/<table/i.test(r.html) && !/role="presentation"/.test(r.html)) hits.push('table-no-presentation-role');
  if (hits.length) { bad++; rows.push(`${t.name} FLAGS=${hits.join(',')}`); }
  else rows.push(`${t.name} OK subj="${r.subject}" html=${r.html.length}b text=${r.text.length}b`);
}
console.log(`templates=${TEMPLATES.length} issues=${bad}`);
for (const line of rows) console.log('  ' + line);

// URLs actually present in the whole pack
const urls = new Set<string>();
for (const t of TEMPLATES) {
  try {
    const fx = byTemplate.get(t.name);
    const r = renderTemplate(t.name, { ...(previewContext() as Record<string, unknown>), ...QA,
      ...((fx?.context ?? {}) as Record<string, unknown>),
      dashboard_url: dashboardUrl('/overview'), reset_url: passwordResetUrl('QA-SYNTHETIC-NOT-REAL'),
      request_url: changeRequestUrl('QA-EMAIL-TEST'), website_url: websiteUrl('qa-demo.seai.store') } as never);
    for (const m of (r.html + r.text).matchAll(/https?:\/\/[^\s"'<>)]+/g)) urls.add(m[0].replace(/[,.;]+$/, ''));
  } catch { /* counted above */ }
}
console.log('\n=== URLS IN PACK ===');
for (const u of [...urls].sort()) console.log('  ' + u);
console.log(`\nsender_from="${config.mailFromName}" <${config.mailFrom}>`);
console.log(`app_url=${config.appUrl} public_url=${config.publicUrl} logo=${config.mailLogoUrl}`);
