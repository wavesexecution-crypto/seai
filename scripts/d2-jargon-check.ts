process.env.APP_URL = 'https://dash.seai.store';
process.env.PUBLIC_URL = 'https://seai.store';
process.env.SEI_MAIL_QA_RECIPIENT = 'waves.execution@gmail.com';
const { TEMPLATES, renderTemplate } = await import('../src/mail/registry.js');
const { PREVIEW_FIXTURES, previewContext } = await import('../src/mail/fixtures.js');
const { dashboardUrl, changeRequestUrl, websiteUrl, passwordResetUrl } = await import('../src/mail/urls.js');
const byTemplate = new Map(PREVIEW_FIXTURES.map((f) => [f.template, f]));

const JARGON = [
  'webhook', 'event id', 'relay', 'smtp', 'api', 'endpoint', 'callback', 'idempot',
  'hmac', 'cdf', 'storage object', 'tenant', 'state machine', 'pipeline', 'infrastructure',
  'queued', 'processed', 'service message', 'this is a service', 'internal',
  'deployment id', 'request id', 'payment id', 'order id', 'intake record', 'authoritative',
  'maintenance is active only once', 'no action needed right now',
];
let imgTags = 0;
let hits = 0;
for (const t of TEMPLATES) {
  const fx = byTemplate.get(t.name);
  const r = renderTemplate(t.name, {
    ...(previewContext() as Record<string, unknown>), website_name: 'SEAI QA Demo', domain: 'qa-demo.seai.store',
    ...QA(), ...((fx?.context ?? {}) as Record<string, unknown>),
  } as never);
  const imgs = (r.html.match(/<img\b/gi) || []).length;
  imgTags += imgs;
  const body = `${r.subject}\n${r.text}`.toLowerCase();
  const found = JARGON.filter((j) => body.includes(j));
  // request id only appears as a URL query value (needed for deep link)
  const real = found.filter((j) => !(j === 'request id' && /modify\?id=/.test(r.text)));
  if (imgs || real.length) {
    hits++;
    console.log(`${t.name} imgs=${imgs} jargon=${real.join('|') || 'none'}`);
  }
}
console.log(`\ntotal_img_tags=${imgTags} (0 = no broken-image risk) templates_with_flags=${hits}`);

function QA() {
  return {
    customer_name: 'SEAI Production QA', email: 'waves.execution@gmail.com',
    plan_name: 'BUSINESS', amount: '₹4,999', order_total: '₹4,999', maintenance_price: '₹4,999',
    order_id: 'QA-EMAIL-TEST', payment_id: 'pay_QAEMAILTEST', receipt_id: 'rcpt_QAEMAILTEST',
    request_id: 'QA-EMAIL-TEST', request_title: 'QA: change the homepage hero image',
    request_page: 'Homepage', website_url: 'https://qa-demo.seai.store',
    status: 'Successful', purchased_at: '14 March 2026, 09:04', changed_at: '14 March 2026, 09:31',
    activated_at: '14 March 2026, 09:05', next_billing_date: '12 October 2026', billing_date: '12 October 2026',
    billing_interval: 'month', refund_amount: '₹4,999', request_needed: 'Approve the new opening hours.',
  };
}
