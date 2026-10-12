import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { sendError, type AppDeps } from './helpers.js';
import { createSessionTokenMiddleware } from '../middleware/session-token.js';
import { randomToken } from '../services/crypto.js';

export interface ConnectClaimPayload {
  readonly version: 1;
  readonly kind: 'connect';
  readonly shopDomain: string;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

export const CONNECT_TOKEN_TTL_SECONDS = 10 * 60;

function encodeBody(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

/**
 * Store <-> SEAI account connection (Phase 3).
 *
 *  GET  /connect/start    (embedded, session-token) mints a short-lived signed
 *                         `connect_claim` and redirects to the SEAI login.
 *  GET  /connect/callback SEAI returns the merchant with `code`; the gateway
 *                         verifies the code HMAC, consumes the one-time nonce,
 *                         stores the encrypted machine token and links the store.
 *  POST /connect/unlink   (embedded, session-token) revokes the link safely.
 */
export function createConnectRouter(deps: AppDeps): Router {
  const { config, logger, store, crypto, seai } = deps;
  const router = Router();

  const signConnectClaim = (payload: ConnectClaimPayload): string | undefined => {
    const key = config.seaiWebhookSecret;
    if (!key) return undefined;
    const body = encodeBody(payload);
    const signature = createHmac('sha256', key).update(body).digest('base64');
    return `${body}.${signature}`;
  };

  const parseConnectClaim = (claim: string): ConnectClaimPayload | undefined => {
    const parts = claim.split('.');
    if (parts.length !== 2) return undefined;
    const [body, signature] = parts as [string, string];
    const key = config.seaiWebhookSecret;
    if (!key || !crypto.verifyHmac(key, body, signature)) return undefined;
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf-8'),
      ) as ConnectClaimPayload;
      if (payload.version !== 1 || payload.kind !== 'connect') return undefined;
      if (typeof payload.shopDomain !== 'string' || typeof payload.nonce !== 'string') {
        return undefined;
      }
      return payload;
    } catch {
      return undefined;
    }
  };

  const verifyLinkCode = async (
    code: string,
    expectedShop: string,
  ): Promise<{ seaiAccountId: string; machineToken: string } | undefined> => {
    const parts = code.split('.');
    if (parts.length !== 2) return undefined;
    const [body, signature] = parts as [string, string];
    const key = config.seaiWebhookSecret;
    if (!key || !crypto.verifyHmac(key, body, signature)) return undefined;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    if (payload.version !== 1 || payload.kind !== 'seai-link') return undefined;
    if (payload.shopDomain !== expectedShop) return undefined;
    if (typeof payload.nonce !== 'string' || payload.nonce.length === 0) return undefined;
    if (typeof payload.seaiAccountId !== 'string' || payload.seaiAccountId.length === 0) {
      return undefined;
    }
    if (typeof payload.machineToken !== 'string' || payload.machineToken.length < 16) {
      return undefined;
    }
    const nowSec = Math.trunc(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || nowSec > payload.exp) return undefined;
    if (typeof payload.iat === 'number' && nowSec < payload.iat) return undefined;
    const claimed = await store.setNonceIfAbsent(
      `link:${String(payload.nonce)}`,
      new Date(Number(payload.exp) * 1000),
    );
    if (!claimed) return undefined;
    return {
      seaiAccountId: String(payload.seaiAccountId),
      machineToken: String(payload.machineToken),
    };
  };

  const machineHash = (shopDomain: string, machineToken: string): string =>
    createHmac('sha256', 'seai-gateway:machine:v1')
      .update(`${shopDomain}:${machineToken}`)
      .digest('hex');

