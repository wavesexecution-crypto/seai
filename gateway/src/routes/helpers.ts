import type { Response } from 'express';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../logger.js';
import type { ShopifyHandle } from '../services/shopify.js';
import type { DataStore } from '../services/data-store.js';
import type { CryptoBox } from '../services/crypto.js';
import type { TicketService } from '../services/ticket.js';
import type { GatewayTokenService } from '../services/gateway-token.js';
import type { SeaiClient } from '../services/seai-client.js';
import type { GraphqlTransport } from '../services/graphql.js';
import type { WebhookRegistrar } from '../services/webhook-registrar.js';
import type { TokenBucketStore } from '../services/rate-limiter.js';

/** Everything a route handler needs (one shared dependency bag). */
export interface AppDeps {
  readonly config: AppConfig;
  readonly logger: AppLogger;
  readonly shopify: ShopifyHandle;
  readonly store: DataStore;
  readonly crypto: CryptoBox;
  readonly tickets: TicketService;
  readonly gatewayTokens: GatewayTokenService;
  readonly seai: SeaiClient;
  readonly graphql: GraphqlTransport;
  readonly webhookRegistrar: WebhookRegistrar;
  readonly proxyRateLimiter: TokenBucketStore;
}

/**
 * Routes that are still stubs (later phases) share the same dependency bag so
 * upgrading them is a pure handler swap with no re-wiring.
 */
export type RouteDeps = AppDeps;

/** Consistent machine-readable error shape. */
export function sendError(
  res: Response,
  status: number,
  error: string,
  message: string,
): void {
  res.status(status).json({ ok: false, error, message });
}

/** Consistent placeholder response for features scheduled in a later phase. */
export function notImplemented(res: Response, feature: string): void {
  res.status(501).json({
    ok: false,
    error: 'not_implemented',
    feature,
    message: 'This capability is scheduled for a later implementation phase.',
  });
}
