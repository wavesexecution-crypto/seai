import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import { config } from '../config.js';

export const shopify: any = shopifyApi({
  apiKey: config.shopify.apiKey || 'missing-key',
  apiSecretKey: config.shopify.apiSecret || 'missing-secret',
  scopes: config.shopify.scopes,
  hostName: config.shopify.appUrl.replace(/^https?:\/\//, ''),
  apiVersion: (config.shopify.apiVersion as any) ?? LATEST_API_VERSION,
  isEmbeddedApp: true,
});

export const APP_SCOPES = config.shopify.scopes;
