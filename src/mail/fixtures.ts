import { config } from '../config.js';
import { changeRequestUrl, dashboardUrl, websiteUrl } from './urls.js';
import type { EmailContext } from './context.js';

// Realistic sample data for local previews and the render test-suite. Nothing
// here is sent anywhere unless a preview script explicitly targets a mailbox.
const NOW = '2026-03-14T09:30:00.000Z';

function base(overrides: Partial<EmailContext> = {}): EmailContext {
  return {
    customer_name: 'Aarav Sharma',
    email: config.mailQaRecipient || 'preview@example.com',
    website_name: 'Sharma Dental Studio',
    domain: 'sharmadental.example.com',
    website_url: 'https://sharmadental.example.com',
    plan_name: 'Premium One-Page Website',
    amount: '₹9,999',
    order_id: 'ord_8f21ac90',
    payment_id: 'pay_4c1de771',
    order_total: '₹9,999',
    request_id: 'req_2b77e0aa',
    request_title: 'Update the opening hours on the homepage',
    request_status: 'in_progress',
    request_summary: 'The customer asked for the new Saturday hours to replace the old ones on the hero section and the footer.',
    request_page: 'Homepage',
    request_priority: 'normal',
    request_needed: 'Approve the copy in the dashboard so SEAI can publish the new hours.',
    maintenance_price: '₹457',
    billing_interval: 'month',
    billing_date: '14 April 2026',
    next_billing_date: '2026-04-14T00:00:00.000Z',
    activated_at: '14 March 2026, 09:05',
    purchased_at: '14 March 2026, 09:04',
    changed_at: '14 March 2026, 09:31',
    issued_at: NOW,
    stage: 'Layout and copy in production',
    expires_in_hours: '1',
    failure_reason: 'The card was declined by the issuing bank.',
    refund_amount: '₹9,999',
    receipt_id: 'rcpt_71bd0c45',
    deployment_id: 'dep_5a10ff20',
    alert_summary: 'The homepage returns a 522 error from the edge network and the SSL certificate expires in 3 days.',
    ...overrides,
  } as EmailContext;
}

export interface PreviewFixture {
  name: string;
  template: string;
  label: string;
  context: Partial<EmailContext>;
}

export const PREVIEW_FIXTURES: PreviewFixture[] = [
  {
    name: '01-welcome',
    label: 'Account welcome',
    template: 'account.welcome',
    context: { dashboard_url: dashboardUrl('/overview') },
  },
  {
    name: '02-password-reset',
    label: 'Password reset',
    template: 'account.password_reset',
    context: { reset_url: `${dashboardUrl('/reset-password')}?token=preview-token-not-a-real-token` },
  },
  {
    name: '03-password-changed',
    label: 'Password changed',
    template: 'account.password_changed',
    context: {},
  },
  {
    name: '04-purchase-confirmed',
    label: 'Purchase confirmed',
    template: 'website.purchase_confirmed',
    context: {},
  },
  {
    name: '05-intake-received',
    label: 'Website intake received',
    template: 'website.intake_received',
    context: {},
  },
  {
    name: '06-website-in-progress',
    label: 'Website in progress',
    template: 'website.in_progress',
    context: {},
  },
  {
    name: '07-website-ready',
    label: 'Website ready (live URL)',
    template: 'website.ready',
    context: {},
  },
  {
    name: '08-change-received',
    label: 'Change request received',
    template: 'change.received',
    context: { request_url: changeRequestUrl('req_2b77e0aa') },
  },
  {
    name: '09-change-reviewing',
    label: 'Change request under review',
    template: 'change.reviewing',
    context: { request_url: changeRequestUrl('req_2b77e0aa') },
  },
  {
    name: '10-change-in-progress',
    label: 'Change request in progress',
    template: 'change.in_progress',
    context: { request_url: changeRequestUrl('req_2b77e0aa') },
  },
  {
    name: '11-change-waiting',
    label: 'Waiting for client',
    template: 'change.waiting_for_client',
    context: { request_url: changeRequestUrl('req_2b77e0aa') },
  },
  {
    name: '12-change-completed',
    label: 'Change request completed',
    template: 'change.completed',
    context: { request_url: changeRequestUrl('req_2b77e0aa') },
  },
  {
    name: '13-maintenance-payment-required',
    label: 'Maintenance payment required',
    template: 'maintenance.payment_required',
    context: { status: 'Payment required' },
  },
  {
    name: '14-maintenance-activated',
    label: 'Maintenance activated',
    template: 'maintenance.activated',
    context: { status: 'Active' },
  },
  {
    name: '15-maintenance-payment-successful',
    label: 'Maintenance payment successful',
    template: 'maintenance.payment_successful',
    context: { status: 'Active' },
  },
  {
    name: '16-maintenance-payment-failed',
    label: 'Maintenance payment failed',
    template: 'maintenance.payment_failed',
    context: { status: 'Payment failed' },
  },
  {
    name: '17-maintenance-renewing',
    label: 'Maintenance renewing',
    template: 'maintenance.renewing',
    context: { status: 'Active' },
  },
  {
    name: '18-maintenance-ended',
    label: 'Maintenance ended',
    template: 'maintenance.ended',
    context: { status: 'Ended' },
  },
  {
    name: '19-payment-successful',
    label: 'Payment successful',
    template: 'payment.successful',
    context: { status: 'Successful' },
  },
  {
    name: '20-payment-failed',
    label: 'Payment failed',
    template: 'payment.failed',
    context: { status: 'Failed' },
  },
  {
    name: '21-payment-pending',
    label: 'Payment pending',
    template: 'payment.pending',
    context: { status: 'Pending' },
  },
  {
    name: '22-payment-refunded',
    label: 'Payment refunded',
    template: 'payment.refunded',
    context: { status: 'Refunded' },
  },
  {
    name: '23-payment-receipt',
    label: 'Payment receipt',
    template: 'payment.receipt',
    context: { status: 'Successful' },
  },
  {
    name: '24-domain-connected',
    label: 'Domain connected',
    template: 'website.domain_connected',
    context: { status: 'Connected' },
  },
  {
    name: '25-deployed',
    label: 'Website deployed',
    template: 'website.deployed',
    context: { status: 'Live', website_url: websiteUrl('sharmadental.example.com') },
  },
  {
    name: '26-status-alert',
    label: 'Website status alert',
    template: 'website.status_alert',
    context: { status: 'Degraded' },
  },
  {
    name: '27-performance-report',
    label: 'Performance report (reserved)',
    template: 'report.performance',
    context: { alert_summary: 'Largest Contentful Paint: 2.4 s\nFirst Input Delay: 180 ms\nConversion rate: 3.1%' },
  },
  {
    name: '28-new-sign-in-alert',
    label: 'New sign-in alert (reserved)',
    template: 'account.new_sign_in_alert',
    context: { status: 'New sign-in from a device we have not seen before' },
  },
  {
    name: '29-payment-reminder',
    label: 'Payment reminder (reserved)',
    template: 'maintenance.payment_reminder',
    context: { status: 'Reminder', next_billing_date: '2026-04-14T00:00:00.000Z' },
  },
  {
    name: '30-domain-manage',
    label: 'Domain manager (reserved)',
    template: 'website.domain_manage',
    context: { status: 'Pointed at SEAI' },
  },
  {
    name: '31-cold-outreach',
    label: 'Sales outreach (reserved)',
    template: 'sales.cold_outreach',
    context: { status: 'Intro' },
  },
];

export function previewContext(overrides: Partial<EmailContext> = {}): Partial<EmailContext> {
  return base(overrides);
}
