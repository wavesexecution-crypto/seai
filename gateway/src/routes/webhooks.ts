import { Router } from 'express';
import { REQUIRED_WEBHOOK_TOPICS } from '../services/webhook-registrar.js';
import { sendError, type AppDeps } from './helpers.js';

const REQUIRED_TOPICS = new Set(REQUIRED_WEBHOOK_TOPICS);

export function createWebhooksRouter(deps: AppDeps): Router {
  const { logger, store, shopify, seai } = deps;
  const router = Router();

  router.post('/*', async (req, res) => {
    const rawBody = (Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf-8')) as Buffer;
    let validation: Awaited<ReturnType<AppDeps['shopify']['validateWebhook']>>;
    try {
      validation = await shopify.validateWebhook(rawBody, req);
    } catch {
      // Scaffold mode (feature secrets absent): the unconfigured stand-in
      // throws instead of verifying. Never hang — answer 503 explicitly.
      sendError(res, 503, 'webhooks_not_configured', 'Webhook verification is not configured.');
      return;
    }
    if (!validation.valid) {
      logger.warn({ reason: validation.reason }, 'webhook rejected (HMAC)');
      sendError(res, 401, 'invalid_hmac', 'Webhook signature verification failed.');
      return;
    }
    const fromQuery = typeof req.query.topic === 'string' ? req.query.topic : undefined;
    const topic = topicFromHeaderOrQuery(req, fromQuery ?? validation.topic);
    if (!topic || !REQUIRED_TOPICS.has(topic)) {
      sendError(res, 404, 'unknown_topic', 'This webhook topic is not handled.');
      return;
    }
    const shop = validation.domain;
    const webhookId = validation.webhookId;
    if (!shop || !webhookId) {
      sendError(res, 400, 'invalid_webhook', 'Webhook is missing shop or id.');
      return;
    }
    const delivery = {
      shopDomain: shop,
      topic,
      webhookId,
      apiVersion: validation.apiVersion,
      deliveredAt: new Date(),
      attempts: 1,
    };
    const isNew = await store.recordWebhookDelivery(delivery);
    if (!isNew) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    try {
      await handleTopic(topic, shop, rawBody, seai, store, logger);
      await store.updateWebhookDelivery(
        { shopDomain: shop, topic, webhookId },
        { attempts: 1, lastStatus: 200, processedAt: new Date() },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.updateWebhookDelivery(
        { shopDomain: shop, topic, webhookId },
        { attempts: 1, lastStatus: 500, lastError: message },
      );
      logger.error({ shopDomain: shop, topic, err: message }, 'webhook handler failed');
      res.status(200).json({ ok: true, deferred: true });
    }
  });

  return router;
}

async function handleTopic(
  topic: string,
  shop: string,
  rawBody: Buffer,
  seai: AppDeps['seai'],
  store: AppDeps['store'],
  logger: AppDeps['logger'],
): Promise<void> {
  const now = new Date();
  switch (topic) {
    case 'app/uninstalled': {
      await store.deleteSession(shop);
      await store.deleteMachineToken(shop);
      const existing = await store.findStore(shop);
      if (existing) {
        await store.saveStore({ ...existing, linkState: 'revoked', seaiMachineTokenHash: undefined, updatedAt: now });
      }
      try {
        await seai.notifyStoreRevoked(shop, 'uninstalled');
      } catch (err) {
        logger.error({ shopDomain: shop, err: err instanceof Error ? err.message : String(err) }, 'uninstall notify failed');
      }
      return;
    }
    case 'app/update': {
      logger.info({ shopDomain: shop }, 'app/update received; scopes reconciled on next proxy call');
      return;
    }
    case 'shop/update': {
      const payload = parseJson(rawBody) as { name?: unknown };
      const existing = await store.findStore(shop);
      const storeName = typeof payload?.name === 'string' ? payload.name : existing?.storeName;
      if (existing) {
        await store.saveStore({ ...existing, storeName, updatedAt: now });
      } else {
        await store.saveStore({ shopDomain: shop, linkState: 'pending', storeName, createdAt: now, updatedAt: now });
      }
      return;
    }
    case 'customers/data_request': {
      await seai.forwardCustomerDataRequest(shop, parseJson(rawBody));
      return;
    }
    case 'customers/redact':
    case 'shop/redact': {
      if (topic === 'shop/redact') {
        await store.deleteSession(shop);
        await store.deleteMachineToken(shop);
        await store.deleteStore(shop);
      }
      await seai.forwardCustomerRedact(shop, parseJson(rawBody));
      return;
    }
    default:
      return;
  }
}

function parseJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf-8')) as unknown;
  } catch {
    return {};
  }
}

const HEADER_TOPIC_ALIASES: Record<string, string> = {
  APP_UNINSTALLED: 'app/uninstalled',
  APP_UPDATE: 'app/update',
  SHOP_UPDATE: 'shop/update',
  CUSTOMERS_DATA_REQUEST: 'customers/data_request',
  CUSTOMERS_REDACT: 'customers/redact',
  SHOP_REDACT: 'shop/redact',
};

function topicFromHeaderOrQuery(req: { headers: Record<string, unknown> }, fallback: string): string | undefined {
  const header = req.headers['x-shopify-topic'];
  const raw = typeof header === 'string' ? header.trim() : '';
  if (raw.length > 0) {
    const upper = raw.toUpperCase();
    if (HEADER_TOPIC_ALIASES[upper]) return HEADER_TOPIC_ALIASES[upper];
    const lowered = raw.toLowerCase().replace(/_/g, '/');
    if ((REQUIRED_WEBHOOK_TOPICS as readonly string[]).includes(lowered)) return lowered;
  }
  return fallback;
}