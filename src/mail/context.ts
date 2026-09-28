import { config } from '../config.js';
import { stripControl } from './safety.js';
import {
  DASHBOARD_DEFAULT_PATH,
  dashboardUrl,
  maintenanceUrl,
  publicSiteUrl,
  supportMailto,
} from './urls.js';

export const EMAIL_VARIABLES = [
  'customer_name',
  'email',
  'website_name',
  'domain',
  'website_url',
  'dashboard_url',
  'public_url',
  'plan_name',
  'amount',
  'currency',
  'order_id',
  'payment_id',
  'order_total',
  'request_id',
  'request_title',
  'request_status',
  'request_summary',
  'request_page',
  'request_priority',
  'request_needed',
  'request_url',
  'maintenance_price',
  'billing_interval',
  'billing_date',
  'next_billing_date',
  'activated_at',
  'purchased_at',
  'changed_at',
  'issued_at',
  'stage',
  'expires_in_hours',
  'failure_reason',
  'refund_amount',
  'receipt_id',
  'reset_url',
  'support_email',
  'sender_name',
  'maintenance_covers',
  'status',
  'deployment_id',
  'alert_summary',
] as const;

export type EmailVariable = (typeof EMAIL_VARIABLES)[number];

export type EmailContext = Record<EmailVariable, string>;

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATETIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  hour12: false,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${DATE_FORMAT.format(date)} (UTC)`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${DATETIME_FORMAT.format(date)} UTC`;
}

export function formatMoney(amount: number | string | null | undefined, currency = 'INR'): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(value)) return '';
  const digits = value % 1 === 0 ? 0 : 2;
  const formatted = new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value);
  if (currency === 'INR') return `₹${formatted}`;
  return `${currency} ${formatted}`;
}

export function buildContext(patch: Partial<EmailContext> = {}): EmailContext {
  const base: EmailContext = {
    customer_name: '',
    email: '',
    website_name: '',
    domain: '',
    website_url: '',
    dashboard_url: dashboardUrl(DASHBOARD_DEFAULT_PATH),
    public_url: publicSiteUrl(),
    plan_name: '',
    amount: '',
    currency: config.maintenanceCurrency,
    order_id: '',
    payment_id: '',
    order_total: '',
    request_id: '',
    request_title: '',
    request_status: '',
    request_summary: '',
    request_page: '',
    request_priority: '',
    request_needed: '',
    request_url: '',
    maintenance_price: formatMoney(config.maintenancePriceInr, config.maintenanceCurrency),
    billing_interval: 'month',
    billing_date: '',
    next_billing_date: '',
    activated_at: '',
    purchased_at: '',
    changed_at: '',
    issued_at: formatDateTime(new Date()),
    stage: '',
    expires_in_hours: '1',
    failure_reason: '',
    refund_amount: '',
    receipt_id: '',
    reset_url: '',
    support_email: config.mailSupportEmail,
    sender_name: config.mailFromName,
    maintenance_covers: '',
    status: '',
    deployment_id: '',
    alert_summary: '',
    ...patch,
  };
  for (const key of Object.keys(base) as EmailVariable[]) {
    base[key] = stripControl(String(base[key] ?? '')).slice(0, 2000);
  }
  return base;
}

const VAR_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function fillVars(template: string, ctx: EmailContext, options: { html?: boolean; escape?: (v: string) => string } = {}): string {
  const raw = String(template ?? '');
  const escaper = options.escape ?? ((v: string) => stripControl(v));
  return raw.replace(VAR_PATTERN, (match, name: string) => {
    const key = name.toLowerCase() as EmailVariable;
    if (!(key in ctx)) return '';
    const value = ctx[key] ?? '';
    return value ? escaper(value) : '';
  });
}

export function unresolvedVars(template: string): string[] {
  const found: string[] = [];
  for (const match of String(template ?? '').matchAll(VAR_PATTERN)) {
    const name = match[1]!.toLowerCase();
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

export { maintenanceUrl, supportMailto, dashboardUrl, publicSiteUrl };
