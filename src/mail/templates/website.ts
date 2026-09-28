import {
  cta,
  eyebrow,
  heading,
  infoBlock,
  linkList,
  note,
  paragraph,
  statusBadge,
  stepList,
} from '../design.js';
import { dashboardUrl, supportUrl } from '../urls.js';
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
    subject: 'Your SEAI website order is confirmed',
    preheader: 'Payment confirmed — here is your order summary and what happens next.',
    reason: DEFAULT_REASON,
    trigger: 'Authoritative payment confirmation from the payment service (never the browser).',
    required: ['customer_name', 'plan_name', 'amount', 'order_id', 'purchased_at'],
    optional: ['currency', 'website_name', 'payment_id'],
    wired: true,
    build: (ctx) => [
      eyebrow('Order confirmed'),
      heading(`Thank you${ctx.customer_name ? `, ${ctx.customer_name}` : ''}`),
      paragraph('Your payment was confirmed and your SEAI website order is locked in. This email is your receipt for the order.'),
      infoBlock('Order summary', [
        { label: 'Plan', value: ctx.plan_name },
        { label: 'Amount paid', value: ctx.amount },
        { label: 'Order ID', value: ctx.order_id },
        { label: 'Paid on', value: ctx.purchased_at },
        ...(ctx.payment_id ? [{ label: 'Payment ID', value: ctx.payment_id }] : []),
      ]),
      paragraph('What happens next:'),
      stepList([
        'You submit your website details and content in the dashboard (intake).',
        'SEAI builds your website and sends you a preview to review.',
        'You approve the preview, we connect your domain and publish the site.',
        'You then manage changes and maintenance from the same dashboard.',
      ]),
      cta('Open SEAI Dashboard', dashboardUrl()),
      note('Keep your order ID for reference. SEAI never asks for card details by email.'),
    ],
  },
  {
    name: 'website.intake_received',
    category: 'website',
    subject: 'We received your website details',
    preheader: 'Your website requirements are in — SEAI starts building from here.',
    reason: DEFAULT_REASON,
    trigger: 'Customer submits website requirements (authoritative intake record saved).',
    required: ['plan_name'],
    optional: ['customer_name', 'request_summary', 'request_page', 'website_name', 'domain', 'order_id'],
    wired: true,
    build: (ctx) => [
      eyebrow('Intake received'),
      heading('We have your website details'),
      paragraph(`Thanks${ctx.customer_name ? `, ${ctx.customer_name}` : ''} — your requirements are saved and SEAI is starting the build.`),
      infoBlock('What you sent us', [
        { label: 'Plan', value: ctx.plan_name },
        { label: 'Website', value: ctx.website_name },
        { label: 'Pages / sections', value: ctx.request_page },
        { label: 'Details', value: ctx.request_summary },
        ...(ctx.order_id ? [{ label: 'Order ID', value: ctx.order_id }] : []),
      ]),
      paragraph('Next step: SEAI builds your website and sends a preview to your dashboard. You can edit or add anything at any point while we work.'),
      cta('Open SEAI Dashboard', dashboardUrl()),
      note('If something in your details is wrong, reply to this email and we will correct it before the build moves on.'),
    ],
  },
  {
    name: 'website.in_progress',
    category: 'website',
    subject: 'Your SEAI website is in progress',
    preheader: 'Your site has moved into the build stage.',
    reason: DEFAULT_REASON,
    trigger: 'Website status moved into production/build work (authoritative status change).',
    required: ['stage'],
    optional: ['website_name', 'domain'],
    wired: true,
    build: (ctx) => [
      statusBadge(ctx.stage || 'In progress', 'warning'),
      eyebrow('Build update'),
      heading('Your website is being built'),
      paragraph(
        `${ctx.website_name || 'Your site'}${ctx.domain ? ` (${ctx.domain})` : ''} is now in the SEAI build stage: layout, copy, and assets are being assembled into the final site.`,
      ),
      infoBlock('Current stage', [
        { label: 'Stage', value: ctx.stage || 'In production' },
        { label: 'Website', value: ctx.website_name },
        { label: 'Domain', value: ctx.domain },
      ]),
      paragraph('No action needed right now. You will get a separate email with your preview as soon as there is something to review.'),
      cta('View Progress in Dashboard', dashboardUrl()),
    ],
  },
  {
    name: 'website.ready',
    category: 'website',
    subject: 'Your SEAI website is ready',
    preheader: 'Your site is live — here is the link.',
    reason: DEFAULT_REASON,
    trigger: 'Website status marked ready with a real recorded domain (never a fabricated URL).',
    required: ['website_name', 'domain', 'website_url'],
    optional: ['customer_name', 'order_id'],
    wired: true,
    build: (ctx) => [
      statusBadge('Live', 'positive'),
      eyebrow('Your site is ready'),
      heading(`${ctx.website_name} is live`),
      paragraph('Your SEAI website is published and live on your own domain.'),
      infoBlock('Website', [
        { label: 'Website', value: ctx.website_name },
        { label: 'Domain', value: ctx.domain },
        { label: 'Live URL', value: ctx.website_url, href: liveUrl(ctx) },
      ]),
      cta('Visit Your Website', liveUrl(ctx)),
      linkList([
        { label: 'Open SEAI Dashboard', href: dashboardUrl() },
        { label: 'Request a change', href: dashboardUrl('/modify') },
        { label: 'Get support', href: supportUrl() },
      ]),
      note('Reply to this email or use the dashboard to request changes — small tweaks are usually turned around quickly.'),
    ],
  },
];
