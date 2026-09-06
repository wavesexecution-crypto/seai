import { config } from '../config.js';

async function main() {
  console.log('Shopify config check:');
  console.log('  apiVersion:', config.shopify.apiVersion);
  console.log('  appUrl:', config.shopify.appUrl);
  console.log('  key configured:', Boolean(config.shopify.apiKey));
  console.log('  secret configured:', Boolean(config.shopify.apiSecret));
  console.log('  scopes:', config.shopify.scopes.join(','));
  const { validateScopes } = await import('./scopes.js');
  const v = validateScopes(config.shopify.scopes);
  if (v.unknown.length) {
    console.error('  UNKNOWN SCOPES:', v.unknown.join(','));
    process.exit(1);
  }
  console.log('  all scopes documented: OK');
}
await main();
