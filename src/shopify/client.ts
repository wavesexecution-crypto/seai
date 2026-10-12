import { config } from '../config.js';
import { getAccessToken } from './sessions.js';

export const API_VERSION = config.shopify.apiVersion;
export const GRAPHQL_ENDPOINT = (shop: string) =>
  `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

export interface ThrottleInfo { available: number; restoreRate: number; maxAvailable: number; currentlyAvailable?: number; }

export class ShopifyApiError extends Error {
  status: number;
  shopErrors: any[];
  throttled = false;
  constructor(message: string, status: number, shopErrors: any[] = []) {
    super(message);
    this.status = status;
    this.shopErrors = shopErrors;
    this.throttled = status === 429 || JSON.stringify(shopErrors).includes('THROTTLED');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GraphQL Admin API client: typed queries live in services/, never in agent code. */
export async function shopifyGraphQL<T>(
  shop: string,
  query: string,
  variables: Record<string, any> = {},
  opts: { accessToken?: string; timeoutMs?: number; retries?: number; isMutation?: boolean } = {}
): Promise<{ data: T; throttle?: ThrottleInfo }> {
  const token = opts.accessToken ?? (await getAccessToken(shop));
  if (!token) throw new ShopifyApiError(`no Shopify session for shop ${shop} — install the app first`, 401);
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxRetries = opts.retries ?? (opts.isMutation ? 0 : 3); // never blind-retry unsafe mutations
  let lastErr: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new Error('shopify timeout')), timeoutMs);
    try {
      const res = await fetch(GRAPHQL_ENDPOINT(shop), {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '2');
        if (attempt < maxRetries) { await sleep(Math.min(10000, retryAfter * 1000)); continue; }
        throw new ShopifyApiError('shopify throttled', 429);
      }
      if (!res.ok) throw new ShopifyApiError(`shopify http ${res.status}`, res.status);
      const j: any = await res.json();
      if (j.errors?.length) throw new ShopifyApiError(`shopify graphql: ${JSON.stringify(j.errors).slice(0, 500)}`, 200, j.errors);
      const throttle = j.extensions?.cost?.throttleStatus as ThrottleInfo | undefined;
      if (throttle && (throttle.currentlyAvailable ?? throttle.available ?? 1000) < 100) {
        await sleep(1000); // gentle backpressure before hitting the bucket limit
      }
      return { data: j.data as T, throttle };
    } catch (e: any) {
      lastErr = e;
      if (e instanceof ShopifyApiError && (e.status === 401 || e.status === 403 || opts.isMutation)) throw e;
      if (attempt < maxRetries) { await sleep(500 * 2 ** attempt); continue; }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Cursor pagination helper — every list service uses this. */
export async function paginate<T>(
  shop: string,
  buildQuery: (after: string | null) => { query: string; variables: Record<string, any> },
  extract: (data: any) => { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } },
  opts: { accessToken?: string; maxPages?: number } = {}
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  const maxPages = opts.maxPages ?? 10;
  for (let p = 0; p < maxPages; p++) {
    const { query, variables } = buildQuery(after);
    const { data } = await shopifyGraphQL<any>(shop, query, variables, { accessToken: opts.accessToken });
    const { nodes, pageInfo } = extract(data);
    out.push(...nodes);
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return out;
}

export const FRAG = {
  product: `fragment ProductFrag on Product { id title handle status vendor productType tags priceRangeV2 { minVariantPrice { amount currencyCode } } totalInventory variantsCount: variantsCount { count } }`,
  order: `fragment OrderFrag on Order { id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } subtotalPriceSet { shopMoney { amount currencyCode } } customer { id email } lineItems(first: 20) { nodes { title quantity } } }`,
  customer: `fragment CustomerFrag on Customer { id email firstName lastName numberOfOrders amountSpent { amount currencyCode } tags }`,
};
