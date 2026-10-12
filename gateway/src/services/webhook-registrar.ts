/**
 * Webhook subscription registrar (Phase 5).
 *
 * Registers the required lifecycle + GDPR webhook subscriptions per store via
 * the Shopify GraphQL Admin API at install time (runtime registration — the
 * shopify.app.toml intentionally carries no static subscriptions; the gateway
 * endpoint URL is dynamic until the production hostname exists).
 *
 * Topics requested here come from the approved Phase-0/plan scope hygiene:
 * lifecycle + GDPR topics only. Optional data topics are NOT auto-registered;
 * each SEAI tool that consumes them opts in explicitly (see plan §10/§19).
 */

import { PINNED_API_VERSION, requireSecret, type AppConfig } from '../config.js';
import type { AppLogger } from '../logger.js';

export const WEBHOOK_CALLBACK_PATH = '/webhooks';

/** Lifecycle + GDPR topics registered at install time. */
export const REQUIRED_WEBHOOK_TOPICS: readonly string[] = Object.freeze([
  'app/uninstalled',
  'app/update',
  'shop/update',
  'customers/data_request',
  'customers/redact',
  'shop/redact',
]);

/** Data topics available for opt-in when an SEAI tool declares them. */
export const OPTIONAL_WEBHOOK_TOPICS: readonly string[] = Object.freeze([
  'orders/create',
  'orders/updated',
  'orders/fulfilled',
  'orders/cancelled',
  'products/update',
  'inventory_levels/update',
  'app/scopes_update',
  'fulfillment_orders/fulfillment_request_accepted',
]);

export interface WebhookRegistrationResult {
  readonly topic: string;
  readonly success: boolean;
  readonly userErrors: readonly string[];
}

export interface WebhookRegistrar {
  registerRequired(
    shopDomain: string,
    accessToken: string,
  ): Promise<readonly WebhookRegistrationResult[]>;
  registerTopics(
    shopDomain: string,
    accessToken: string,
    topics: readonly string[],
  ): Promise<readonly WebhookRegistrationResult[]>;
}

export function createWebhookRegistrar(
  config: AppConfig,
  logger: AppLogger,
): WebhookRegistrar {
  const appUrl = requireSecret(config.shopifyAppUrl, 'SHOPIFY_APP_URL');
  const callbackUrl = `${appUrl.replace(/\/+$/, '')}/webhooks`;

  async function registerTopics(
    shopDomain: string,
    accessToken: string,
    topics: readonly string[],
  ): Promise<readonly WebhookRegistrationResult[]> {
    const results: WebhookRegistrationResult[] = [];
    for (const topic of topics) {
      results.push(await registerOne(shopDomain, accessToken, topic));
    }
    return results;
  }

  async function registerOne(
    shopDomain: string,
    accessToken: string,
    topic: string,
  ): Promise<WebhookRegistrationResult> {
    const query = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $callbackUrl }) {
          userErrors { message }
          webhookSubscription { id }
        }
      }`;
    try {
      const res = await fetch(
        `https://${shopDomain}/admin/api/${PINNED_API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query,
            variables: { topic, callbackUrl },
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        data?: {
          webhookSubscriptionCreate?: {
            userErrors?: Array<{ message?: string }>;
          };
        };
      };
      const userErrors = (json.data?.webhookSubscriptionCreate?.userErrors ?? []).map(
        (e) => e.message ?? 'unknown error',
      );
      const success = userErrors.length === 0;
      if (!success) {
        logger.error({ shopDomain, topic, userErrors }, 'webhook registration failed');
      }
      return { topic, success, userErrors };
    } catch (err) {
      logger.error(
        { shopDomain, topic, err: err instanceof Error ? err.message : String(err) },
        'webhook registration request failed',
      );
      return {
        topic,
        success: false,
        userErrors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  return {
    async registerRequired(
      shopDomain: string,
      accessToken: string,
    ): Promise<readonly WebhookRegistrationResult[]> {
      return registerTopics(shopDomain, accessToken, REQUIRED_WEBHOOK_TOPICS);
    },
    registerTopics,
  };
}