  router.get(
    '/start',
    createSessionTokenMiddleware({ logger, shopify: deps.shopify, store }),
    async (req, res) => {
      const shop = req.shop;
      if (!config.seaiBaseUrl) {
        sendError(res, 503, 'seai_not_configured', 'SEAI_BASE_URL is not configured.');
        return;
      }
      if (!config.seaiWebhookSecret) {
        sendError(res, 503, 'link_not_configured', 'SEAI link signing is not configured.');
        return;
      }
      const nowSec = Math.trunc(Date.now() / 1000);
      const claim: ConnectClaimPayload = {
        version: 1,
        kind: 'connect',
        shopDomain: shop,
        nonce: randomToken(24),
        iat: nowSec,
        exp: nowSec + CONNECT_TOKEN_TTL_SECONDS,
      };
      await store.setNonceIfAbsent(`claim:${claim.nonce}`, new Date(claim.exp * 1000));
      const signed = signConnectClaim(claim);
      if (!signed) {
        sendError(res, 503, 'link_not_configured', 'SEAI link signing is not configured.');
        return;
      }
      const seaiUrl =
        `${config.seaiBaseUrl.replace(/\/+$/, '')}/connect/shopify` +
        `?shop=${encodeURIComponent(shop)}&connect_claim=${encodeURIComponent(signed)}`;
      logger.info({ shopDomain: shop }, 'connect claim minted');
      res.redirect(seaiUrl);
    },
  );

  router.get('/begin', (req, res) => {
    const shopValue = typeof req.query.shop === 'string' ? req.query.shop : undefined;
    if (!shopValue) {
      sendError(res, 400, 'missing_shop', 'A shop query parameter is required.');
      return;
    }
    sendError(res, 401, 'shopify_auth_required', 'Open this page from inside Shopify Admin.');
  });

  router.get('/callback', async (req, res) => {
    const shopValue = typeof req.query.shop === 'string' ? req.query.shop : undefined;
    const claimValue = typeof req.query.connect_claim === 'string' ? req.query.connect_claim : undefined;
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    if (!shopValue || !claimValue || !code) {
      sendError(res, 400, 'invalid_callback', 'Missing shop, connect_claim, or code.');
      return;
    }
    const claim = parseConnectClaim(claimValue);
    if (!claim || claim.shopDomain !== shopValue) {
      sendError(res, 400, 'invalid_claim', 'The SEAI connection claim is invalid.');
      return;
    }
    if (Math.trunc(Date.now() / 1000) > claim.exp) {
      sendError(res, 400, 'claim_expired', 'The connection claim expired; restart linking.');
      return;
    }
    if (!(await store.consumeNonce(`claim:${claim.nonce}`))) {
      sendError(res, 400, 'invalid_claim', 'The connection claim is unknown or already used.');
      return;
    }
    const verified = await verifyLinkCode(code, shopValue);
    if (!verified) {
      sendError(res, 400, 'invalid_code', 'SEAI returned an invalid link code.');
      return;
    }
    const now = new Date();
    const existing = await store.findStore(shopValue);
    await store.saveStore({
      shopDomain: shopValue,
      seaiAccountId: verified.seaiAccountId,
      linkState: 'linked',
      seaiMachineTokenHash: machineHash(shopValue, verified.machineToken),
      storeName: existing?.storeName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await store.saveMachineToken(shopValue, await crypto.encrypt(verified.machineToken), now);
    try {
      await seai.notifyStoreLinked(shopValue, verified.seaiAccountId);
    } catch (err) {
      logger.error(
        { shopDomain: shopValue, err: err instanceof Error ? err.message : String(err) },
        'SEAI link notification failed (link stored)',
      );
    }
    const appUrl = config.shopifyAppUrl?.replace(/\/+$/, '') ?? '';
    res.redirect(`${appUrl}/embed/activity?shop=${encodeURIComponent(shopValue)}`);
  });

  router.post(
    '/unlink',
    createSessionTokenMiddleware({ logger, shopify: deps.shopify, store }),
    async (req, res) => {
      const shop = req.shop;
      const existing = await store.findStore(shop);
      if (!existing || existing.linkState !== 'linked') {
        sendError(res, 404, 'not_linked', 'This store is not linked to an SEAI account.');
        return;
      }
      const now = new Date();
      await store.saveStore({
        ...existing,
        linkState: 'revoked',
        seaiMachineTokenHash: undefined,
        updatedAt: now,
      });
      await store.deleteMachineToken(shop);
      try {
        await seai.notifyStoreRevoked(shop, 'revoked');
      } catch (err) {
        logger.error(
          { shopDomain: shop, err: err instanceof Error ? err.message : String(err) },
          'SEAI unlink notification failed (link revoked locally)',
        );
      }
      res.json({ ok: true, shopDomain: shop, linkState: 'revoked' });
    },
  );

  return router;
}