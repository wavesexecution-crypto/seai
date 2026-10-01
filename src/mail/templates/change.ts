import {
  cta,
  heading,
  infoBlock,
  note,
  paragraph,
  statusBadge,
  type Tone,
} from '../design.js';
import { changeRequestUrl } from '../urls.js';
import type { EmailContext } from '../context.js';
import type { EmailTemplateDef } from '../types.js';
import { DEFAULT_REASON } from '../types.js';

// request_id is required on every change template, so the link always points at
// a real stored request. No placeholder id is ever rendered.
function requestUrl(ctx: EmailContext): string {
  return changeRequestUrl(ctx.request_id);
}

export const changeTemplates: EmailTemplateDef[] = [
  {
    name: 'change.received',
    category: 'change',
    subject: 'We received your website change request',
    preheader: 'Your request is with our team.',
    reason: DEFAULT_REASON,
    trigger: 'Customer submits a change request (POST /api/customer/requests).',
    required: ['request_id', 'request_title'],
    optional: ['request_page', 'request_priority', 'request_summary', 'website_name', 'domain'],
    wired: true,
    build: (ctx) => [
      statusBadge('Received', 'neutral'),
      heading("We've received your request."),
      paragraph("We'll review the changes and update you when they're ready."),
      infoBlock(null, [
        { label: 'Request', value: ctx.request_title },
        { label: 'Page', value: ctx.request_page || 'Whole site' },
      ]),
      cta('View request', requestUrl(ctx)),
      note('Anything to add? Reply to this email.'),
    ],
  },
  {
    name: 'change.reviewing',
    category: 'change',
    subject: 'Your change request is being reviewed',
    preheader: 'We are checking your request.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "reviewing".',
    required: ['request_id', 'request_title', 'request_status'],
    optional: ['request_page', 'request_summary', 'request_priority'],
    wired: true,
    build: (ctx) => [
      statusBadge('Reviewing', 'neutral'),
      heading('We are reviewing your request.'),
      paragraph("We'll confirm the scope and start work shortly."),
      infoBlock(null, [
        { label: 'Request', value: ctx.request_title },
        { label: 'Page', value: ctx.request_page || 'Whole site' },
      ]),
      cta('View request', requestUrl(ctx)),
    ],
  },
  {
    name: 'change.in_progress',
    category: 'change',
    subject: 'Your change is in progress',
    preheader: 'Work on your request has started.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "in_progress".',
    required: ['request_id', 'request_title', 'request_status'],
    optional: ['request_page', 'request_summary', 'website_name', 'domain', 'website_url'],
    wired: true,
    build: (ctx) => [
      statusBadge('In progress', 'warning'),
      heading('We are making your change.'),
      paragraph(
        ctx.request_page ? `This update is for ${ctx.request_page}.` : 'This update is for your site.',
      ),
      infoBlock(null, [
        { label: 'Request', value: ctx.request_title },
        { label: 'Page', value: ctx.request_page || 'Whole site' },
      ]),
      cta('View request', requestUrl(ctx)),
      note("We'll email you the moment it's live."),
    ],
  },
  {
    name: 'change.waiting_for_client',
    category: 'change',
    subject: 'We need a little more information',
    preheader: 'One thing is needed before we continue.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "waiting_for_client".',
    required: ['request_id', 'request_title', 'request_needed', 'request_status'],
    optional: ['request_page', 'request_summary'],
    wired: true,
    build: (ctx) => [
      statusBadge('Waiting for you', 'warning'),
      heading('We need a little more information.'),
      paragraph(ctx.request_needed),
      infoBlock(null, [{ label: 'Request', value: ctx.request_title }]),
      cta('Reply to SEAI', requestUrl(ctx)),
    ],
  },
  {
    name: 'change.completed',
    category: 'change',
    subject: 'Your website change is complete',
    preheader: 'Your changes are live.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "completed" (never before).',
    required: ['request_id', 'request_title', 'request_status'],
    optional: ['request_page', 'request_summary', 'website_name', 'domain', 'website_url'],
    wired: true,
    build: (ctx) => [
      statusBadge('Complete', 'positive'),
      heading('Your requested changes are complete.'),
      paragraph(
        ctx.request_page
          ? `Your ${ctx.request_page} update is live and ready to review.`
          : 'Your website is live and ready to review.',
      ),
      infoBlock(null, [{ label: 'Request', value: ctx.request_title }]),
      ...(ctx.website_url
        ? [cta('Open website', ctx.website_url), cta('Review changes', requestUrl(ctx))]
        : [cta('Review changes', requestUrl(ctx))]),
      note('Not quite right? Reply to this email and we will correct it.'),
    ],
  },
];

export const changeStatusTemplate: Record<string, { tone: Tone; name: string; label: string }> = {
  submitted: { tone: 'neutral', name: 'change.received', label: 'Received' },
  reviewing: { tone: 'warning', name: 'change.reviewing', label: 'Reviewing' },
  in_progress: { tone: 'warning', name: 'change.in_progress', label: 'In progress' },
  waiting_for_client: { tone: 'warning', name: 'change.waiting_for_client', label: 'Waiting for your input' },
  completed: { tone: 'positive', name: 'change.completed', label: 'Completed' },
};

/**
 * Human label for a stored status. Customer copy must never show a raw database
 * enum such as `waiting_for_client`.
 */
export function changeStatusLabel(status: string): string {
  return changeStatusTemplate[status]?.label ?? '';
}
