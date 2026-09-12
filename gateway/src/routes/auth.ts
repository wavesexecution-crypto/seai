import type { Response } from 'express';
import { Router } from 'express';
import { randomToken } from '../services/crypto.js';
import { sendError, type AppDeps } from './helpers.js';

const OAUTH_NONCE_TTL_MS = 10 * 60 * 1000;
const SHOP_QUERY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * OAuth install/callback (Phase 2).
 *
 *  GET /auth           -> Shopify authorize URL with a server-side one-time
 *                         `state` nonce.
 *  GET /auth/callback  -> verify HMAC + one-time state, exchange the code for
 *                         the long-lived access token, persist it ENCRYPTED,
 *                         register lifecycle webhooks, redirect to /embed.
 *  GET /auth/install   -> same as /auth (explicit reinstall entry point).
 *
 * The access token is never logged, echoed, or handed to the browser/SEAI.
 */
export function createAuthRouter(deps: AppDeps): Router {
  const { config, logger, shopify, store, crypto, webhookRegistrar } = deps;
  const router = Router();

  const beginOAuth = async (
    shopValue: string | undefined,
    res: Response,
  ): Promise<void> => {
    if (!shopValue || !SHOP_QUERY_REGEX.test(shopValue)) {
      sendError(res, 400, 'invalid_shop', 'A valid shop domain is required.');
      return;
    }
    const apiKey = config.shopifyApiKey;
    const appUrl = config.shopifyAppUrl;
    if (!apiKey || !appUrl) {
      sendError(
        res,
        503,
        'app_not_configured',
        'SHOPIFY_API_KEY / SHOPIFY_APP_URL are not configured.',
      );
      return;
    }
    const cleanShop = shopify.sanitizeShop(shopValue, true) ?? shopValue;
    const scopes = (config.shopifyApiScopes ?? []).join(',');
    const state = randomToken(32);
    // Bind state to shop for CSRF: state generated for shop A cannot be
    // replayed for shop B. Key is `oauth:<shop>:<state>`.
    await store.setNonceIfAbsent(`oauth:${cleanShop}:${state}`, new Date(Date.now() + OAUTH_NONCE_TTL_MS));

    const params = new URLSearchParams({
      client_id: apiKey,
      scope: scopes,
      redirect_uri: `${appUrl.replace(/\/+$/, '')}/auth/callback`,
      state,
    });
    logger.info({ shop: cleanShop }, 'OAuth install started');
    res.redirect(`https://${cleanShop}/admin/oauth/authorize?${params.toString()}`);
  };

  router.get('/', (req, res) => {
    void beginOAuth(typeof req.query.shop === 'string' ? req.query.shop : undefined, res);
  });

  router.get('/install', (req, res) => {
    void beginOAuth(typeof req.query.shop === 'string' ? req.query.shop : undefined, res);
  });

  router.get('/callback', async (req, res) => {
    const shopValue = typeof req.query.shop === 'string' ? req.query.shop : undefined;
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const host = typeof req.query.host === 'string' ? req.query.host : undefined;
    const appUrl = config.shopifyAppUrl;

    const cleanShop = shopValue ? shopify.sanitizeShop(shopValue, false) : null;
    if (!cleanShop || !code || !state || !appUrl) {
      sendError(res, 400, 'invalid_callback', 'Missing required OAuth parameters.');
      return;
    }

    // 1) OAuth callback HMAC — must be verified over the *full* callback
    // query string as Shopify sent it (excluding hmac/signature, sorted,
    // with host/timestamp etc. included). This is checked *before* consuming
    // the one-time state so a failed HMAC does not burn the nonce and mask
    // the real error with a subsequent `invalid_state`.
    // SAFE diagnostic: log only metadata (never code/hmac/state values) to
    // diagnose real Shopify vs synthetic HMAC discrepancies.
    {
      const q = req.query as Record<string, unknown>;
      const paramNames = Object.keys(q).sort();
      const hmacVal = typeof q.hmac === 'string' ? (q.hmac as string) : '';
      const stateVal = typeof q.state === 'string' ? (q.state as string) : '';
      const codeVal = typeof q.code === 'string' ? (q.code as string) : '';
      const hostVal = typeof q.host === 'string' ? (q.host as string) : '';
      const tsVal = q.timestamp;
      logger.info(
        {
          shop: cleanShop,
          requestId: (req as unknown as { requestId?: string }).requestId,
          paramNames,
          hasCode: !!codeVal,
          codeLen: codeVal.length,
          hasHmac: !!hmacVal,
          hmacLen: hmacVal.length,
          hasState: !!stateVal,
          stateLen: stateVal.length,
          hasHost: !!hostVal,
          hostLen: hostVal.length,
          hasShop: !!shopValue,
          timestamp: typeof tsVal === 'string' || typeof tsVal === 'number' ? String(tsVal) : typeof tsVal,
          timestampLen: String(tsVal ?? '').length,
          // Also log whether raw query contains duplicate keys (array values)
          hasArrayParams: Object.values(q).some((v) => Array.isArray(v)),
        },
        'OAuth callback received (metadata only)',
      );
    }
    const hmacValid = await shopify.validateOauthHmac(req.query as Record<string, unknown>);
    // Second diagnostic: result and HMAC metadata (no values)
    {
      const q = req.query as Record<string, unknown>;
      const hmacLen = typeof q.hmac === 'string' ? (q.hmac as string).length : 0;
      logger.info(
        {
          shop: cleanShop,
          hmacValid,
          hmacLen,
          paramCount: Object.keys(q).length,
          requestId: (req as unknown as { requestId?: string }).requestId,
        },
        hmacValid ? 'OAuth HMAC PASSED' : 'OAuth HMAC FAILED',
      );
    }
    if (!hmacValid) {
      sendError(res, 400, 'invalid_hmac', 'OAuth callback HMAC is invalid.');
      return;
    }

    // 2) One-time state: atomically consume the shop-bound nonce. This is
    // bound to `cleanShop` so a state issued for shop A cannot be replayed
    // for shop B, and it is one-time (consume deletes it) with TTL enforced
    // by the store. The previous bug consumed state *before* HMAC, so a
    // transient HMAC failure would burn the nonce and surface as
    // `invalid_state` on retry. Now HMAC is validated first.
    if (!(await store.consumeNonce(`oauth:${cleanShop}:${state}`))) {
      sendError(res, 400, 'invalid_state', 'OAuth state could not be verified.');
      return;
    }

    // 3) Exchange the authorization code for the permanent access token.
    const secret = config.shopifyApiSecret;
    if (!secret) {
      sendError(res, 503, 'app_not_configured', 'SHOPIFY_API_SECRET is not configured.');
      return;
    }
    let exchange: { access_token?: string; scope?: string };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const r = await fetch(`https://${cleanShop}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: config.shopifyApiKey,
            client_secret: secret,
            code,
          }),
          signal: controller.signal,
        });
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          logger.error({ status: r.status, bodyPreviewLength: body.length }, 'Shopify token exchange failed');
          throw new Error(`token exchange failed (${r.status})`);
        }
        exchange = (await r.json()) as { access_token?: string; scope?: string };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      sendError(res, 502, 'token_exchange_failed', 'Shopify token exchange failed.');
      return;
    }
    const accessToken = exchange?.access_token;
    if (!accessToken) {
      sendError(res, 502, 'token_exchange_failed', 'Shopify returned no access token.');
      return;
    }

    // 4) Encrypt + persist (never log the access token).
    const ciphertext = await crypto.encrypt(accessToken);
    const now = new Date();
    const previousSession = await store.findSession(cleanShop);
    const existingStore = await store.findStore(cleanShop);
    await store.saveSession({
      shopDomain: cleanShop,
      accessTokenCiphertext: ciphertext,
      scope: exchange?.scope ?? (config.shopifyApiScopes ?? []).join(' '),
      isOnline: false,
      installedAt: previousSession?.installedAt ?? now,
      updatedAt: now,
    });
    if (!existingStore) {
      await store.saveStore({ shopDomain: cleanShop, linkState: 'pending', createdAt: now, updatedAt: now });
    } else if (existingStore.linkState === 'revoked') {
      // Reinstall after an uninstall: keep the (old) account link metadata but
      // move back to pending so the merchant re-confirms the link if needed.
      await store.saveStore({ ...existingStore, linkState: 'pending', updatedAt: now });
    }

    // 5) Register lifecycle webhooks (best effort; app/update retries later).
    void webhookRegistrar.registerRequired(cleanShop, accessToken).catch((err) => {
      logger.error(
        { shopDomain: cleanShop, err: err instanceof Error ? err.message : String(err) },
        'webhook registration failed at install (will retry on app/update)',
      );
    });

    logger.info({ shopDomain: cleanShop }, 'OAuth install completed');
    const embedUrl = `${appUrl.replace(/\/+$/, '')}/embed?shop=${encodeURIComponent(cleanShop)}${host ? `&host=${encodeURIComponent(host)}` : ''}`;
    res.redirect(embedUrl);
  });

  return router;
}