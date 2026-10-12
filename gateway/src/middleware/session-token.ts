import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppLogger } from '../logger.js';
import type { ShopifyHandle } from '../services/shopify.js';
import type { DataStore, StoredSession } from '../services/data-store.js';

declare global {
  namespace Express {
    interface Request {
      /** Canonical `{shop}.myshopify.com` after session-token validation. */
      shop: string;
      /** Shopify staff member id from the verified session token. */
      shopifyUserId: string;
      /** Encrypted store session row (token stays ciphertext here). */
      storeSession: StoredSession;
    }
  }
}

export interface SessionTokenMiddlewareDeps {
  readonly logger: AppLogger;
  readonly shopify: ShopifyHandle;
  readonly store: DataStore;
}

export type SessionTokenRejectReason =
  | 'missing_token'
  | 'invalid_token'
  | 'shop_mismatch'
  | 'missing_shop_header'
  | 'store_not_installed'
  | 'auth_not_configured';

/**
 * Authenticates embedded requests with the Shopify App Bridge session token.
 *
 *  - Reads `Authorization: Bearer <session-token>`.
 *  - Verifies the JWT (HS256 + aud + exp/nbf) via the official library, then
 *    enforces iss/dest/sub/sid (see services/shopify.ts).
 *  - Binds the verified `dest` shop domain to the request.
 *  - Rejects when the `x-shopify-shop-domain` header is missing or disagrees
 *    with the token's destination (defense against shop-switching).
 *  - Loads the stored (encrypted) session; a missing row means the store is
 *    not installed in the gateway -> reinstall path.
 *
 * On failure the middleware responds 401 (or 503 when Shopify secrets are
 * absent) with a machine-readable `reason` for the embedded UI to act on.
 */
export function createSessionTokenMiddleware(
  deps: SessionTokenMiddlewareDeps,
): RequestHandler {
  const { shopify, store, logger } = deps;

  const reject = (
    res: Response,
    status: number,
    reason: SessionTokenRejectReason,
    message: string,
    requestId: string,
  ): void => {
    logger.warn({ requestId, reason }, 'session-token rejected');
    res.status(status).json({ ok: false, error: reason, message });
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
    if (!token) {
      return reject(res, 401, 'missing_token', 'Missing session token.', req.requestId);
    }

    let verified;
    try {
      verified = await shopify.verifySessionToken(token);
    } catch {
      return reject(
        res,
        401,
        'invalid_token',
        'Session token could not be verified.',
        req.requestId,
      );
    }

    const shopHeader = req.headers['x-shopify-shop-domain'];
    if (typeof shopHeader !== 'string' || shopHeader.length === 0) {
      return reject(
        res,
        401,
        'missing_shop_header',
        'Missing x-shopify-shop-domain header.',
        req.requestId,
      );
    }
    if (shopHeader.toLowerCase() !== verified.shopDomain.toLowerCase()) {
      return reject(
        res,
        401,
        'shop_mismatch',
        'Session token destination does not match the store.',
        req.requestId,
      );
    }

    const session = await store.findSession(verified.shopDomain);
    if (!session) {
      return reject(
        res,
        401,
        'store_not_installed',
        'This store is not installed; reinstall the app to continue.',
        req.requestId,
      );
    }

    req.shop = verified.shopDomain;
    req.shopifyUserId = verified.sub;
    req.storeSession = session;
    next();
  };
}