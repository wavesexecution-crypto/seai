/**
 * Shopify GraphQL Admin API transport used by the proxy route (Phase 4).
 *
 * Rules enforced here:
 *  - The Admin API version is pinned to exactly 2025-07 (SEAI backend
 *    contract). No other version can be requested.
 *  - The Shopify access token is carried ONLY in the outbound request header
 *    and is never logged, echoed, or returned.
 *  - Shopify's rate-limit headers are parsed and surfaced; 429 / transient
 *    5xx responses are retried with `Retry-After` / capped backoff ONLY when
 *    it is safe to retry (429 with explicit Retry-After, or transient 5xx).
 *  - GraphQL errors from Shopify are preserved verbatim (never flattened into
 *    a misleading generic error).
 */

import { PINNED_API_VERSION, type AppConfig } from '../config.js';
import type { AppLogger } from '../logger.js';

export interface ProxyResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export class GraphqlTransportError extends Error {
  override readonly name = 'GraphqlTransportError';
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface GraphqlTransport {
  proxy(
    shopDomain: string,
    accessToken: string,
    body: unknown,
    opts?: { requestId?: string },
  ): Promise<ProxyResult>;
}

const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 15_000;

export function createGraphqlTransport(config: AppConfig, _logger: AppLogger): GraphqlTransport {
  const version = config.shopifyApiVersion; // always 2025-07 by config validation
  if (version !== PINNED_API_VERSION) {
    throw new Error(`GraphQL transport requires API version ${PINNED_API_VERSION}`);
  }

  async function proxy(
    shopDomain: string,
    accessToken: string,
    body: unknown,
    opts?: { requestId?: string },
  ): Promise<ProxyResult> {
    const requestId = opts?.requestId ?? 'unknown';
    const url = `https://${shopDomain}/admin/api/${version}/graphql.json`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
          ...(requestId ? { 'X-Request-Id': requestId } : {}),
        },
        body: JSON.stringify(body),
      });

      if (res.status >= 200 && res.status < 300) {
        return {
          status: res.status,
          headers: pickHeaders(res.headers),
          body: await readJson(res),
        };
      }

      const retryAfterRaw = res.headers.get('retry-after');
      const retryable =
        res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (!retryable || attempt === MAX_RETRIES) {
        return {
          status: res.status,
          headers: pickHeaders(res.headers),
          body: await readJson(res),
        };
      }

      const retryAfterMs =
        retryAfterRaw !== null
          ? Math.min(parseInt(retryAfterRaw, 10) * 1000 || 1000, MAX_RETRY_AFTER_MS)
          : Math.min(100 * 2 ** attempt, MAX_RETRY_AFTER_MS);
      await sleep(retryAfterMs);
    }
    throw new GraphqlTransportError('Proxy retry loop exhausted', 502);
  }

  return { proxy };
}

function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

/** Forward only a small set of response headers (never auth/set-cookie). */
function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [
    'x-request-id',
    'x-shopify-shop-api-call-limit',
    'x-shopify-api-call-limit',
    'content-type',
  ]) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}