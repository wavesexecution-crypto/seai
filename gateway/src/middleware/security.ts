import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { AppLogger } from '../logger.js';

export interface SecurityMiddlewareDeps {
  readonly config: AppConfig;
  readonly logger: AppLogger;
}

/** Hosts that may frame the gateway (Shopify Admin). */
export const SHOPIFY_ADMIN_FRAME_ANCESTORS = [
  'https://*.myshopify.com',
  'https://admin.shopify.com',
];

/**
 * Security headers for every gateway response.
 *
 * Important for embedded mode: we set `Content-Security-Policy` with
 * `frame-ancestors` allow-listing Shopify Admin, and we deliberately never set
 * `X-Frame-Options` (a DENY/SAMEORIGIN there would break embedding).
 *
 * HSTS is only emitted over a real production HTTPS deployment (enabled via
 * `SHOPIFY_APP_URL` scheme check); local dev stays HSTS-free so browsers do
 * not pin an http://localhost origin.
 */
export function createSecurityHeadersMiddleware(deps: SecurityMiddlewareDeps): RequestHandler {
  const { config, logger } = deps;
  const isHttpsOrigin = config.shopifyAppUrl?.startsWith('https://') ?? false;
  const always = [
    'default-src \'self\'',
    'script-src \'self\' https://cdn.shopify.com https://shopify-embed.shopifycloud.com',
    'style-src \'self\' \'unsafe-inline\' https://cdn.shopify.com',
    'img-src \'self\' data: https:',
    'connect-src \'self\' https://*.myshopify.com https://admin.shopify.com https://cdn.shopify.com',
    `frame-ancestors 'self' ${SHOPIFY_ADMIN_FRAME_ANCESTORS.join(' ')}`,
    'base-uri \'self\'',
    'form-action \'self\'',
  ].join('; ');
  const csp = always;

  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isHttpsOrigin) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Deliberately NOT setting X-Frame-Options (embedded mode).
    void logger;
    next();
  };
}

/**
 * CORS restricted to the allow-list in CORS_ALLOWED_ORIGINS (plus Shopify
 * Admin origins). Server-to-server calls do not need CORS at all; this only
 * relaxes browser access where a legitimate need exists.
 */
export function createCorsMiddleware(deps: SecurityMiddlewareDeps): RequestHandler {
  const { config, logger } = deps;
  const allowed = new Set(config.corsAllowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && (allowed.has(origin) || origin.endsWith('.myshopify.com'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    void logger;
    next();
  };
}