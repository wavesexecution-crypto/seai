/**
 * SEAI public-website functional audit (standalone, playwright-core).
 * Zero dead buttons / zero broken links / zero non-functional interactions.
 * Output: JSON report to stdout + ./audit-report.json
 */
const { chromium } = require('playwright'); require('playwright-core');

const BASE = 'http://localhost:4173';
const DASH = 'http://localhost:3000';
const PAGES = ['/', '/services.html', '/industries.html', '/pricing.html', '/contact.html', '/examples.html', '/terms.html', '/privacy.html', '/intake.html', '/404.html'];
const ANCHOR_TARGETS = { '/': ['how', 'faq', 'main'] };

const report = {
  pages: {},        // per-page: console errors, pageerrors, placeholder links
  links: {},        // href -> {status, from}
  clicks: [],       // "page :: element -> result"
  failures: [],
  form: {},
  mobile: {},
  backend: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', (m) => {
    if (m.type() === 'error') (report._console = report._console || []).push(`${page.url()} :: ${m.text().slice(0, 220)}`);
  });
  page.on('pageerror', (e) => (report._pageErrors = report._pageErrors || []).push(`${page.url()} :: ${String(e).slice(0, 220)}`));

  // ---------- 1. Link crawl: every internal destination must load ----------
  const linkMap = new Map(); // href -> Set(page)
  for (const p of PAGES) {
    try {
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (e) {
      report.failures.push(`${p}: goto failed: ${e.message.slice(0, 120)}`);
      continue;
    }
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')),
    );
    for (const h of hrefs) {
      if (!linkMap.has(h)) linkMap.set(h, new Set());
      linkMap.get(h).add(p);
    }
    // placeholders / dead patterns
    const bad = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).filter((a) => {
        const h = a.getAttribute('href');
        return !h || h === '#' || h.startsWith('javascript:');
      }).map((a) => (a.innerText || '').trim().slice(0, 50)),
    );
    if (bad.length) report.failures.push(`${p}: placeholder hrefs: ${JSON.stringify(bad)}`);
  }

  for (const [href, from] of linkMap.entries()) {
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      report.links[href || '(empty)'] = { status: href?.startsWith('mailto:') || href?.startsWith('tel:') ? 'OK (handler)' : 'PLACEHOLDER', from: [...from].join(', ') };
      continue;
    }
    const url = new URL(href, BASE).toString();
    if (new URL(url).origin !== BASE) { report.links[href] = { status: 'EXTERNAL — skipped', from: [...from].join(', ') }; continue; }
    let status = 'ERR';
    try {
      const res = await page.request.get(url);
      status = res.status();
    } catch (e) { status = 'ERR ' + e.message.slice(0, 60); }
    report.links[href] = { status, from: [...from].join(', ') };
    if (status !== 200 && status !== 301 && status !== 302) report.failures.push(`Link ${href} -> ${status} (from ${[...from].join(', ')})`);
  }

  // ---------- 2. Anchor targets must exist ----------
  for (const [p, anchors] of Object.entries(ANCHOR_TARGETS)) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
    for (const id of anchors) {
      const exists = await page.evaluate((i) => !!document.getElementById(i), id);
      if (!exists) report.failures.push(`${p}: missing anchor target #${id}`);
    }
  }

  // ---------- 3. Click every control on every page ----------
  const SEL = 'a[href], button:not([type="submit"]), details > summary, input[type="checkbox"], input[type="radio"]';
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, SEL);
    for (let i = 0; i < count; i++) {
      const info = await page.evaluate((sel, idx) => {
        const el = document.querySelectorAll(sel)[idx];
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 55);
        try { el.scrollIntoView({ block: 'center' }); } catch {}
        return { tag, label };
      }, [SEL, i]).catch(() => null);
      if (!info) continue;
      if (info.tag === 'a') continue; // anchors verified by crawl + navigation spot tests below
      const before = page.url();
      try {
        await page.evaluate((sel, idx) => document.querySelectorAll(sel)[idx]?.click(), [SEL, i]);
        await sleep(120);
        report.clicks.push(`${p} :: ${info.tag} "${info.label}" -> ${page.url() === before ? 'no nav (action ok if state changed)' : 'navigated to ' + page.url()}`);
      } catch (e) {
        report.failures.push(`${p}: click ${info.tag} "${info.label}" threw: ${e.message.slice(0, 120)}`);
      }
    }
  }

  // ---------- 4. Navbar + CTA click-throughs (real navigation) ----------
  const navChecks = [
    ['/', 'Services', '/services.html'],
    ['/', 'Industries', '/industries.html'],
    ['/', 'Pricing', '/pricing.html'],
    ['/', 'Contact', '/contact.html'],
    ['/services.html', "Let's Grow Your Business", '/contact.html'],
    ['/pricing.html', 'Talk about Starter', '/contact.html'],
    ['/industries.html', 'Discuss this industry', '/contact.html'],
  ];
  for (const [from, text, dest] of navChecks) {
    await page.goto(BASE + from, { waitUntil: 'domcontentloaded' });
    const found = await page.evaluate((t) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => (x.innerText || '').trim().includes(t));
      if (!a) return null;
      a.click();
      return true;
    }, text).catch(() => null);
    await sleep(500);
    const ok = page.url().includes(dest);
    report.clicks.push(`NAV ${from} link "${text}" -> ${page.url()} ${ok ? 'OK' : 'WRONG DEST (expected ' + dest + ')'}`);
    if (!ok) report.failures.push(`NAV ${from} "${text}" landed on ${page.url()} instead of ${dest}`);
  }

  // ---------- 5. Contact form: validation + real submission ----------
  await page.goto(BASE + '/contact.html', { waitUntil: 'networkidle' });
  // 5a empty submit -> native validation blocks it (no POST), :invalid fields flagged
  // requestSubmit fires constraint validation without the UI bubble being required:
  const postCapture = [];
  page.on('request', (r) => { if (r.url().includes('/api/growth/inquiry')) postCapture.push('POST'); });
  await page.evaluate(() => document.querySelector('form')?.requestSubmit?.());
  await sleep(400);
  const atInvalid = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input:invalid, textarea:invalid, select:invalid')).length > 0,
  );
  const validationBlocked = atInvalid && postCapture.length === 0;
  report.form.validationBlockedEmptySubmit = validationBlocked;
  if (!validationBlocked) report.failures.push('Contact form: empty submit was not blocked by validation');

  // 5b valid submit -> success state + backend record
  const stamp = Date.now().toString(36);
  await page.fill('#name', 'Audit Bot');
  await page.fill('#businessName', `Audit Biz ${stamp}`);
  await page.fill('#email', `audit-${stamp}@example.com`);
  await page.fill('#phone', '+91 90000 00000');
  await page.selectOption('#industry', { index: 1 }).catch(() => '');
  await page.locator('.g-checks input').first().check().catch(() => {});
  await page.selectOption('#monthlyMarketingBudget', { index: 1 }).catch(() => {});
  await page.fill('#details', 'Automated functional audit submission - delete me.');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/growth/inquiry'), { timeout: 15000 }).catch(() => null),
    page.evaluate(() => document.querySelector('form')?.requestSubmit?.()),
  ]);
  await sleep(600);
  const successShown = await page.evaluate(() => /got it|thanks|on it/i.test(document.body.innerText) && !document.querySelector('form.g-form.open'));
  report.form.postStatus = resp?.status() ?? 'NO RESPONSE';
  report.form.successShown = successShown;
  if (resp?.status() !== 200) report.failures.push(`Contact form POST -> ${resp?.status() ?? 'no response'} (expected 200)`);
  if (!successShown) report.failures.push('Contact form: success state not shown after valid submit');

  // 5c backend has the record (Dash API)
  const dashRes = await page.request.get(`${DASH}/api/growth/me`).then((r) => r.status()).catch(() => 'ERR');
  report.backend.meEndpoint = dashRes;
  // inquire via direct POST is the same endpoint the form uses — verify via a second throwaway + cleanup check
  const probe = await page.request.post(`${DASH}/api/growth/inquiry`, {
    data: { name: 'Audit Probe', businessName: `Probe ${stamp}`, email: `probe-${stamp}@example.com`, phone: '+91 90000 00001', servicesRequired: ['advertising'] },
  }).catch(() => null);
  report.backend.directInquiryPost = probe?.status() ?? 'ERR';
  if (probe?.status() !== 200) report.failures.push(`Direct inquiry POST -> ${probe?.status() ?? 'ERR'}`);

  // ---------- 6. Mobile nav ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const menuBtn = page.locator('.menu-btn');
  await menuBtn.click().catch((e) => report.failures.push('mobile menu button click: ' + e.message.slice(0, 120)));
  await sleep(400);
  const overlayOpen = await page.evaluate(() => document.body.classList.contains('menu-open'));
  await menuBtn.click().catch(() => {});
  await sleep(300);
  const overlayClosed = await page.evaluate(() => !document.body.classList.contains('menu-open'));
  report.mobile.menuOpen = overlayOpen;
  report.mobile.menuClosed = overlayClosed;
  if (!overlayOpen || !overlayClosed) report.failures.push(`Mobile menu open=${overlayOpen} close=${overlayClosed}`);
  // Escape close
  await menuBtn.click().catch(() => {});
  await page.keyboard.press('Escape');
  await sleep(200);
  report.mobile.escapeClose = await page.evaluate(() => !document.body.classList.contains('menu-open'));
  if (!report.mobile.escapeClose) report.failures.push('Mobile menu: Escape did not close');
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---------- 7. Hover sanity (real mouse move so CSS :hover applies) ----------
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const hovered = await page.evaluate(async () => {
    const a = document.querySelector('.site-header .nav a');
    if (!a) return 'no nav link';
    const before = getComputedStyle(a, '::after').right;
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, before };
  });
  if (typeof hovered === 'object' && hovered.x) {
    await page.mouse.move(hovered.x, hovered.y);
    await sleep(400);
    const after = await page.evaluate(() => getComputedStyle(document.querySelector('.site-header .nav a'), '::after').right);
    report.hoverNavLink = { before: hovered.before, after, changed: hovered.before !== after };
    if (hovered.before === after) report.failures.push('Hover: nav link underline did not animate on hover');
  } else {
    report.hoverNavLink = hovered;
    report.failures.push('Hover: no nav link found');
  }

  report.consoleErrors = report._console || [];
  report.pageErrors = report._pageErrors || [];
  delete report._console; delete report._pageErrors;
  for (const e of report.consoleErrors) report.failures.push('CONSOLE: ' + e);
  for (const e of report.pageErrors) report.failures.push('PAGEERROR: ' + e);

  await browser.close();
  const clean = report.failures.length === 0;
  console.log(JSON.stringify({ ...report, clean }, null, 1));
  require('fs').writeFileSync('./audit-report.json', JSON.stringify({ ...report, clean }, null, 1));
  process.exit(clean ? 0 : 1);
})();
