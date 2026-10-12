/**
 * Centralised, strictly-typed environment configuration for the SEAI Shopify
 * Gateway.
 *
 * The gateway boots without requiring feature secrets (SHOPIFY_API_SECRET,
 * SESSION_STORAGE_KEY, ...) so health endpoints and the memory-backed dev
 * path work immediately. Features that depend on those secrets call
 * `requireSecret` at the exact point of use (never at import time).
 *
 * Phase 0 decision carried here and enforced: the Shopify Admin API version
 * is pinned to exactly 2025-07 to match the SEAI backend (source of truth).
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

const NODE_ENVS: ReadonlySet<string> = new Set(['development', 'test', 'production']);
const LOG_LEVELS: ReadonlySet<string> = new Set([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

/** Shopify Admin API version pinned to the SEAI backend contract (2025-07). */
export const PINNED_API_VERSION = '2025-07';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly shopifyApiKey: string | undefined;
  readonly shopifyApiSecret: string | undefined;
  readonly shopifyApiScopes: readonly string[] | undefined;
  readonly shopifyApiVersion: string;
  readonly shopifyAppUrl: string | undefined;
  readonly seaiBaseUrl: string | undefined;
  readonly seaiApiBaseUrl: string | undefined;
  readonly seaiWebhookSecret: string | undefined;
  readonly sessionStorageKey: string | undefined;
  readonly gatewayTokenSigningKey: string | undefined;
  readonly databaseUrl: string | undefined;
  readonly redisUrl: string | undefined;
  readonly sentryDsn: string | undefined;
  /** Short-lived gateway-token TTL (seconds) for SEAI-backend proxy auth. */
  readonly gatewayTokenTtlSeconds: number;
  /** Per-shop GraphQL proxy rate limit (requests per minute). */
  readonly proxyRateLimitPerMinute: number;
  /** Short-lived SEAI link claim TTL (seconds). */
  readonly seaiLinkTtlSeconds: number;
  /** Short-lived SEAI ticket TTL (seconds) handed to the iframe. */
  readonly seaiTicketTtlSeconds: number;
  /** Comma-separated CORS allow-list for server-to-server browser exposure. */
  readonly corsAllowedOrigins: readonly string[];
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function toOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`Invalid PORT "${raw ?? ''}": expected an integer in 1-65535.`);
  }
  return port;
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  const value = raw?.trim() || 'development';
  if (!NODE_ENVS.has(value)) {
    throw new ConfigError(`Invalid NODE_ENV "${value}": expected development|test|production.`);
  }
  return value as NodeEnv;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim() || 'info';
  if (!LOG_LEVELS.has(value)) {
    throw new ConfigError(
      `Invalid LOG_LEVEL "${value}": expected fatal|error|warn|info|debug|trace|silent.`,
    );
  }
  return value as LogLevel;
}

function parseScopes(raw: string | undefined): readonly string[] | undefined {
  const value = toOptionalString(raw);
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse a positive integer with an optional default. Throws ConfigError on
 * non-numeric, zero, or negative input.
 */
function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  const value = Number(raw?.trim() || String(fallback));
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`Invalid ${name} "${raw ?? ''}": expected a positive integer.`);
  }
  return value;
}

function parseCorsOrigins(raw: string | undefined): readonly string[] {
  const value = toOptionalString(raw);
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Loads and validates configuration from process env. Fail-fast on malformed
 * values so misconfiguration surfaces at boot instead of mid-request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiVersion = env.SHOPIFY_API_VERSION?.trim() || PINNED_API_VERSION;
  if (apiVersion !== PINNED_API_VERSION) {
    throw new ConfigError(
      `Invalid SHOPIFY_API_VERSION "${apiVersion}": pinned to exactly ${PINNED_API_VERSION} to match the SEAI backend contract.`,
    );
  }
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    port: parsePort(env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    shopifyApiKey: toOptionalString(env.SHOPIFY_API_KEY),
    shopifyApiSecret: toOptionalString(env.SHOPIFY_API_SECRET),
    shopifyApiScopes: parseScopes(env.SHOPIFY_API_SCOPES),
    shopifyApiVersion: apiVersion,
    shopifyAppUrl: toOptionalString(env.SHOPIFY_APP_URL),
    seaiBaseUrl: toOptionalString(env.SEAI_BASE_URL),
    seaiApiBaseUrl: toOptionalString(env.SEAI_API_BASE_URL),
    seaiWebhookSecret: toOptionalString(env.SEAI_WEBHOOK_SECRET),
    sessionStorageKey: toOptionalString(env.SESSION_STORAGE_KEY),
    gatewayTokenSigningKey: toOptionalString(env.GATEWAY_TOKEN_SIGNING_KEY),
    databaseUrl: toOptionalString(env.DATABASE_URL),
    redisUrl: toOptionalString(env.REDIS_URL),
    sentryDsn: toOptionalString(env.SENTRY_DSN),
    gatewayTokenTtlSeconds: parsePositiveInt(
      env.GATEWAY_TOKEN_TTL_SECONDS,
      'GATEWAY_TOKEN_TTL_SECONDS',
      300,
    ),
    proxyRateLimitPerMinute: parsePositiveInt(
      env.SHOPIFY_PROXY_RATE_LIMIT_PER_MINUTE,
      'SHOPIFY_PROXY_RATE_LIMIT_PER_MINUTE',
      240,
    ),
    seaiLinkTtlSeconds: parsePositiveInt(env.SEAI_LINK_TTL_SECONDS, 'SEAI_LINK_TTL_SECONDS', 300),
    seaiTicketTtlSeconds: parsePositiveInt(
      env.SEAI_TICKET_TTL_SECONDS,
      'SEAI_TICKET_TTL_SECONDS',
      300,
    ),
    corsAllowedOrigins: parseCorsOrigins(env.CORS_ALLOWED_ORIGINS),
  };
}

/**
 * Throw if a secret required by a later phase is missing. Not called during
 * scaffold boot; used by the phase that actually reads the secret.
 */
export function requireSecret(value: string | undefined, name: string): string {
  if (!value) {
    throw new ConfigError(`Missing required secret "${name}". Set it in the environment.`);
  }
  return value;
}