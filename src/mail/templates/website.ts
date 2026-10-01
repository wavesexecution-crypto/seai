import { cta, heading, infoBlock, note, paragraph, statusBadge } from '../design.js';
import { dashboardUrl } from '../urls.js';
import type { EmailTemplateDef } from '../types.js';
import { DEFAULT_REASON } from '../types.js';

// Only the real recorded live URL is ever used. `website.ready` requires both
// domain and website_url, so a fabricated link cannot be rendered.
function liveUrl(ctx: { website_url: string }): string {
  return ctx.website_url;
}

export const websiteTemplates: EmailTemplateDef[] = [
  {
    name: 'website.purchase_confirmed',
    category: 'website',
    subject: 'Your SEAI website is underway',
    preheader: 'Your order is confirmed.',
    reason: DEFAULT_REASON,
    trigger: 'Authoritative payment confirmation from the payment service (never the browser).',
    required: ['customer_name', 'plan_name', 'amount', 'order_id', 'purchased_at'],
    optional: ['currency', 'website_name', 'payment_id'],
    wired: true,
    build: (ctx) => [
      statusBadge('Order confirmed', 'positive'),
      heading('Your website is underway.'),
      paragraph(
        ctx.customer_name
          ? `Thanks, ${ctx.customer_name}. We've received your payment and your project is now moving forward.`
          : "We've received your payment and your project is now moving forward.",
      ),
      infoBlock(null, [
        { label: 'Plan', value: ctx.plan_name },
        { label: 'Amount', value: ctx.amount },
        { label: 'Reference', value: ctx.order_id },
      ]),
      cta('View project', dashboardUrl()),
    ],
  },
  {
    name: 'website.intake_received',
    category: 'website',
    subject: "We've received your website details",
    preheader: 'Your website details are with our team.',
    reason: DEFAULT_REASON,
    trigger: 'Customer submits website requirements (authoritative intake record saved).',
    required: ['plan_name'],
    optional: ['customer_name', 'request_summary', 'request_page', 'website_name', 'domain', 'order_id'],
    wired: true,
    build: (ctx) => [
      statusBadge('Details received', 'positive'),
      heading("We've received your website details."),
      paragraph("Our team now has everything needed to start working on your site."),
      infoBlock(null, [
        { label: 'Plan', value: ctx.plan_name },
        { label: 'Website', value: ctx.website_name },
        { label: 'Pages', value: ctx.request_page },
      ]),
      cta('View project', dashboardUrl()),
      note('If something looks wrong, reply to this email and we will fix it before we start.'),
    ],
  },
  {
    name: 'website.in_progress',
    category: 'website',
    subject: 'Your website is being built',
    preheader: 'Work is underway on your site.',
    reason: DEFAULT_REASON,
    trigger: 'Website status moved into production/build work (authoritative status change).',
    required: ['stage'],
    optional: ['website_name', 'domain'],
    wired: true,
    build: (ctx) => [
      statusBadge('In progress', 'neutral'),
      heading('Your website is being built.'),
      paragraph("We're working through your project now. You'll hear from us when the next step is ready."),
      infoBlock(null, [
        { label: 'Current stage', value: ctx.stage },
        { label: 'Website', value: ctx.website_name },
      ]),
      cta('View project', dashboardUrl()),
    ],
  },
  {
    name: 'website.ready',
    category: 'website',
    subject: 'Your website is ready for review',
    preheader: 'Your site is ready to look at.',
    reason: DEFAULT_REASON,
    trigger: 'Website status marked ready with a real recorded domain (never a fabricated URL).',
    required: ['website_name', 'domain', 'website_url'],
    optional: ['customer_name', 'order_id'],
    wired: true,
    build: (ctx) => [
      statusBadge('Ready', 'positive'),
      heading('Your website is ready for review.'),
      paragraph('Take a look and let us know if you would like any changes.'),
      infoBlock(null, [
        { label: 'Website', value: ctx.website_name },
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
      ]),
      cta('Review website', liveUrl(ctx)),
    ],
  },
];
