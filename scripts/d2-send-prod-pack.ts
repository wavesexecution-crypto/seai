// D2 production email verification harness.
//
// SAFETY MODEL
// - Uses the REAL production renderer (renderTemplate), REAL dispatch pipeline
//   (dispatchEmail: claim -> render -> scan -> SMTP -> record) and REAL SMTP.
// - The ONLY thing overridden is the recipient: every message is forced to the
//   QA inbox. Synthetic fixture data is used throughout; no real customer data.
// - Nothing here bypasses Razorpay verification or changes product logic.
//
// Usage: tsx scripts/d2-send-prod-pack.ts [qaInbox] [onlyCommaList]
const QA_INBOX = (process.argv[2] || 'waves.execution@gmail.com').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(QA_INBOX)) {
  throw new Error('QA inbox must be a valid address');
}

// Env is set BEFORE any import. config.ts reads process.env once at module
// load, so config and the mail module are imported dynamically — a static
// import would be hoisted above these assignments and freeze APP_URL=localhost
// into the delivered emails.
process.env.APP_URL = 'https://dash.seai.store';
process.env.PUBLIC_URL = 'https://seai.store';
process.env.SEI_MAIL_QA_RECIPIENT = QA_INBOX;
process.env.SEI_MAIL_EVENTS_ENABLED = 'true';
process.env.SEI_MAIL_ALLOW_DEV_URLS = 'false';

const { config } = await import('../src/config.js');
if (!/^https:\/\/dash\.seai\.store$/.test(config.appUrl)) {
  throw new Error(`Refusing to send with non-production APP_URL: ${config.appUrl}`);
}
const { db } = await import('../src/db/db.js');
const { dispatchEmail } = await import('../src/mail/dispatch.js');
const { PREVIEW_FIXTURES, previewContext } = await import('../src/mail/fixtures.js');
const { dashboardUrl, changeRequestUrl, websiteUrl, passwordResetUrl } = await import('../src/mail/urls.js');
const { listEvents, listDeliveries } = await import('../src/mail/store.js');

await db.init();

const RUN = `QA-${Date.now().toString(36).toUpperCase()}`;

// Synthetic QA identity, per the brief. No real customer data anywhere.
const QA = {
  customer_name: 'SEAI Production QA',
  email: QA_INBOX,
  website_name: 'SEAI QA Demo',
  domain: 'qa-demo.seai.store',
  plan_name: 'BUSINESS',
  amount: '₹4,999',
  order_total: '₹4,999',
  maintenance_price: '₹4,999',
  order_id: 'QA-EMAIL-TEST',
  payment_id: 'pay_QAEMAILTEST',
  receipt_id: 'rcpt_QAEMAILTEST',
  request_id: 'QA-EMAIL-TEST',
  request_title: 'QA: change the homepage hero image',
  request_page: 'Homepage',
  request_priority: 'important',
  purchased_at: '14 March 2026, 09:04',
  changed_at: '14 March 2026, 09:31',
  activated_at: '14 March 2026, 09:05',
  next_billing_date: '12 October 2026, 00:00',
  billing_date: '12 October 2026',
  billing_interval: 'month',
  stage: 'Layout and copy in production',
  refund_amount: '₹4,999',
  website_url: 'https://qa-demo.seai.store',
  support_email: config.mailSupportEmail,
};

// Password reset uses a synthetic, non-resolvable token. No real token is ever
// minted or transmitted by this harness.
const SYNTHETIC_RESET_TOKEN = 'QA-SYNTHETIC-TOKEN-NOT-A-REAL-RESET-TOKEN';

// Optional: only send a subset (comma-separated template names) so a re-run does
// not duplicate emails already delivered to the QA inbox.
const ONLY = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
const SELECTED = ONLY.length ? PREVIEW_FIXTURES.filter((f) => ONLY.includes(f.template)) : PREVIEW_FIXTURES;

