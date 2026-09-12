import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { loadConfig, type AppConfig, type LogLevel } from './config.js';
import { createLogger, type AppLogger } from './logger.js';
import { createLedgerMiddleware } from './middleware/ledger.js';
import { createCorsMiddleware, createSecurityHeadersMiddleware } from './middleware/security.js';
import { createAuthRouter } from './routes/auth.js';
import { createEmbedRouter } from './routes/embed.js';
import { createConnectRouter } from './routes/connect.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createGraphqlProxyRouter } from './routes/graphql-proxy.js';
import { type AppDeps } from './routes/helpers.js';
import { createCryptoBox, type CryptoBox } from './services/crypto.js';
import { createDataStore, type DataStore } from './services/data-store.js';
import { createGatewayTokenService, type GatewayTokenService } from './services/gateway-token.js';
import { createGraphqlTransport, type GraphqlTransport } from './services/graphql.js';
import { createRateLimiter, type TokenBucketStore } from './services/rate-limiter.js';
import { createSeaiClient, type SeaiClient } from './services/seai-client.js';
import { createShopifyHandle, type ShopifyHandle } from './services/shopify.js';
import { createTicketService, type TicketService } from './services/ticket.js';
import { createWebhookRegistrar, type WebhookRegistrar } from './services/webhook-registrar.js';

export const SERVICE_NAME = 'seai-shopify-gateway';
export const SERVICE_VERSION = '0.2.0';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger: AppLogger;
  /** Test/dev overrides: inject stores/transports without touching the environment. */
  readonly overrides?: {
    readonly store?: DataStore;
    readonly graphql?: GraphqlTransport;
    readonly proxyRateLimiter?: TokenBucketStore;
  };
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly service: string;
  readonly version: string;
  readonly nodeEnv: AppConfig['nodeEnv'];
  readonly uptimeSec: number;
  readonly featureMode: boolean;
}

/**
 * Proxy stand-in for services whose backing secrets are absent (scaffold
 * mode). Any property access returns a function that throws when invoked, so
 * a mis-wired call fails loudly instead of silently misbehaving.
 */
function unconfigured<T extends object>(feature: string): T {
  const thrower = (): never => {
    throw new Error(`${feature} is not configured (missing feature secrets).`);
  };
  return new Proxy(Object.create(null), { get: () => thrower }) as unknown as T;
}

/**
 * Builds the full route dependency bag. Feature mode activates only when ALL
 * feature secrets are present; otherwise the gateway still boots (health,
 * stubs, config errors) and every feature call fails loudly.
 */
function buildDeps(config: AppConfig, logger: AppLogger, overrides?: CreateAppOptions['overrides']): AppDeps {
  const store: DataStore = overrides?.store ?? createDataStore(config, logger);
  const seai: SeaiClient = createSeaiClient(config, logger);
  const graphql: GraphqlTransport = overrides?.graphql ?? createGraphqlTransport(config, logger);
  const proxyRateLimiter: TokenBucketStore =
    overrides?.proxyRateLimiter ?? createRateLimiter(config.proxyRateLimitPerMinute);

  const featureMode = Boolean(
    config.shopifyApiKey &&
      config.shopifyApiSecret &&
      config.sessionStorageKey &&
      config.gatewayTokenSigningKey &&
      config.shopifyAppUrl,
  );
  if (!featureMode) {
    logger.warn(
      'Feature mode OFF: set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, '
        + 'SESSION_STORAGE_KEY and GATEWAY_TOKEN_SIGNING_KEY to enable OAuth, sessions '
        + 'and the embedded app.',
    );
    return {
      config,
      logger,
      store,
      seai,
      graphql,
      proxyRateLimiter,
      shopify: unconfigured<ShopifyHandle>('Shopify handle'),
      crypto: unconfigured<CryptoBox>('CryptoBox'),
      tickets: unconfigured<TicketService>('TicketService'),
      gatewayTokens: unconfigured<GatewayTokenService>('GatewayTokenService'),
      webhookRegistrar: unconfigured<WebhookRegistrar>('WebhookRegistrar'),
    };
  }

  const crypto: CryptoBox = createCryptoBox(config.sessionStorageKey as string);
  const shopify: ShopifyHandle = createShopifyHandle(config);
  const tickets: TicketService = createTicketService(config, crypto, store);
  const gatewayTokens: GatewayTokenService = createGatewayTokenService(config);
  const webhookRegistrar: WebhookRegistrar = createWebhookRegistrar(config, logger);
  return {
    config,
    logger,
    shopify,
    store,
    crypto,
    tickets,
    gatewayTokens,
    seai,
    graphql,
    webhookRegistrar,
    proxyRateLimiter,
  };
}

