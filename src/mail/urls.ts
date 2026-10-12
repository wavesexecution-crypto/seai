import { config } from '../config.js';
import { EmailSafetyError, devUrlsAllowed, isUnsafeHost, safeUrl, stripControl } from './safety.js';

export const DASHBOARD_DEFAULT_PATH = '/overview';

function base(raw: string, label: string): string {
  const value = stripControl(String(raw ?? '')).replace(/\/+$/, '');
  if (!value) throw new EmailSafetyError('URL_EMPTY', `${label} base URL is not configured`);
  if (isUnsafeHost(safeHost(value)) && !devUrlsAllowed()) {
    throw new EmailSafetyError(
      'URL_PRIVATE_HOST',
      `${label} base URL must be a production host (received a private or preview host)`,
    );
  }
  return value;
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^[a-z]+:\/\//i, '').split('/')[0]!.split(':')[0]!;
  }
}

function join(value: string, path: string): string {
  const clean = stripControl(String(path ?? '')).trim();
  if (!clean || clean === '/') return value;
  return `${value}/${clean.replace(/^\/+/, '')}`;
}

// Dashboard/public links are https in production. The documented dev escape
// hatch (SEAI_MAIL_ALLOW_DEV_URLS) is what permits http:// during local runs.
function link(value: string, label: string): string {
  return safeUrl(value, { label, allowHttp: devUrlsAllowed() });
}

export function dashboardBase(): string {
  return base(config.appUrl, 'Dashboard');
}

export function publicSiteBase(): string {
  return base(config.publicUrl, 'Public site');
}

export function dashboardUrl(path: string = DASHBOARD_DEFAULT_PATH): string {
  return link(join(dashboardBase(), path), 'Dashboard');
}

export function publicSiteUrl(path = ''): string {
  return link(join(publicSiteBase(), path), 'Public site');
}

export function passwordResetUrl(token: string): string {
  const value = stripControl(String(token ?? '')).trim();
  if (!value) throw new EmailSafetyError('RESET_TOKEN_MISSING', 'Password reset token is missing');
  return link(`${dashboardUrl('/reset-password')}?token=${encodeURIComponent(value)}`, 'Password reset');
}

export function verifyEmailUrl(token: string): string {
  const value = stripControl(String(token ?? '')).trim();
  if (!value) throw new EmailSafetyError('VERIFY_TOKEN_MISSING', 'Verification token is missing');
  return link(`${dashboardUrl('/verify-email')}?token=${encodeURIComponent(value)}`, 'Email verification');
}

export function changeRequestUrl(requestId: string): string {
  const id = stripControl(String(requestId ?? '')).trim();
  if (!id) throw new EmailSafetyError('REQUEST_ID_MISSING', 'Change request id is missing');
  return safeUrl(`${dashboardUrl('/modify')}?id=${encodeURIComponent(id)}`, { label: 'Change request' });
}

export function maintenanceUrl(): string {
  return dashboardUrl('/maintenance');
}

export function domainsUrl(): string {
  return dashboardUrl('/domains');
}

export function performanceUrl(): string {
  return dashboardUrl('/performance');
}

export function supportUrl(): string {
  return publicSiteUrl('/support');
}

export function privacyUrl(): string {
  return publicSiteUrl('/privacy');
}

export function termsUrl(): string {
  return publicSiteUrl('/terms');
}

export function supportMailto(): string {
  return safeUrl(`mailto:${config.mailSupportEmail}`, { label: 'Support', allowMailto: true });
}

export function logoUrl(): string | null {
  const raw = stripControl(String(config.mailLogoUrl ?? '')).trim();
  if (!raw) return null;
  try {
    return safeUrl(raw, { label: 'Logo' });
  } catch {
    return null;
  }
}

export function websiteUrl(domain: string): string {
  const host = stripControl(String(domain ?? '')).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) throw new EmailSafetyError('WEBSITE_DOMAIN_MISSING', 'Website domain is not recorded yet');
  if (isUnsafeHost(host)) throw new EmailSafetyError('WEBSITE_DOMAIN_UNSAFE', 'Website domain is not a public host');
  return safeUrl(`https://${host}`, { label: 'Website' });
}

export function emailEnvironmentReport(): {
  dashboard: string;
  publicSite: string;
  logo: string | null;
  support: string;
  devUrlsAllowed: boolean;
} {
  let dashboard = 'invalid';
  try {
    dashboard = dashboardBase();
  } catch (err) {
    dashboard = `invalid: ${(err as Error).message}`;
  }
  let publicSite = 'invalid';
  try {
    publicSite = publicSiteBase();
  } catch (err) {
    publicSite = `invalid: ${(err as Error).message}`;
  }
  return {
    dashboard,
    publicSite,
    logo: logoUrl(),
    support: config.mailSupportEmail,
    devUrlsAllowed: devUrlsAllowed(),
  };
}
