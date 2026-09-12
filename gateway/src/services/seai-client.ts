/**
 * HTTP client for the EXISTING SEAI backend (the source of truth).
 *
 * All calls are server-to-server. The gateway never forwards Shopify access
 * tokens to SEAI, and never forwards SEAI credentials to Shopify.
 *
 * When SEAI_API_BASE_URL is not configured (local dev/tests), a harmless
 * no-op client is returned so the rest of the gateway keeps working; the
 * caller is warned once.
 */

import type { AppConfig } from '../config.js';
import type { AppLogger } from '../logger.js';

export interface SeaiClient {
  /** Notify SEAI a store became linked (so it can finish provisioning). */
  notifyStoreLinked(shopDomain: string, seaiAccountId: string): Promise<void>;
  /** Notify SEAI a store was uninstalled/revoked so it pauses autonomy. */
  notifyStoreRevoked(
    shopDomain: string,
    reason: 'uninstalled' | 'revoked',
  ): Promise<void>;
  /** Ship a GDPR customer data request to SEAI (no second data system here). */
  forwardCustomerDataRequest(
    shopDomain: string,
    payload: unknown,
  ): Promise<void>;
  /** Ship a GDPR customer redaction to SEAI. */
  forwardCustomerRedact(shopDomain: string, payload: unknown): Promise<void>;
}

export class SeaiClientError extends Error {
  override readonly name = 'SeaiClientError';
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createSeaiClient(config: AppConfig, logger: AppLogger): SeaiClient {
  const baseUrl = config.seaiApiBaseUrl;
  if (!baseUrl) {
    logger.warn('SEAI_API_BASE_URL is not set; SeaiClient is running in no-op mode.');
    return createNoopSeaiClient();
  }
  const normalized = baseUrl.replace(/\/+$/, '');

  async function post(path: string, body: unknown): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${normalized}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Never log the body: it may echo customer data.
        logger.error(
          { status: res.status, path, bodyPreviewLength: text.length },
          'SEAI backend request failed',
        );
        throw new SeaiClientError(`SEAI backend responded ${res.status} on ${path}`, res.status);
      }
    } catch (err) {
      if (err instanceof SeaiClientError) throw err;
      throw new SeaiClientError(
        `SEAI backend request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async notifyStoreLinked(shopDomain: string, seaiAccountId: string): Promise<void> {
      await post('/integration/stores/linked', { shopDomain, seaiAccountId });
    },
    async notifyStoreRevoked(shopDomain: string, reason: 'uninstalled' | 'revoked'): Promise<void> {
      await post('/integration/stores/revoked', { shopDomain, reason });
    },
    async forwardCustomerDataRequest(shopDomain: string, payload: unknown): Promise<void> {
      await post('/integration/gdpr/data-request', { shopDomain, payload });
    },
    async forwardCustomerRedact(shopDomain: string, payload: unknown): Promise<void> {
      await post('/integration/gdpr/customer-redact', { shopDomain, payload });
    },
  };
}

function createNoopSeaiClient(): SeaiClient {
  return {
    async notifyStoreLinked(): Promise<void> {
      return undefined;
    },
    async notifyStoreRevoked(): Promise<void> {
      return undefined;
    },
    async forwardCustomerDataRequest(): Promise<void> {
      return undefined;
    },
    async forwardCustomerRedact(): Promise<void> {
      return undefined;
    },
  };
}