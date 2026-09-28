import { cta, eyebrow, heading, infoBlock, linkList, note, paragraph } from '../design.js';
import { dashboardUrl, performanceUrl, publicSiteUrl } from '../urls.js';
import type { EmailContext } from '../context.js';
import type { EmailTemplateDef } from '../types.js';
import { DEFAULT_REASON } from '../types.js';

function metricRows(ctx: EmailContext): { label: string; value: string }[] {
  const raw = ctx.alert_summary;
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return { label: 'Metric', value: line };
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    });
}

export const internalTemplates: EmailTemplateDef[] = [
  {
    name: 'report.performance',
    category: 'internal',
    subject: 'Your SEAI website performance update',
    preheader: 'Real numbers from your connected analytics sources.',
    reason: DEFAULT_REASON,
    trigger: 'Reserved: performance reporting is not scheduled by the application today.',
    required: ['website_name'],
    optional: ['dashboard_url', 'alert_summary', 'domain', 'website_url'],
    wired: false,
    build: (ctx) => {
      const rows = metricRows(ctx);
      const blocks = [eyebrow('Performance'), heading('Performance update'), paragraph(`Here is the latest reading for ${ctx.website_name}${ctx.domain ? ` (${ctx.domain})` : ''}.`)];
      if (rows.length > 0) {
        blocks.push(infoBlock('Metrics', rows.map((r) => ({ label: r.label, value: r.value }))));
        blocks.push(note('These figures come straight from your connected analytics sources.'));
        blocks.push(cta('Open Performance Dashboard', performanceUrl()));
      } else {
        blocks.push(paragraph('Analytics is not connected yet, so there are nothing to report. Connect Google Analytics in your dashboard to start receiving real website data.'));
        blocks.push(cta('Connect Analytics', dashboardUrl('/settings')));
      }
      return blocks;
    },
  },
  {
    name: 'sales.cold_outreach',
    category: 'internal',
    subject: 'A better website for {{website_name}}',
    preheader: 'A short note from SEAI about your online presence.',
    reason: 'You are receiving this because SEAI looked up your business online.',
    trigger: 'Reserved: sales outreach. Not a customer lifecycle email; never sent by the API.',
    required: ['website_name', 'alert_summary'],
    optional: ['customer_name'],
    wired: false,
    build: (ctx) => [
      eyebrow('Hello from SEAI'),
      heading(`A better website for ${ctx.website_name}`),
      paragraph(`Hi — I looked at ${ctx.website_name} online and noticed ${ctx.alert_summary}. First impressions now happen on Google before anyone walks in, and a slow or missing site quietly sends customers elsewhere.`),
      paragraph('SEAI builds premium one-page business websites in about a week — copy, design, domain, and launch handled, with an owner dashboard for changes and maintenance afterwards.'),
      paragraph('Would you like a free homepage mockup? Reply "yes" and I will send one over.'),
      linkList([
        { label: 'See what SEAI builds', href: publicSiteUrl() },
        { label: 'Create an account', href: dashboardUrl('/create-account') },
      ]),
      note('— SEAI · workwithseai@gmail.com'),
    ],
  },
];
