import {
  cta,
  heading,
  infoBlock,
  note,
  paragraph,
  statusBadge,
  urlFallback,
} from '../design.js';
import { dashboardUrl } from '../urls.js';
import type { EmailTemplateDef } from '../types.js';
import { DEFAULT_REASON } from '../types.js';

export const accountTemplates: EmailTemplateDef[] = [
  {
    name: 'account.welcome',
    category: 'account',
    subject: 'Welcome to SEAI',
    preheader: 'Your SEAI account is ready.',
    reason: DEFAULT_REASON,
    trigger: 'Customer account created (POST /api/auth/sign-up).',
    required: ['customer_name', 'email'],
    optional: ['dashboard_url'],
    wired: true,
    build: (ctx) => [
      statusBadge('Welcome', 'positive'),
      heading('Your account is ready.'),
      paragraph(
        ctx.customer_name
          ? `Thanks, ${ctx.customer_name}. You can now open your project, follow updates, and manage your website.`
          : 'You can now open your project, follow updates, and manage your website.',
      ),
      cta('Open dashboard', dashboardUrl()),
    ],
  },
  {
    name: 'account.password_reset',
    category: 'account',
    subject: 'Reset your SEAI password',
    preheader: 'Choose a new SEAI password.',
    reason: DEFAULT_REASON,
    trigger: 'POST /api/auth/forgot-password for an existing account.',
    required: ['reset_url', 'email'],
    optional: ['expires_in_hours'],
    wired: true,
    build: (ctx) => [
      statusBadge('Password reset', 'neutral'),
      heading('Reset your password.'),
      paragraph('Choose a new SEAI password using the button below.'),
      cta('Reset password', ctx.reset_url),
      urlFallback(ctx.reset_url, 'Or open this link:'),
      note(`This link expires in ${ctx.expires_in_hours || '60'} minutes and can only be used once.`),
      note(`If you didn't request this, you can safely ignore this email.`),
    ],
  },
  {
    name: 'account.password_changed',
    category: 'account',
    subject: 'Your SEAI password was changed',
    preheader: 'Your password was updated.',
    reason: DEFAULT_REASON,
    trigger: 'POST /api/auth/reset-password completed successfully.',
    required: ['changed_at'],
    optional: ['email', 'dashboard_url'],
    wired: true,
    build: (ctx) => [
      statusBadge('Password updated', 'positive'),
      heading('Your password has been changed.'),
      paragraph('Use your new password the next time you sign in.'),
      infoBlock(null, [{ label: 'Changed at', value: ctx.changed_at }]),
      note('If you did not make this change, contact us immediately and we will secure your account.'),
      cta('Open dashboard', dashboardUrl()),
    ],
  },
  {
    name: 'account.new_sign_in_alert',
    category: 'account',
    subject: 'New sign-in to your SEAI account',
    preheader: 'A new sign-in was recorded.',
    reason: DEFAULT_REASON,
    trigger: 'Reserved: no sign-in event store exists yet, so nothing emits this today.',
    required: ['changed_at', 'alert_summary'],
    optional: ['email'],
    wired: false,
    build: (ctx) => [
      statusBadge('Security', 'warning'),
      heading('A new sign-in to your account.'),
      paragraph('We recorded a sign-in we had not seen before. If this was you, no action is needed.'),
      infoBlock(null, [
        { label: 'When', value: ctx.changed_at },
        { label: 'Details', value: ctx.alert_summary },
      ]),
      note('If this was not you, reset your password and contact us.'),
      cta('Open dashboard', dashboardUrl()),
    ],
  },
];
