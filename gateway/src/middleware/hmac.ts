import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppLogger } from '../logger.js';
import type { ShopifyHandle } from '../services/shopify.js';

declare global {
  namespace Express {
    interface Request {
      /** Verified webhook metadata (set by createHmacMiddleware). */
      webhookVerification?: {
        topic: string;
        shopDomain: string;
        apiVersion: string;
        webhookId: string;
      };
    }
  }
}

export interface HmacMiddlewareDeps {
  readonly logger: AppLogger;
  readonly shopify: ShopifyHandle;
}

/**
 * Verifies Shopify webhook deliveries.
 *
 * Requires the RAW request body (the HMAC is computed over the raw bytes), so
 * the webhooks router must be mounted with `express.raw(...)` BEFORE the
 * app-wide `express.json()` parser. Verification uses the official
 * `shopify.webhooks.validate` primitive (HMAC + required webhook headers) and
 * rejects invalid requests with 401 before any handler runs.
 */
export function createWebhookVerificationMiddleware(deps: HmacMiddlewareDeps): RequestHandler {
  const { shopify, logger } = deps;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      logger.warn({ requestId: req.requestId }, 'webhook rejected: empty or non-raw body');
      res.status(401).json({ ok: false, error: 'invalid_webhook' });
      return;
    }
    const result = await shopify.validateWebhook(req.body, req);
    if (!result.valid) {
      logger.warn(
        { requestId: req.requestId, reason: result.reason },
        'webhook rejected: invalid HMAC/headers',
      );
      res.status(401).json({ ok: false, error: 'invalid_webhook' });
      return;
    }
    req.webhookVerification = {
      topic: result.topic,
      shopDomain: result.domain,
      apiVersion: result.apiVersion,
      webhookId: result.webhookId,
    };
    next();
  };
}