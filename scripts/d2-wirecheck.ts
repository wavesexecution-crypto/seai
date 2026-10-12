process.env.APP_URL = 'https://dash.seai.store';
process.env.PUBLIC_URL = 'https://seai.store';
process.env.SEI_MAIL_QA_RECIPIENT = 'waves.execution@gmail.com';
const { TEMPLATES, renderTemplate } = await import('../src/mail/registry.js');
const { PREVIEW_FIXTURES, previewContext } = await import('../src/mail/fixtures.js');
const { dashboardUrl, changeRequestUrl, websiteUrl, passwordResetUrl } = await import('../src/mail/urls.js');
const byTemplate = new Map(PREVIEW_FIXTURES.map((f) => [f.template, f]));

console.log('=== WIRED INVENTORY ===');
for (const t of TEMPLATES) {
  console.log(`${t.wired ? 'WIRED    ' : 'UNWIRED  '}${t.name}`);
}

console.log('\n=== EXACT placeholder-brackets match (domain_connected) ===');
const fx = byTemplate.get('website.domain_connected');
const r = renderTemplate('website.domain_connected', {
  ...(previewContext() as Record<string, unknown>), domain: 'qa-demo.seai.store',
  website_url: 'https://qa-demo.seai.store/', status: 'Connected',
  ...((fx?.context ?? {}) as Record<string, unknown>),
} as never);
const re = /\[(business|customer|name|domain|amount)[^\]]*\]/i;
const m = re.exec(r.html);
console.log(m ? `MATCH="${m[0]}"` : 'no match in html');
const ctx2 = re.exec(r.text);
console.log(ctx2 ? `MATCH_TEXT="${ctx2[0]}"` : 'no match in text');
if (m) {
  const i = m.index;
  console.log('CONTEXT=' + r.html.slice(Math.max(0, i - 120), i + 60).replace(/\s+/g, ' '));
}