function contextFor(fx: (typeof PREVIEW_FIXTURES)[number]) {
  // previewContext() is the repo's own realistic base (supplies request_status,
  // request_needed, stage, etc.). QA identity overrides only the customer facts.
  const base: Record<string, unknown> = {
    ...(previewContext() as Record<string, unknown>),
    ...QA,
    ...fx.context,
  };
  if (fx.template === 'account.welcome') base.dashboard_url = dashboardUrl('/overview');
  if (fx.template === 'account.password_reset') base.reset_url = passwordResetUrl(SYNTHETIC_RESET_TOKEN);
  if (fx.template.startsWith('change.')) base.request_url = changeRequestUrl(QA.request_id);
  if (fx.template === 'website.ready' || fx.template === 'website.domain_connected' || fx.template === 'website.deployed') {
    base.website_url = websiteUrl(QA.domain);
  }
  if (fx.template === 'report.performance') {
    base.alert_summary = 'Analytics: not connected in this environment (synthetic QA report).';
  }
  if (fx.template === 'account.new_sign_in_alert') base.alert_summary = 'New sign-in from a device not seen before (synthetic QA).';
  if (fx.template === 'sales.cold_outreach') {
    base.website_name = 'Green Leaf Cafe';
    base.alert_summary = 'there is no website, only an Instagram page with no menu, hours, or directions';
  }
  if (fx.template === 'website.status_alert') base.alert_summary = 'SSL certificate expires in 3 days (synthetic QA).';
  return base;
}

const results: { template: string; status: string; eventId: string; messageId: string; reason: string }[] = [];

console.log(`\n=== D2 PRODUCTION EMAIL PACK -> ${QA_INBOX} (run ${RUN}) ===`);

for (const fx of SELECTED) {
  const res = await dispatchEmail({
    eventName: fx.template,
    template: fx.template,
    to: QA_INBOX,
    variables: contextFor(fx) as never,
    customerId: null,
    dedupeParts: [RUN, fx.name],
  });
  results.push({
    template: fx.template,
    status: res.status,
    eventId: res.eventId ?? '',
    messageId: (res as { messageId?: string }).messageId ?? '',
    reason: (res as { reason?: string }).reason ?? '',
  });
  console.log(`${res.status.toUpperCase().padEnd(9)} ${fx.template}`);
  if (res.status !== 'sent') console.log(`          reason: ${(res as { reason?: string }).reason ?? 'n/a'}`);
}

const sent = results.filter((r) => r.status === 'sent').length;
const other = results.filter((r) => r.status !== 'sent');
console.log(`\nSUMMARY: ${sent}/${results.length} sent, ${other.length} not sent`);
for (const r of other) console.log(`  ${r.status} ${r.template}: ${r.reason}`);

// ---- Step 10: idempotency proof on the real store ----
console.log('\n=== IDEMPOTENCY (real dedupe) ===');
const dupKey = [RUN, 'dup-proof'];
const first = await dispatchEmail({
  eventName: 'account.welcome', template: 'account.welcome', to: QA_INBOX,
  variables: { ...QA, dashboard_url: dashboardUrl('/overview') } as never, dedupeParts: dupKey,
});
const second = await dispatchEmail({
  eventName: 'account.welcome', template: 'account.welcome', to: QA_INBOX,
  variables: { ...QA, dashboard_url: dashboardUrl('/overview') } as never, dedupeParts: dupKey,
});
console.log(`first=${first.status} second=${second.status} (expect sent then duplicate)`);

// ---- Confirm DB records ----
const events = await listEvents({ limit: 200 });
const deliveries = await listDeliveries({ limit: 200 });
const mine = deliveries.filter((d) => (d.to || '').toLowerCase() === QA_INBOX);
console.log(`\n=== DB RECORDS ===\nevents=${events.length} deliveries=${deliveries.length} toQA=${mine.length}`);
const withMsg = mine.filter((d) => Boolean(d.message_id)).length;
console.log(`deliveries_with_message_id=${withMsg}`);
const statuses = mine.reduce<Record<string, number>>((a, d) => { a[String(d.status)] = (a[String(d.status)] ?? 0) + 1; return a; }, {});
console.log(`delivery_statuses=${JSON.stringify(statuses)}`);

// ---- Confirm no real recipient leaked into this run ----
const leaked = mine.filter((d) => (d.to || '').toLowerCase() !== QA_INBOX);
console.log(`non_QA_recipients_this_run=${leaked.length}`);

await db.close();
console.log('\n=== PACK COMPLETE ===');
