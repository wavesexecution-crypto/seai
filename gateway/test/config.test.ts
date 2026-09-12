import { describe, expect, it } from 'vitest';
import { loadConfig, PINNED_API_VERSION } from '../src/config.js';

describe('loadConfig', () => {
  it('boots with zero overrides using safe defaults', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' });
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.isProduction).toBe(false);
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.shopifyApiVersion).toBe(PINNED_API_VERSION);
    expect(cfg.shopifyApiSecret).toBeUndefined();
  });

  it('parses SHOPIFY_API_SCOPES into an array', () => {
    const cfg = loadConfig({
      NODE_ENV: 'development',
      SHOPIFY_API_SCOPES: 'read_products, write_products,read_orders',
    });
    expect(cfg.shopifyApiScopes).toEqual([
      'read_products',
      'write_products',
      'read_orders',
    ]);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', PORT: 'not-a-number' })).toThrow(/PORT/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an API version that drifts from the pinned SEAI contract', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', SHOPIFY_API_VERSION: '2026-07' }))
      .toThrow(/SHOPIFY_API_VERSION/);
    expect(() => loadConfig({ NODE_ENV: 'development', SHOPIFY_API_VERSION: 'unstable' }))
      .toThrow(/SHOPIFY_API_VERSION/);
  });

  it('flags production when NODE_ENV=production', () => {
    const cfg = loadConfig({ NODE_ENV: 'production' });
    expect(cfg.isProduction).toBe(true);
  });
});