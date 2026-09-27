import { config } from '../config.js';
import { isMailConfigured, sendMail } from './transport.js';
import {
  welcomeEmail,
  changeRequestReceivedEmail,
  changeRequestCompletedEmail,
  maintenanceActivatedEmail,
  waitingForClientEmail,
} from './templates.js';

// Fire-and-forget customer notifications. Never throws: a mail failure must
// never break the request that triggered it. Silent when mail is not
// configured (local dev without credentials).
function appUrl(): string {
  return config.appUrl.replace(/\/$/, '');
}

async function trySend(to: string, kind: string, make: () => { subject: string; html: string; text: string }): Promise<void> {
  if (!isMailConfigured()) return;
  try {
    const mail = make();
    await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
  } catch (err) {
    console.error(`[mail] ${kind} to ${to} failed:`, (err as Error).message);
  }
}

export function notifyWelcome(to: string, name: string): void {
  void trySend(to, 'welcome', () => welcomeEmail(name, `${appUrl()}/overview`));
}

export function notifyChangeReceived(to: string, title: string, page: string, priority: string, requestId: string): void {
  void trySend(to, 'change-received', () =>
    changeRequestReceivedEmail(title, page, priority, `${appUrl()}/modify?id=${encodeURIComponent(requestId)}`));
}

export function notifyChangeCompleted(to: string, title: string, requestId: string): void {
  void trySend(to, 'change-completed', () =>
    changeRequestCompletedEmail(title, `${appUrl()}/modify?id=${encodeURIComponent(requestId)}`));
}

export function notifyMaintenanceRequested(to: string, planName: string, priceInr: number): void {
  void trySend(to, 'maintenance-requested', () =>
    maintenanceActivatedEmail(planName, priceInr, `${appUrl()}/maintenance`));
}

export function notifyWaitingForClient(to: string, title: string, requestId: string, context: string): void {
  void trySend(to, 'waiting-for-client', () =>
    waitingForClientEmail(title, context, `${appUrl()}/modify?id=${encodeURIComponent(requestId)}`));
}
