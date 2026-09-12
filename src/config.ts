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
};

export function maskKeyId(index: number): string {
  return `key_${index + 1}`;
}

/** Returns count of configured Ollama keys without revealing them. */
export function configuredKeyCount(): number {
  return config.ollamaKeys.length;
}
