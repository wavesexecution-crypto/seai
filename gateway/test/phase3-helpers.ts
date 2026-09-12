/**
 * Shared Phase-3 helpers (no tests here — importing this file is side-effect
 * free apart from helper definitions).
 */
import { beforeEach } from 'vitest';
import { createHarness, TEST_SHOP, type Harness } from './harness.js';

export let h: Harness;

beforeEach(() => {
  h = createHarness();
});

export const AUTH = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'x-shopify-shop-domain': TEST_SHOP,
});

export function encodeBody(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

export function parseBody(token: string): Record<string, unknown> {
  const [body] = token.split('.') as [string, string];
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

export async function startLinkFlow(shop: string = TEST_SHOP): Promise<string> {
  await h.installSession(shop);
  await h.linkStore({ shop });
  const sessionToken =
    shop === TEST_SHOP ? h.mintSessionToken() : h.mintSessionToken({ shopDomain: shop });
  const headers =
    shop === TEST_SHOP
      ? AUTH(sessionToken)
      : { Authorization: `Bearer ${sessionToken}`, 'x-shopify-shop-domain': shop };
  const res = await h.req().get('/connect/start').set(headers);
  if (res.status !== 302) {
    throw new Error(`startLinkFlow failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const location = String(res.headers.location ?? '');
  const url = new URL(location);
  const claim = url.searchParams.get('connect_claim');
  if (!claim) throw new Error('startLinkFlow: missing connect_claim');
  return claim;
}
