import { Router } from 'express';
import { sendError, type AppDeps } from './helpers.js';
import { createSessionTokenMiddleware } from '../middleware/session-token.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Embedded entry surface (Phase 2).
 *
 *  GET /embed            -> minimal HTML that boots Shopify App Bridge and
 *                           redirects to /embed/activity with a freshly
 *                           obtained session token.
 *  GET /embed/activity    -> protected: verifies the session token (middleware),
 *                           mints a one-time SEAI ticket, and 302s the iframe
 *                           to the existing SEAI dashboard at
 *                           SEAI_BASE_URL/activity?shop=...&ticket=...
 *
 * The iframe NEVER receives a Shopify access token — only the short-lived
 * SEAI ticket, which cannot be exchanged for one.
 */
export function createEmbedRouter(deps: AppDeps): Router {
  const { config, logger, store, tickets } = deps;
  const router = Router();

  router.get('/', (req, res) => {
    const shop = typeof req.query.shop === 'string' ? req.query.shop : undefined;
    const host = typeof req.query.host === 'string' ? req.query.host : undefined;
    const apiKey = config.shopifyApiKey;
    const appUrl = config.shopifyAppUrl;
    if (!shop || !apiKey || !appUrl) {
      res.status(400).send('Missing shop / apiKey / appUrl.');
      return;
    }
    const entry = `${appUrl.replace(/\/+$/, '')}/embed/activity`;
    const shopSafe = escapeHtml(shop);
    const apiKeySafe = escapeHtml(apiKey);
    const entrySafe = escapeHtml(entry);

    res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SEAI</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
</head>
<body>
  <p>Connecting to SEAI…</p>
  <script>
    (function () {
      const app = window['app-bridge']
        ? window['app-bridge'].createApp({ apiKey: "${apiKeySafe}", shopOrigin: "${shopSafe}", forceRedirect: true })
        : null;
      if (!app) { document.body.innerText = 'App Bridge failed to initialise.'; return; }
      app.idToken().then(function (token) {
        fetch("${entrySafe}?shop=${shopSafe}&host=${host ? escapeHtml(host) : ''}", {
          headers: { Authorization: 'Bearer ' + token, 'x-shopify-shop-domain': "${shopSafe}" },
          redirect: 'follow'
        }).then(function (resp) {
          if (resp.redirected) { window.location.href = resp.url; }
          else if (resp.status === 401) { window.location.href = "/auth?shop=" + encodeURIComponent("${shopSafe}"); }
          else { app.body.innerText = 'Unexpected response: ' + resp.status; }
        });
      });
    })();
  </script>
</body>
</html>`);
  });

  router.get('/activity', createSessionTokenMiddleware({ logger, shopify: deps.shopify, store }), async (req, res) => {
    const shop = req.shop;
    const link = await store.findStore(shop);
    if (!link || link.linkState !== 'linked' || !link.seaiAccountId) {
      const connectUrl = `${config.shopifyAppUrl?.replace(/\/+$/, '') ?? ''}/connect/start?shop=${encodeURIComponent(shop)}`;
      return res.redirect(connectUrl);
    }
    if (!config.seaiBaseUrl) {
      sendError(res, 503, 'seai_not_configured', 'SEAI_BASE_URL is not configured.');
      return;
    }
    let ticket: string;
    try {
      ticket = await tickets.issue(shop, link.seaiAccountId, config.seaiTicketTtlSeconds);
    } catch (err) {
      logger.error({ shopDomain: shop, err: err instanceof Error ? err.message : String(err) }, 'ticket issue failed');
      sendError(res, 500, 'ticket_issue_failed', 'Could not issue an SEAI ticket.');
      return;
    }
    const seaiUrl = `${config.seaiBaseUrl.replace(/\/+$/, '')}/activity?shop=${encodeURIComponent(shop)}&ticket=${encodeURIComponent(ticket)}`;
    logger.info({ shopDomain: shop }, 'embedding /activity with a one-time ticket');
    res.redirect(seaiUrl);
  });

  return router;
}