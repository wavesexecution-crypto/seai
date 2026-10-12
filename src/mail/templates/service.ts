import { cta, heading, infoBlock, note, paragraph, statusBadge } from '../design.js';
import { dashboardUrl, domainsUrl, websiteUrl } from '../urls.js';
import type { EmailTemplateDef } from '../types.js';
import { DEFAULT_REASON } from '../types.js';

function liveUrl(ctx: { domain: string; website_url: string }): string {
  return ctx.website_url || (ctx.domain ? websiteUrl(ctx.domain) : dashboardUrl());
}

export const serviceTemplates: EmailTemplateDef[] = [
  {
    name: 'website.domain_connected',
    category: 'service',
    subject: 'Your domain is connected',
    preheader: 'Your site is live on your own domain.',
    reason: DEFAULT_REASON,
    trigger: 'Domain/SSL confirmed connected in the authoritative website record.',
    required: ['domain', 'website_url'],
    optional: ['website_name', 'status'],
    wired: true,
    build: (ctx) => [
      statusBadge('Connected', 'positive'),
      heading('Your domain is connected.'),
      paragraph('Your website is now served from your own domain.'),
      infoBlock(null, [
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
      ]),
      cta('Open website', liveUrl(ctx)),
    ],
  },
  {
    name: 'website.deployed',
    category: 'service',
    subject: 'Your website is live',
    preheader: 'A new version of your site is online.',
    reason: DEFAULT_REASON,
    trigger: 'Deployment confirmed in the authoritative website record.',
    required: ['domain', 'website_url'],
    optional: ['website_name', 'deployment_id', 'status', 'changed_at'],
    wired: true,
    build: (ctx) => [
      statusBadge('Live', 'positive'),
      heading('Your website is live.'),
      paragraph('Everything is ready. Your SEAI website is now available online.'),
      infoBlock(null, [
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
        ...(ctx.changed_at ? [{ label: 'Updated', value: ctx.changed_at }] : []),
      ]),
      cta('Open website', liveUrl(ctx)),
    ],
  },
  {
    name: 'website.status_alert',
    category: 'service',
    subject: 'Action needed on your website',
    preheader: 'We spotted a problem with your website.',
    reason: DEFAULT_REASON,
    trigger: 'Authoritative website incident raised by SEAI monitoring (never guessed).',
    required: ['alert_summary', 'status'],
    optional: ['website_name', 'domain', 'website_url', 'changed_at'],
    wired: true,
    build: (ctx) => [
      statusBadge('Needs attention', 'critical'),
      heading('Something needs your attention.'),
      paragraph(ctx.alert_summary),
      infoBlock(null, [
        { label: 'Website', value: ctx.website_name },
        { label: 'Domain', value: ctx.domain },
      ]),
      cta('Open website', liveUrl(ctx)),
      note('We are already working on it. If your site is unreachable, reply to this email.'),
    ],
  },
  {
    name: 'website.domain_manage',
    category: 'service',
    subject: 'Check your domain connection',
    preheader: 'A quick check on your domain.',
    reason: DEFAULT_REASON,
    trigger: 'Reserved legacy helper; superseded by website.domain_connected.',
    required: ['domain'],
    optional: ['website_name', 'website_url', 'status'],
    wired: false,
    build: (ctx) => [
      statusBadge('Domain', 'neutral'),
      heading('Your domain and SEAI'),
      infoBlock(null, [
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
      ]),
      cta('Manage domain', domainsUrl()),
    ],
  },
];
