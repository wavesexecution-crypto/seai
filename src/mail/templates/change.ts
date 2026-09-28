import {
  cta,
  eyebrow,
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

function summary(ctx: EmailContext): string {
  return ctx.request_summary || 'No description was added.';
}

export const changeTemplates: EmailTemplateDef[] = [
  {
    name: 'change.received',
    category: 'change',
    subject: 'We received your website change request',
    preheader: 'Your request is logged and queued for the SEAI build team.',
    reason: DEFAULT_REASON,
    trigger: 'Customer submits a change request (POST /api/customer/requests).',
    required: ['request_id', 'request_title'],
    optional: ['request_page', 'request_priority', 'request_summary', 'website_name', 'domain'],
    wired: true,
    build: (ctx) => [
      statusBadge('Submitted', 'neutral'),
      eyebrow('Change request'),
      heading('We received your request'),
      paragraph('Your change request is logged with the SEAI build team. You will get an email at every stage, and the full conversation stays in your dashboard.'),
      infoBlock('Request', [
        { label: 'Title', value: ctx.request_title },
        { label: 'Page / section', value: ctx.request_page || 'Whole site' },
        { label: 'Priority', value: ctx.request_priority || 'normal' },
        { label: 'Request ID', value: ctx.request_id },
        { label: 'Status', value: 'Submitted' },
      ]),
      cta('View Request in Dashboard', requestUrl(ctx)),
      note('Anything you want to add? Reply to this email and we will attach it to the request.'),
    ],
  },
  {
    name: 'change.reviewing',
    category: 'change',
    subject: 'Your SEAI change request is being reviewed',
    preheader: 'SEAI is reviewing your request before the work starts.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "reviewing".',
    required: ['request_id', 'request_title', 'request_status'],
    optional: ['request_page', 'request_summary', 'request_priority'],
    wired: true,
    build: (ctx) => [
      statusBadge(ctx.request_status || 'Reviewing', 'warning'),
      eyebrow('Change request'),
      heading('We are reviewing your request'),
      paragraph('A member of the SEAI team is checking the scope of your request against your live site so the work is done once, correctly.'),
      infoBlock('Request', [
        { label: 'Title', value: ctx.request_title },
        { label: 'Page / section', value: ctx.request_page || 'Whole site' },
        { label: 'Status', value: ctx.request_status || 'Reviewing' },
        { label: 'Request ID', value: ctx.request_id },
      ]),
      paragraph('Next step: we either start the work or reply with a question if something is unclear. You will get an email either way.'),
      cta('View Request in Dashboard', requestUrl(ctx)),
    ],
  },
  {
    name: 'change.in_progress',
    category: 'change',
    subject: 'Your SEAI change request is in progress',
    preheader: 'Work on your request has started.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "in_progress".',
    required: ['request_id', 'request_title', 'request_status'],
    optional: ['request_page', 'request_summary', 'website_name', 'domain', 'website_url'],
    wired: true,
    build: (ctx) => [
      statusBadge(ctx.request_status || 'In progress', 'warning'),
      eyebrow('Change request'),
      heading('Work is underway'),
      paragraph(`We are now making the change you requested${ctx.request_page ? ` on ${ctx.request_page}` : ''}.`),
      infoBlock('Request', [
        { label: 'Title', value: ctx.request_title },
        { label: 'Page / section', value: ctx.request_page || 'Whole site' },
        { label: 'Details', value: summary(ctx) },
        { label: 'Status', value: ctx.request_status || 'In progress' },
        ...(ctx.website_url ? [{ label: 'Live site', value: ctx.website_url, href: ctx.website_url }] : []),
      ]),
      cta('View Request in Dashboard', requestUrl(ctx)),
      note('We will email you the moment the change is live.'),
    ],
  },
  {
    name: 'change.waiting_for_client',
    category: 'change',
    subject: 'We need your input on your SEAI website change',
    preheader: 'SEAI needs one thing from you before the work can continue.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "waiting_for_client".',
    required: ['request_id', 'request_title', 'request_needed', 'request_status'],
    optional: ['request_page', 'request_summary'],
    wired: true,
    build: (ctx) => [
      statusBadge(ctx.request_status || 'Waiting for client', 'warning'),
      eyebrow('Action needed'),
      heading('We need something from you'),
      paragraph('Your change is paused until you reply. SEAI cannot continue without this, so it is the only thing holding the request up.'),
      infoBlock('What we need', [
        { label: 'Request', value: ctx.request_title },
        { label: 'Page / section', value: ctx.request_page || 'Whole site' },
        { label: 'Status', value: ctx.request_status || 'Waiting for client' },
      ]),
      infoBlock('SEAI needs', [{ label: 'Required', value: ctx.request_needed }]),
      paragraph('How to reply: open the request below, add a message with the detail we asked for, and attach any file you were asked for. As soon as you send it, the request returns to the build queue automatically.'),
      cta('Review Request', requestUrl(ctx)),
    ],
  },
  {
    name: 'change.completed',
    category: 'change',
    subject: 'Your SEAI website change is complete',
    preheader: 'The change is live on your site.',
    reason: DEFAULT_REASON,
    trigger: 'Change request status becomes "completed" (never before).',
    required: ['request_id', 'request_title', 'request_status'],
    optional: ['request_page', 'request_summary', 'website_name', 'domain', 'website_url'],
    wired: true,
    build: (ctx) => [
      statusBadge(ctx.request_status || 'Completed', 'positive'),
      eyebrow('Change complete'),
      heading('Your change is live'),
      paragraph(
        `${ctx.request_title} is done and published${ctx.request_page ? ` on ${ctx.request_page}` : ''}. Your dashboard is already showing the new version.`,
      ),
      infoBlock('Request', [
        { label: 'Title', value: ctx.request_title },
        { label: 'Page / section', value: ctx.request_page || 'Whole site' },
        { label: 'Status', value: ctx.request_status || 'Completed' },
        ...(ctx.website_url ? [{ label: 'Live site', value: ctx.website_url, href: ctx.website_url }] : []),
      ]),
      cta('View Request in Dashboard', requestUrl(ctx)),
      note('Not quite right? Reply to this email within the same request thread and we will correct it.'),
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
