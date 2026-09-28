import { dispatchEmail, type DispatchResult } from './dispatch.js';
import type { EmailContext } from './context.js';
import { dashboardUrl, changeRequestUrl } from './urls.js';
import { changeStatusLabel } from './templates/change.js';
import { config } from '../config.js';
import { trackPendingMail } from './pending.js';

// Backwards-compatible notification helpers. Signatures are unchanged so the
// existing auth/customer routes keep working, but every send now flows through
// the event pipeline: recorded, deduplicated, and never fatal to the request.

function target(to: string, variables: Partial<EmailContext> = {}): { to: string; variables: Partial<EmailContext> } {
  const override = config.mailQaRecipient.trim().toLowerCase();
  return { to: override || to, variables };
}

export function notifyWelcome(to: string, name: string, customerId?: string): void {
  const { to: recipient, variables } = target(to, { customer_name: name, dashboard_url: dashboardUrl() });
  trackPendingMail(() => dispatchEmail({ eventName: 'account.welcome', template: 'account.welcome', to: recipient, variables, customerId: customerId ?? null, dedupeParts: [customerId ?? recipient, name] }));
}

export function notifyChangeReceived(to: string, title: string, page: string, priority: string, requestId: string, customerId?: string): void {
  const { to: recipient, variables } = target(to, {
    request_id: requestId,
    request_title: title,
    request_page: page,
    request_priority: priority,
    request_status: 'Received',
    request_url: changeRequestUrl(requestId),
  });
  trackPendingMail(() => dispatchEmail({
    eventName: 'change.received',
    template: 'change.received',
    to: recipient,
    variables,
    customerId: customerId ?? null,
    dedupeParts: [requestId, recipient],
  }));
}

export function notifyChangeStatus(
  to: string,
  status: string,
  request: { id: string; title: string; summary?: string; page?: string; needed?: string; websiteUrl?: string; priority?: string },
  customerId?: string,
): void {
  const template = `change.${status}`;
  const { to: recipient, variables } = target(to, {
    request_id: request.id,
    request_title: request.title,
    request_status: changeStatusLabel(status) || status,
    request_summary: request.summary,
    request_page: request.page,
    request_priority: request.priority,
    request_needed: request.needed,
    website_url: request.websiteUrl,
    request_url: changeRequestUrl(request.id),
  });
  trackPendingMail(() => dispatchEmail({
    eventName: template,
    template,
    to: recipient,
    variables,
    customerId: customerId ?? null,
    // One email per (request, status) pair. A repeated transition to the same
    // status is a duplicate, not a new email.
    dedupeParts: [request.id, status, recipient],
  }));
}

export function notifyChangeCompleted(to: string, title: string, requestId: string, customerId?: string): void {
  notifyChangeStatus(to, 'completed', { id: requestId, title }, customerId);
}

export function notifyWaitingForClient(to: string, title: string, requestId: string, context: string, customerId?: string): void {
  notifyChangeStatus(to, 'waiting_for_client', { id: requestId, title, needed: context }, customerId);
}

export function notifyWebsiteIntake(
  to: string,
  intake: { planName: string; websiteName?: string; domain?: string; page?: string; summary?: string; orderId?: string },
  customerId?: string,
): void {
  const { to: recipient, variables } = target(to, {
    plan_name: intake.planName,
    website_name: intake.websiteName,
    domain: intake.domain,
    request_page: intake.page,
    request_summary: intake.summary,
    order_id: intake.orderId,
  });
  trackPendingMail(() => dispatchEmail({
    eventName: 'website.intake_received',
    template: 'website.intake_received',
    to: recipient,
    variables,
    customerId: customerId ?? null,
    dedupeParts: [customerId ?? recipient, intake.websiteName ?? intake.domain ?? 'intake'],
  }));
}

export function notifyMaintenanceRequested(
  to: string,
  planName: string,
  priceInr: number,
  subscriptionId?: string,
  customerId?: string,
): void {
  const { to: recipient, variables } = target(to, {
    plan_name: planName,
    maintenance_price: `₹${priceInr}`,
    amount: `₹${priceInr}`,
    status: 'Payment required',
  });
  trackPendingMail(() => dispatchEmail({
    eventName: 'maintenance.payment_required',
    template: 'maintenance.payment_required',
    to: recipient,
    variables,
    customerId: customerId ?? null,
    dedupeParts: [subscriptionId ?? recipient, 'pending_payment', recipient],
  }));
}

export { dispatchEmail };
export type { DispatchResult };