/** Builds the Express application without binding a port (testable). */
export function createApp(options: CreateAppOptions): Express {
  const { config, logger } = options;
  const deps = buildDeps(config, logger, options.overrides);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(createLedgerMiddleware(logger));
  app.use(createSecurityHeadersMiddleware({ config, logger }));
  app.use(createCorsMiddleware({ config, logger }));

  // Webhooks need the RAW body for HMAC verification: parse them before the
  // app-wide JSON parser sees the request.
  app.use('/webhooks', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));

  // --- health -------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    const body: HealthStatus = {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      nodeEnv: config.nodeEnv,
      uptimeSec: Math.round(process.uptime()),
      featureMode: Boolean(config.shopifyApiSecret && config.sessionStorageKey),
    };
    res.json(body);
  });

  app.get('/health/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, string> = { config: 'ok' };
    let ready = true;
    try {
      await deps.store.findStore('health-check.invalid');
      checks.database = 'ok';
    } catch {
      checks.database = 'unreachable';
      ready = false;
    }
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      ready,
      checks,
    });
  });

  // --- embedded app entry (Shopify loads `application_url`) ------------------
  // Shopify's `application_url` is `https://gateway.seai.store`; post-OAuth
  // callback redirects to `/embed?shop=…&host=…`. When a merchant later opens
  // Seai from Admin, Shopify re-loads `https://gateway.seai.store/?shop=…&host=…`
  // inside the iframe (not `/embed`). Without this alias the iframe hits the
  // generic 404 and Admin shows `admin.shopify.com/.../apps/embed` as not-found.
  // Keep `/embed` as canonical, but alias `/` → `/embed` (query-preserving) so
  // both `/?shop=…` and `/embed?shop=…` bootstrap App Bridge correctly.
  app.get('/', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    // If SEAI-style `shop` param present, boot the embedded app; otherwise
    // treat root as the embedded entry as well so the iframe never 404s.
    if (typeof req.query.shop === 'string' && req.query.shop.length > 0) {
      res.redirect(302, `/embed${qs}`);
      return;
    }
    // No shop (direct navigation/crawler) — also bootstrap embed; the embed
    // handler will return 400 with a helpful message if shop/apiKey missing.
    // Using redirect keeps one canonical bootstrap implementation.
    if (qs) {
      res.redirect(302, `/embed${qs}`);
      return;
    }
    res.redirect(302, '/embed');
  });

  // --- route mounts --------------------------------------------------------
  app.use('/auth', createAuthRouter(deps));
  app.use('/embed', createEmbedRouter(deps));
  app.use('/connect', createConnectRouter(deps));
  app.use('/webhooks', createWebhooksRouter(deps));
  app.use('/v1/graphql', createGraphqlProxyRouter(deps));

  // --- 404 + error handling ----------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4-arity
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error(
      {
        requestId: req.requestId,
        path: req.originalUrl,
        method: req.method,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) },
      },
      'unhandled error',
    );
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ ok: false, error: 'internal_error' });
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel as LogLevel);
  const app = createApp({ config, logger });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, apiVersion: config.shopifyApiVersion },
      `${SERVICE_NAME} v${SERVICE_VERSION} listening`,
    );
  });

  // Graceful shutdown: stop accepting connections, close the store, exit.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void config;
      void shutdown;
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

// ---------------------------------------------------------------------------
// Vercel serverless entrypoint
// ---------------------------------------------------------------------------
// Vercel's @vercel/express framework detects any file that imports `express`
// and expects it to `export default` an Express app (or request handler).
// The gateway's source entrypoint is `src/server.ts`; without a default
// export the runtime crashes with:
//
//   Invalid export found in module "/var/task/gateway/src/server.js".
//   The default export must be a function or server.
//
// This lazy singleton ensures the module can be imported on Vercel without
// crashing at import time. `loadConfig()` is called on first import, but
// missing optional feature secrets do NOT throw — the app still boots with
// health endpoints and `unconfigured()` stubs (see buildDeps). Only a truly
// malformed config (e.g., invalid PORT) falls back to a minimal 500 app
// that surfaces the config error without FUNCTION_INVOCATION_FAILED.
let cachedApp: Express | null = null;

function getDefaultApp(): Express {
  if (cachedApp) return cachedApp;
  try {
    const config = loadConfig();
    const logger = createLogger(config.logLevel as LogLevel);
    cachedApp = createApp({ config, logger });
    return cachedApp;
  } catch (err) {
    const fallback = express();
    fallback.get('/health', (_req, res) => {
      res.status(500).json({
        ok: false,
        error: 'config_error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
    fallback.get('/health/ready', (_req, res) => {
      res.status(500).json({ ok: false, error: 'config_error', ready: false });
    });
    fallback.use((_req, res) => {
      res.status(500).json({ ok: false, error: 'config_error' });
    });
    return fallback;
  }
}

// Default export for Vercel (@vercel/express) and other serverless adapters.
// Local `node dist/server.js` still uses `main()` above; tests import `createApp`.
export default getDefaultApp();