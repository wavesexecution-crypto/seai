/**
 * Thin wrapper around the official `@shopify/shopify-api` package (v11).
 *
 * The gateway uses the library for the security-critical primitives:
 *  - session-token JWT verification (HS256 + aud + exp/nbf via jose),
 *  - OAuth callback HMAC validation,
 *  - webhook HMAC + required-header validation,
 *  - shop-domain sanitisation.
 *
 * OAuth begin/callback HTTP plumbing, token storage, the GraphQL proxy, and
 * the webhook receiver are implemented directly (with the library's primitives
 * underneath) so behaviour stays fully under our control and testable.
 *
 * NOTE: `decodeSessionToken` verifies signature/exp/nbf/aud. Shopify session
 * tokens must additionally satisfy iss/dest/sub/sid — enforced here.
 */

import { shopifyApi } from '@shopify/shopify-api';
import type { ApiVersion, AuthQuery } from '@shopify/shopify-api';
import type { Request } from 'express';
import { requireSecret, type AppConfig } from '../config.js';

// Register the Node adapter for @shopify/shopify-api. Under ESM the library
// cannot auto-detect the runtime, so this side-effect import must run before
// any shopifyApi() call (otherwise it throws "abstractRuntimeString").
import '@shopify/shopify-api/adapters/node';

export class SessionTokenError extends Error {
  override readonly name = 'SessionTokenError';
  constructor(message: string) {
    super(message);
  }
}

export class ShopifyNotConfiguredError extends Error {
  override readonly name = 'ShopifyNotConfiguredError';
  constructor(name: string) {
    super(`Missing required secret "${name}". Set it in the environment.`);
  }
}

/** Claims the gateway requires from a valid embedded session token. */
export interface VerifiedSessionToken {
  /** Canonical `{shop}.myshopify.com` (token `dest`). */
  readonly shopDomain: string;
  /** Shopify staff member id. */
  readonly sub: string;
  /** Session id. */
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
}

export type WebhookValidationResult =
  | {
      readonly valid: true;
      readonly topic: string;
      readonly domain: string;
      readonly apiVersion: string;
      readonly webhookId: string;
      readonly subTopic?: string | undefined;
    }
  | { readonly valid: false; readonly reason: string };

export interface ShopifyHandle {
  /** Decode + fully validate an embedded session token. Throws SessionTokenError. */
  verifySessionToken(token: string): Promise<VerifiedSessionToken>;
  /** Return the sanitised `{shop}.myshopify.com` or null (optionally throw). */
  sanitizeShop(shop: string | undefined, throwOnInvalid: boolean): string | null;
  /** Validate the `hmac` query parameter of an OAuth callback. */
  validateOauthHmac(query: Record<string, unknown>): Promise<boolean>;
  /** Validate a webhook delivery's HMAC + required headers. */
  validateWebhook(rawBody: Buffer, req: Request): Promise<WebhookValidationResult>;
  readonly apiKey: string;
}

export function createShopifyHandle(config: AppConfig): ShopifyHandle {
  const apiSecretKey = requireSecret(config.shopifyApiSecret, 'SHOPIFY_API_SECRET');
  const apiKey = requireSecret(config.shopifyApiKey, 'SHOPIFY_API_KEY');
  const appUrl = config.shopifyAppUrl;
  const host = appUrl ? new URL(appUrl).host : 'localhost';
  const hostScheme = appUrl ? new URL(appUrl).protocol.replace(':', '') : 'http';

  // Constructing the library factory validates mandatory config eagerly.
  const shopify = shopifyApi({
    apiKey,
    apiSecretKey,
    hostName: host,
    hostScheme: hostScheme as 'http' | 'https',
    apiVersion: config.shopifyApiVersion as ApiVersion,
    isEmbeddedApp: true,
    scopes: [...(config.shopifyApiScopes ?? [])],
  });
  const decode = shopify.session.decodeSessionToken;

  async function verifySessionToken(token: string): Promise<VerifiedSessionToken> {
    let payload: Awaited<ReturnType<typeof decode>>;
    try {
      payload = await decode(token, { checkAudience: true });
    } catch (err) {
      throw new SessionTokenError(
        `Invalid session token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const destRaw = payload.dest;
    if (typeof destRaw !== 'string') {
      throw new SessionTokenError('Session token is missing a destination (dest).');
    }
    // Strip scheme so we pass a bare hostname into sanitizeShop (the library
    // expects `shop.myshopify.com`, not `https://shop.myshopify.com`).
    const bareDest = destRaw.startsWith('https://') ? destRaw.slice('https://'.length) : destRaw;
    const sanitizedDest = sanitizeShop(bareDest, false);
    if (!sanitizedDest) {
      throw new SessionTokenError('Session token has an invalid destination (dest).');
    }
    const shopDomain = sanitizedDest;

    const iss = payload.iss;
    if (typeof iss !== 'string' || iss !== `https://${shopDomain}/admin`) {
      throw new SessionTokenError('Session token issuer mismatch (iss).');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new SessionTokenError('Session token is missing a subject (sub).');
    }
    if (typeof payload.sid !== 'string' || payload.sid.length === 0) {
      throw new SessionTokenError('Session token is missing a session id (sid).');
    }
    const iat = typeof payload.iat === 'number' ? payload.iat : 0;
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;

    return {
      shopDomain,
      sub: payload.sub,
      sid: payload.sid,
      iat,
      exp,
      iss,
    };
  }

  // The library's `sanitizeShop` takes (shop: string, throwOnInvalid: boolean) => string | null.
  // It is NOT a factory; pass the bare hostname directly.
  function sanitizeShop(shop: string | undefined, throwOnInvalid: boolean): string | null {
    if (!shop) {
      if (throwOnInvalid) {
        shopify.utils.sanitizeShop('invalid.invalid', true);
      }
      return null;
    }
    return shopify.utils.sanitizeShop(shop, throwOnInvalid) ?? null;
  }

  async function validateOauthHmac(query: Record<string, unknown>): Promise<boolean> {
    // Narrow the loose query bag into the library's AuthQuery shape: only
    // string-valued parameters participate in OAuth HMAC validation.
    const authQuery: AuthQuery = {};
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') authQuery[key] = value;
    }
    try {
      return await shopify.utils.validateHmac(authQuery);
    } catch {
      return false;
    }
  }

  async function validateWebhook(
    rawBody: Buffer,
    req: Request,
  ): Promise<WebhookValidationResult> {
    // The library computes the webhook HMAC over the raw body as a string;
    // express.raw() gives us the exact bytes, so the UTF-8 round-trip is
    // byte-identical (HMAC input is unchanged).
    const result = await shopify.webhooks.validate({ rawBody: rawBody.toString('utf-8'), rawRequest: req });
    if (!result.valid) {
      return { valid: false, reason: result.reason };
    }
    const valid = result as Extract<typeof result, { valid: true }>;
    if (!valid.topic || !valid.domain || !valid.apiVersion || !valid.webhookId) {
      return { valid: false, reason: 'missing_required_webhook_headers' };
    }
    return {
      valid: true,
      topic: String(valid.topic),
      domain: String(valid.domain),
      apiVersion: String(valid.apiVersion),
      webhookId: String(valid.webhookId),
      subTopic: valid.subTopic ? String(valid.subTopic) : undefined,
    };
  }

  return { verifySessionToken, sanitizeShop, validateOauthHmac, validateWebhook, apiKey };
}