import { cta, heading, infoBlock, paragraph, statusBadge } from '../design.js';
import { performanceUrl, publicSiteUrl } from '../urls.js';
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
      const blocks = [
        statusBadge('Performance', 'neutral'),
        heading('How your website is doing.'),
      ];
      if (rows.length > 0) {
        blocks.push(paragraph(`Here is the latest reading for ${ctx.website_name}.`));
        blocks.push(infoBlock(null, rows.map((r) => ({ label: r.label, value: r.value }))));
        blocks.push(cta('View performance', performanceUrl()));
      } else {
        blocks.push(paragraph("Analytics aren't connected yet, so there's nothing to report. Connect them in your dashboard and we'll start sending real numbers."));
        blocks.push(cta('Connect analytics', performanceUrl()));
      }
      return blocks;
    },
  },
  {
    name: 'sales.cold_outreach',
    category: 'internal',
    subject: 'A better website for {{website_name}}',
    preheader: 'A short note from SEAI.',
    reason: 'You are receiving this because SEAI looked up your business online.',
    trigger: 'Reserved: sales outreach. Not a customer lifecycle email; never sent by the API.',
    required: ['website_name', 'alert_summary'],
    optional: ['customer_name'],
    wired: false,
    build: (ctx) => [
      statusBadge('Hello from SEAI', 'neutral'),
      heading(`A better website for ${ctx.website_name}`),
      paragraph(
        `Hi — I looked at ${ctx.website_name} online and noticed ${ctx.alert_summary}. Most people find a business on Google first, and a weak site quietly sends them elsewhere.`,
      ),
      paragraph('SEAI builds premium business websites in about a week — copy, design, domain, and launch handled.'),
      cta('See what we build', publicSiteUrl()),
    ],
  },
];
