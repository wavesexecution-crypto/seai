import { config } from '../config.js';

export class EmailSafetyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmailSafetyError';
    this.code = code;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f]", "g");

export function stripControl(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(stripControl(String(value ?? '')));
}

const PRIVATE_HOSTS = new Set(['localhost', '0.0.0.0', '::1', '[::1]', '127.0.0.1', 'host.docker.internal']);
const PREVIEW_HOST_SUFFIXES = ['.vercel.app', '.now.sh', '.ngrok.io', '.trycloudflare.com', '.local', '.localhost', '.internal'];
const ALLOWED_PROTOCOLS = new Set(['https:', 'mailto:']);

export interface UrlOptions {
  label?: string;
  allowHttp?: boolean;
  allowMailto?: boolean;
}

export function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTS.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (PREVIEW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (!host.includes('.')) return true;
  return false;
}

export function isSafeUrl(raw: string, opts: UrlOptions = {}): boolean {
  try {
    return parseSafeUrl(raw, opts) !== null;
  } catch {
    return false;
  }
}

export function parseSafeUrl(raw: string, opts: UrlOptions = {}): URL | null {
  const label = opts.label ?? 'link';
  const input = stripControl(String(raw ?? '')).trim();
  if (!input) throw new EmailSafetyError('URL_EMPTY', `${label} URL is empty`);
  if (input.length > 2048) throw new EmailSafetyError('URL_TOO_LONG', `${label} URL exceeds 2048 characters`);
  if (input.includes('\\')) throw new EmailSafetyError('URL_BACKSLASH', `${label} URL contains a backslash`);
  if (input.startsWith('//')) throw new EmailSafetyError('URL_PROTOCOL_RELATIVE', `${label} URL is protocol-relative`);

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new EmailSafetyError('URL_MALFORMED', `${label} URL is not a valid absolute URL`);
  }

  if (parsed.username || parsed.password) {
    throw new EmailSafetyError('URL_CREDENTIALS', `${label} URL must not embed credentials`);
  }
  if (parsed.protocol === 'mailto:') {
    if (!opts.allowMailto) throw new EmailSafetyError('URL_PROTOCOL', `${label} URL protocol mailto: is not allowed here`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parsed.pathname)) {
      throw new EmailSafetyError('URL_MAILTO', `${label} mailto address is invalid`);
    }
    return parsed;
  }
  if (parsed.protocol === 'http:' && opts.allowHttp) {
    if (isUnsafeHost(parsed.hostname) && !devUrlsAllowed()) {
      throw new EmailSafetyError('URL_PRIVATE_HOST', `${label} URL points at a private host`);
    }
    return parsed;
  }
  if (parsed.protocol !== 'https:') {
    throw new EmailSafetyError('URL_PROTOCOL', `${label} URL must use https://`);
  }
  if (isUnsafeHost(parsed.hostname) && !devUrlsAllowed()) {
    throw new EmailSafetyError('URL_PRIVATE_HOST', `${label} URL points at a private or preview host`);
  }
  return parsed;
}

export function safeUrl(raw: string, opts: UrlOptions = {}): string {
  const parsed = parseSafeUrl(raw, opts);
  if (!parsed) throw new EmailSafetyError('URL_MALFORMED', `${opts.label ?? 'link'} URL is invalid`);
  return parsed.toString();
}

export function devUrlsAllowed(): boolean {
  return config.mailAllowDevUrls;
}

const SECRET_VALUE_PATTERNS: { name: string; value: string }[] = [
  { name: 'MAIL_SMTP_PASS', value: config.smtp.pass },
  { name: 'SEAI_ENCRYPTION_KEY', value: config.encryptionKey },
  { name: 'SEAI_GATEWAY_SECRET', value: config.gatewaySecret },
  { name: 'SEAI_EVENTS_SHARED_SECRET', value: config.eventsSharedSecret },
  { name: 'EXPLABS_API_KEY', value: config.experKey },
  { name: 'SHOPIFY_API_SECRET', value: config.shopify.apiSecret },
  { name: 'SHOPIFY_API_KEY', value: config.shopify.apiKey },
  ...config.ollamaKeys.map((value, index) => ({ name: `OLLAMA_API_KEY_${index + 1}`, value })),
];

// `severity: high` shapes cannot legitimately appear in customer email copy, so
// a match is a hard failure. `low` shapes are still detected and redacted, but
// never block a send: ordinary sentences ("copy this link into") can match them.
const SECRET_SHAPE_PATTERNS: { name: string; re: RegExp; severity: 'high' | 'low' }[] = [
  { name: 'private_key', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, severity: 'high' },
  { name: 'stripe_secret', re: /\bsk_live_[A-Za-z0-9]{10,}/, severity: 'high' },
  { name: 'stripe_test', re: /\bsk_test_[A-Za-z0-9]{16,}/, severity: 'high' },
  { name: 'razorpay_key', re: /\brzp_(?:live|test)_[A-Za-z0-9]{10,}/, severity: 'high' },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, severity: 'high' },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/, severity: 'high' },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_\-]{30,}/, severity: 'high' },
  { name: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, severity: 'high' },
  { name: 'smtp_app_password', re: /\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/, severity: 'low' },
  { name: 'authorization_header', re: /\bAuthorization:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/i, severity: 'high' },
  { name: 'env_assignment', re: /\b(?:SMTP_PASS|MAIL_SMTP_PASS|API_KEY|SECRET|PASSWORD)\s*=\s*\S{8,}/i, severity: 'high' },
];

export interface SecretFinding {
  name: string;
  where: string;
  confidence: 'high' | 'low';
}

export function findSecrets(value: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, value: secret } of SECRET_VALUE_PATTERNS) {
    if (secret && secret.length >= 8 && value.includes(secret)) findings.push({ name, where: 'config-value', confidence: 'high' });
  }
  for (const { name, re, severity } of SECRET_SHAPE_PATTERNS) {
    if (re.test(value)) findings.push({ name, where: 'pattern', confidence: severity });
  }
  return findings;
}

export function assertNoSecrets(value: string, where = 'rendered email'): void {
  const findings = findSecrets(value).filter((f) => f.confidence === 'high');
  if (findings.length > 0) {
    const names = [...new Set(findings.map((f) => f.name))].join(', ');
    throw new EmailSafetyError('SECRET_LEAK', `${where} matched secret material (${names})`);
  }
}

export function redactSecrets(value: string, max = 200): string {
  let out = stripControl(String(value ?? '')).slice(0, max);
  for (const { name, value: secret } of SECRET_VALUE_PATTERNS) {
    if (secret && secret.length >= 8 && out.includes(secret)) out = out.split(secret).join(`[redacted:${name}]`);
  }
  for (const { name, re } of SECRET_SHAPE_PATTERNS) {
    if (re.test(out)) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), `[redacted:${name}]`);
  }
  return out;
}

export function subjectSafe(value: string): string {
  return stripControl(String(value ?? ''))
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 200);
}
