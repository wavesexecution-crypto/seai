import { dispatchEmail, type DispatchResult } from './dispatch.js';
import type { EmailContext } from './context.js';
import { dashboardUrl, changeRequestUrl, websiteUrl } from './urls.js';
import { changeStatusLabel, changeStatusTemplate } from './templates/change.js';
import { config } from '../config.js';
import { trackPendingMail } from './pending.js';

// Backwards-compatible notification helpers. Signatures are unchanged so the
// existing auth/customer routes keep working, but every send now flows through
// the event pipeline: recorded, deduplicated, and never fatal to the request.

function target(to: string, variables: Partial<EmailContext> = {}): { to: string; variables: Partial<EmailContext> } {
  const override = config.mailQaRecipient.trim().toLowerCase();
  return { to: override || to, variables };
}

// Customer-facing correctness must never depend on email. Every helper below
// is wrapped so a URL/render/dispatch failure can only skip the message — it
// can never throw into the request handler (which would surface as a failed
// customer action) and can never reject unhandled and take the process down.
function guard(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    console.error(`[mail] ${name} skipped: ${(err as Error).message}`);
  }
}

export function notifyWelcome(to: string, name: string, customerId?: string): void {
  guard('welcome', () => {
    const { to: recipient, variables } = target(to, { customer_name: name, dashboard_url: dashboardUrl() });
    trackPendingMail(() => dispatchEmail({ eventName: 'account.welcome', template: 'account.welcome', to: recipient, variables, customerId: customerId ?? null, dedupeParts: [customerId ?? recipient, name] }));
  });
}

export function notifyChangeReceived(to: string, title: string, page: string, priority: string, requestId: string, customerId?: string): void {
  guard('change.received', () => {
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
  });
}

export function notifyChangeStatus(
  to: string,
  status: string,
  request: { id: string; title: string; summary?: string; page?: string; needed?: string; websiteUrl?: string; priority?: string },
  customerId?: string,
): void {
  guard(`change.${status}`, () => {
    // `submitted` is a valid stored status but has no template of its own — the
    // notice for a newly submitted request is `change.received`. Building the
    // name as `change.${status}` produced TEMPLATE_UNKNOWN for `submitted`, so
    // the canonical status -> template map is used instead.
    const template = changeStatusTemplate[status]?.name ?? `change.${status}`;
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
  });
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
  guard('website.intake_received', () => {
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
  });
}

export function notifyMaintenanceRequested(
  to: string,
  planName: string,
  priceInr: number,
  subscriptionId?: string,
  customerId?: string,
): void {
  guard('maintenance.payment_required', () => {
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
  });
}

/* ============ website lifecycle (authoritative, staff-driven) ============ */

/**
 * A verified purchase recorded against the customer's website — the order ->
 * website handoff. This is NOT a payment confirmation: the payment service owns
 * `payment.successful` and reports it over the event intake.
 *
 * Dedupe key is the order id, so re-posting the same order never re-emails.
 */
export function notifyPurchaseConfirmed(
  to: string,
  purchase: {
    customerName?: string;
    planName: string;
    amount: string;
    orderId: string;
    purchasedAt: string;
    websiteName?: string;
    currency?: string;
    paymentId?: string;
  },
  customerId?: string,
): void {
  guard('purchase_confirmed', () => {
    const { to: recipient, variables } = target(to, {
      customer_name: purchase.customerName,
      plan_name: purchase.planName,
      amount: purchase.amount,
      order_id: purchase.orderId,
      purchased_at: purchase.purchasedAt,
      website_name: purchase.websiteName,
      currency: purchase.currency,
      payment_id: purchase.paymentId,
    });
    trackPendingMail(() => dispatchEmail({
      eventName: 'website.purchase_confirmed',
      template: 'website.purchase_confirmed',
      to: recipient,
      variables,
      customerId: customerId ?? null,
      dedupeParts: [purchase.orderId],
    }));
  });
}

/** Emitted when a domain is first recorded, or when it changes. */
export function notifyDomainConnected(
  to: string,
  site: { websiteName: string; domain: string },
  customerId?: string,
): void {
  guard('domain_connected', () => {
    const { to: recipient, variables } = target(to, {
      website_name: site.websiteName,
      domain: site.domain,
      website_url: websiteUrl(site.domain),
      status: 'Connected',
    });
    trackPendingMail(() => dispatchEmail({
      eventName: 'website.domain_connected',
      template: 'website.domain_connected',
      to: recipient,
      variables,
      customerId: customerId ?? null,
      dedupeParts: [site.domain],
    }));
  });
}

/** Emitted when a deployment actually completes for the recorded domain. */
export function notifyWebsiteDeployed(
  to: string,
  site: { websiteName: string; domain: string; deploymentId?: string; changedAt?: string },
  customerId?: string,
): void {
  guard('website_deployed', () => {
    const { to: recipient, variables } = target(to, {
      website_name: site.websiteName,
      domain: site.domain,
      website_url: websiteUrl(site.domain),
      deployment_id: site.deploymentId,
      changed_at: site.changedAt ?? new Date().toISOString(),
      status: 'Live',
    });
    trackPendingMail(() => dispatchEmail({
      eventName: 'website.deployed',
      template: 'website.deployed',
      to: recipient,
      variables,
      customerId: customerId ?? null,
      dedupeParts: [site.domain, site.deploymentId ?? 'current'],
    }));
  });
}

/** Emitted when the site is both deployed and serving over TLS. */
export function notifyWebsiteReady(
  to: string,
  site: { websiteName: string; domain: string; orderId?: string },
  customerId?: string,
): void {
  guard('website_ready', () => {
    const { to: recipient, variables } = target(to, {
      website_name: site.websiteName,
      domain: site.domain,
      website_url: websiteUrl(site.domain),
      order_id: site.orderId,
    });
    trackPendingMail(() => dispatchEmail({
      eventName: 'website.ready',
      template: 'website.ready',
      to: recipient,
      variables,
      customerId: customerId ?? null,
      dedupeParts: [site.domain],
    }));
  });
}

export { dispatchEmail };
export type { DispatchResult };
