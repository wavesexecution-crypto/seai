import 'dotenv/config';

function need(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(need('PORT', '3000')),
  operatorName: need('OPERATOR_NAME', 'Operator'),
  autonomyLevel: (need('AUTONOMY_LEVEL', 'EXECUTE_SAFE') as 'OBSERVE' | 'ASSIST' | 'EXECUTE_SAFE' | 'AUTONOMOUS'),
  agentMaxIterations: Number(need('AGENT_MAX_ITERATIONS', '12')),
  agentTimeoutMs: Number(need('AGENT_REQUEST_TIMEOUT_MS', '60000')),
  // Ollama Cloud host (NOT /api — paths below already include it).
  // Per https://docs.ollama.com/cloud: host=https://ollama.com, e.g. POST /api/chat
  ollamaBaseUrl: 'https://ollama.com',
  ollamaKeys: [
    need('OLLAMA_API_KEY_1'),
    need('OLLAMA_API_KEY_2'),
    need('OLLAMA_API_KEY_3'),
    need('OLLAMA_API_KEY_4'),
    need('OLLAMA_API_KEY_5'),
    need('OLLAMA_API_KEY_6'),
  ].filter(Boolean) as string[],
  // Masked identifiers only — never expose raw keys
  ollamaKeyIds: [1, 2, 3, 4, 5, 6].map((i) => `key_${i}`),
  // Experiential gateway (OpenAI Chat Completions compatible). Used to route
  // claude-fable-5.1 through api.experientiallabs.ai instead of calling the
  // provider directly. Key comes from EXPLABS_API_KEY (Settings -> API keys).
  experBaseUrl: need('EXPLABS_BASE_URL', 'https://api.experientiallabs.ai/v1'),
  experKey: need('EXPLABS_API_KEY', ''),
  experModel: 'claude-fable-5.1',
  databaseUrl: need('DATABASE_URL', ''),
  encryptionKey: need('SEAI_ENCRYPTION_KEY', ''),
  shopify: {
    apiKey: need('SHOPIFY_API_KEY', ''),
    apiSecret: need('SHOPIFY_API_SECRET', ''),
    appUrl: need('SHOPIFY_APP_URL', 'http://localhost:3000'),
    apiVersion: need('SHOPIFY_API_VERSION', '2025-07') as '2025-07',
    scopes: need(
      'SHOPIFY_SCOPES',
      'read_products,write_products,read_orders,write_orders,read_customers,write_customers,read_inventory,write_inventory,read_locations,read_discounts,write_discounts,read_content,write_content,read_themes,write_themes,read_files,write_files,read_analytics,read_markets,read_fulfillments,write_fulfillments'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  aiPrimaryModel: need('AI_PRIMARY_MODEL', ''),
  // Shared HMAC secret for verifying one-time gateway tickets (Phase 6).
  // Must match the gateway's GATEWAY_TOKEN_SIGNING_KEY. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  gatewaySecret: need('SEAI_GATEWAY_SECRET', ''),
  // Customer maintenance subscription (configurable — never hardcode in UI).
  maintenancePriceInr: Number(need('MAINTENANCE_PRICE_INR', '457')),
  maintenanceCurrency: need('MAINTENANCE_CURRENCY', 'INR'),
  maintenancePlanName: need('MAINTENANCE_PLAN_NAME', 'Website Maintenance'),
  // Transactional email (SMTP). Sender identity for all customer mail.
  mailFrom: need('MAIL_FROM', 'workwithseai@gmail.com'),
  mailFromName: need('MAIL_FROM_NAME', 'SEAI'),
  appUrl: need('APP_URL', 'https://dash.seai.store'),
  smtp: {
    host: need('MAIL_SMTP_HOST', ''),
    port: Number(need('MAIL_SMTP_PORT', '587')),
    secure: need('MAIL_SMTP_SECURE', 'false') === 'true',
    user: need('MAIL_SMTP_USER', ''),
    pass: need('MAIL_SMTP_PASS', ''),
  },
  // Public marketing/legal site. Used for public-site links inside emails.
  publicUrl: need('PUBLIC_URL', 'https://seai.store'),
  // Logo shown in the email header. Must be an absolute https URL reachable
  // without a login (Gmail proxies remote images). Empty = wordmark only.
  mailLogoUrl: need('SEAI_MAIL_LOGO_URL', `${need('APP_URL', 'https://dash.seai.store').replace(/\/$/, '')}/logo.png`),
  mailSupportEmail: need('SEAI_SUPPORT_EMAIL', need('MAIL_FROM', 'workwithseai@gmail.com')),
  // Shared secret for server-to-server authoritative events (seai.payments,
  // SEAI operations webhooks). Unset => the intake route stays disabled.
  eventsSharedSecret: need('SEAI_EVENTS_SHARED_SECRET', ''),
  // Kill switch for the whole client email pipeline (all lifecycle sends).
  // Useful for incidents and for dry QA runs. Delivery history is unaffected.
  mailEventsEnabled: need('SEAI_MAIL_EVENTS_ENABLED', 'true') !== 'false',
  // Recipient override for QA/preview runs. Set ONLY for a real mailbox that
  // must receive every preview email (e.g. the engineering inbox).
  mailQaRecipient: need('SEAI_MAIL_QA_RECIPIENT', ''),
  // Opt-in escape hatch that allows non-production hosts in generated links.
  // Never enable in production; used only for local rendering tests.
  mailAllowDevUrls: need('SEAI_MAIL_ALLOW_DEV_URLS', 'false') === 'true',
  // How long the HTTP layer waits for background mail to finish before
  // responding. Must stay under the serverless function timeout, otherwise
  // the send is cut off mid-flight and the delivery stays stuck in `sending`.
  mailDrainTimeoutMs: Number(need('SEAI_MAIL_DRAIN_TIMEOUT_MS', '8000')),
  // seai.storage control plane (server-side only — never expose to browsers).
  // See seai.storage docs/INTEGRATION_CONTRACT_FINAL.md for the full contract.
  storageServiceUrl: need('STORAGE_SERVICE_URL', 'http://localhost:4100'),
  storageServiceName: need('STORAGE_SERVICE_NAME', 'cdf'),
  storageServiceKey: need('STORAGE_SERVICE_KEY', ''),
  storageJwtSecret: need('STORAGE_JWT_SECRET', ''),
  storageTokenTtlSec: Number(need('STORAGE_TOKEN_TTL_SEC', '300')),
  storageProxyMaxBytes: Number(need('STORAGE_PROXY_MAX_BYTES', String(10 * 1024 * 1024))),
};

export function maskKeyId(index: number): string {
  return `key_${index + 1}`;
}

/** Returns count of configured Ollama keys without revealing them. */
export function configuredKeyCount(): number {
  return config.ollamaKeys.length;
}
