import {
  cta,
  divider,
  eyebrow,
  heading,
  infoBlock,
  linkList,
  note,
  paragraph,
  statusBadge,
} from '../design.js';
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
    subject: 'Your domain is connected to SEAI',
    preheader: 'Your domain is now serving your SEAI website.',
    reason: DEFAULT_REASON,
    trigger: 'Domain/SSL confirmed connected in the authoritative website record.',
    required: ['domain', 'website_url'],
    optional: ['website_name', 'status'],
    wired: true,
    build: (ctx) => [
      statusBadge('Domain connected', 'positive'),
      eyebrow('Domain'),
      heading('Your domain is connected to SEAI'),
      paragraph(
        `${ctx.domain} is now connected and serving your SEAI website${ctx.website_name ? `, ${ctx.website_name}` : ''}, with a valid SSL certificate.`,
      ),
      infoBlock('Domain', [
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
        ...(ctx.status ? [{ label: 'Status', value: ctx.status }] : []),
      ]),
      cta('Visit Your Website', liveUrl(ctx)),
      note('If your browser shows a certificate warning, give it a minute and hard-refresh — SSL can take a few minutes to propagate.'),
    ],
  },
  {
    name: 'website.deployed',
    category: 'service',
    subject: 'Your SEAI website has been deployed',
    preheader: 'A new version of your site is live.',
    reason: DEFAULT_REASON,
    trigger: 'Deployment confirmed in the authoritative website record.',
    required: ['domain', 'website_url'],
    optional: ['website_name', 'deployment_id', 'status', 'changed_at'],
    wired: true,
    build: (ctx) => [
      statusBadge('Deployed', 'positive'),
      eyebrow('Deployment'),
      heading('Your website has been deployed'),
      paragraph(
        `A new version of ${ctx.website_name || 'your SEAI website'} is live on ${ctx.domain}.`,
      ),
      infoBlock('Deployment', [
        { label: 'Domain', value: ctx.domain },
        { label: 'Deployed', value: ctx.changed_at },
        ...(ctx.deployment_id ? [{ label: 'Deployment ID', value: ctx.deployment_id }] : []),
        ...(ctx.status ? [{ label: 'Status', value: ctx.status }] : []),
      ]),
      cta('Visit Your Website', liveUrl(ctx)),
      linkList([{ label: 'Open SEAI Dashboard', href: dashboardUrl() }]),
    ],
  },
  {
    name: 'website.status_alert',
    category: 'service',
    subject: 'Action needed on your SEAI website',
    preheader: 'SEAI detected a problem with your website.',
    reason: DEFAULT_REASON,
    trigger: 'Authoritative website incident raised by SEAI monitoring (never guessed).',
    required: ['alert_summary', 'status'],
    optional: ['website_name', 'domain', 'website_url', 'changed_at'],
    wired: true,
    build: (ctx) => [
      statusBadge(ctx.status || 'Needs attention', 'critical'),
      eyebrow('Website alert'),
      heading('Action needed on your website'),
      paragraph(ctx.alert_summary),
      infoBlock('Affected website', [
        { label: 'Website', value: ctx.website_name },
        { label: 'Domain', value: ctx.domain },
        { label: 'Status', value: ctx.status },
        ...(ctx.changed_at ? [{ label: 'Detected', value: ctx.changed_at }] : []),
      ]),
      divider(),
      paragraph('SEAI is already working on it. If your website is unreachable right now, reply to this email and we will prioritise it.'),
      cta('Open SEAI Dashboard', dashboardUrl()),
    ],
  },
  {
    name: 'website.domain_manage',
    category: 'service',
    subject: 'Check your SEAI domain connection',
    preheader: 'A quick check on your domain and SSL status.',
    reason: DEFAULT_REASON,
    trigger: 'Reserved legacy helper; superseded by website.domain_connected.',
    required: ['domain'],
    optional: ['website_name', 'website_url', 'status'],
    wired: false,
    build: (ctx) => [
      eyebrow('Domain'),
      heading('Your domain and SEAI'),
      paragraph(`Here is the current connection state for ${ctx.domain}.`),
      infoBlock('Domain', [
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
        ...(ctx.status ? [{ label: 'Status', value: ctx.status }] : []),
      ]),
      cta('Manage Domains', domainsUrl()),
    ],
  },
];
