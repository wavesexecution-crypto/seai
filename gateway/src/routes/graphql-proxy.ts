import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { PINNED_API_VERSION } from '../config.js';
import { sendError, type AppDeps } from './helpers.js';
import { GatewayTokenError } from '../services/gateway-token.js';

const MAX_BODY_BYTES = 256 * 1024;

export function createGraphqlProxyRouter(deps: AppDeps): Router {
  const { config, logger, store, crypto, gatewayTokens, graphql, proxyRateLimiter } = deps;
  const router = Router();

  const machineHash = (shopDomain: string, machineToken: string): string =>
    createHmac('sha256', 'seai-gateway:machine:v1')
      .update(`${shopDomain}:${machineToken}`)
      .digest('hex');

  const hashEquals = (a: string, b: string): boolean => {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  };

  router.post('/exchange', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const shopValue = typeof body.shop === 'string' ? body.shop : undefined;
    const machineToken = typeof body.machineToken === 'string' ? body.machineToken : undefined;
    if (!shopValue || !machineToken) {
      sendError(res, 400, 'invalid_exchange', 'shop and machineToken are required.');
      return;
    }
    const link = await store.findStore(shopValue);
    if (!link || link.linkState !== 'linked' || !link.seaiMachineTokenHash || !link.seaiAccountId) {
      sendError(res, 401, 'store_not_linked', 'This store is not linked to an SEAI account.');
      return;
    }
    if (!hashEquals(machineHash(shopValue, machineToken), link.seaiMachineTokenHash)) {
      sendError(res, 401, 'invalid_machine_token', 'The SEAI machine token is invalid.');
      return;
    }
    try {
      const token = await gatewayTokens.issue(shopValue, link.seaiAccountId, config.gatewayTokenTtlSeconds);
      res.json({ ok: true, token, expiresInSeconds: config.gatewayTokenTtlSeconds });
    } catch {
      sendError(res, 503, 'tokens_not_configured', 'Gateway token signing is not configured.');
    }
  });

  router.post('/:shop', async (req, res) => {
    const shopParam = req.params.shop;
    const authHeader = req.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
    if (!token) {
      sendError(res, 401, 'missing_token', 'A gateway token is required.');
      return;
    }
    let claims: { shopDomain: string; seaiAccountId: string };
    try {
      claims = await gatewayTokens.verify(token);
    } catch (err) {
      const kind = err instanceof GatewayTokenError ? err.kind : 'malformed';
      sendError(res, 401, kind === 'expired' ? 'token_expired' : 'invalid_token', 'Gateway token failed.');
      return;
    }
    if (claims.shopDomain !== shopParam) {
      sendError(res, 403, 'shop_mismatch', 'Gateway token is not for this shop.');
      return;
    }
    const requestedVersion = typeof req.query.api_version === 'string' ? req.query.api_version : undefined;
    if (requestedVersion && requestedVersion !== PINNED_API_VERSION) {
      sendError(res, 422, 'unsupported_api_version', `Only ${PINNED_API_VERSION} is supported.`);
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.query !== 'string' || body.query.length === 0 || body.query.length > 100_000) {
      sendError(res, 400, 'invalid_query', 'A GraphQL query string is required.');
      return;
    }
    if (Buffer.byteLength(JSON.stringify(body), 'utf-8') > MAX_BODY_BYTES) {
      sendError(res, 413, 'body_too_large', 'GraphQL request body is too large.');
      return;
    }
    const link = await store.findStore(shopParam);
    if (!link || link.linkState !== 'linked' || link.seaiAccountId !== claims.seaiAccountId) {
      sendError(res, 401, 'store_not_linked', 'This store is not linked.');
      return;
    }
    const session = await store.findSession(shopParam);
    if (!session) {
      sendError(res, 401, 'store_not_installed', 'This store is not installed; reinstall the app.');
      return;
    }
    const bucket = proxyRateLimiter.take(`proxy:${shopParam}`, 1, Date.now());
    if (!bucket.allowed) {
      res.setHeader('Retry-After', String(bucket.retryAfterSeconds));
      sendError(res, 429, 'rate_limited', 'Per-shop proxy rate limit exceeded.');
      return;
    }
    let accessToken: string;
    try {
      accessToken = await crypto.decrypt(session.accessTokenCiphertext);
    } catch {
      sendError(res, 500, 'session_decrypt_failed', 'The stored session could not be decrypted.');
      return;
    }
    let result: { status: number; headers: Record<string, string>; body: unknown };
    try {
      result = await graphql.proxy(shopParam, accessToken, body, { requestId: req.requestId });
    } catch {
      sendError(res, 502, 'shopify_unreachable', 'Shopify did not respond.');
      return;
    }
    if (result.status === 401 || result.status === 403) {
      await store.deleteSession(shopParam);
      logger.error({ shopDomain: shopParam, status: result.status }, 'Shopify revoked the token');
      res.status(401).json({ ok: false, error: 'shopify_unauthorized', message: 'Shopify revoked access; reinstall.' });
      return;
    }
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    res.setHeader('X-Request-Id', req.requestId);
    res.status(result.status).json(result.body);
  });

  return router;
}