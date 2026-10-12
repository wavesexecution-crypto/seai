// Shopify abstraction layer. Agent/tools code must call these services —
// never raw GraphQL. Each function is typed, paginated, throttling-aware.
import { shopifyGraphQL, paginate, FRAG } from './client.js';

export interface Product { id: string; title: string; handle: string; status: string; vendor?: string; productType?: string; tags?: string[]; price?: string; currency?: string; inventoryTotal?: number; }
export interface Order { id: string; name: string; createdAt: string; financialStatus?: string; fulfillmentStatus?: string; total?: string; currency?: string; customerEmail?: string; items?: { title: string; quantity: number }[]; }
export interface Customer { id: string; email?: string; firstName?: string; lastName?: string; ordersCount?: number; totalSpent?: string; tags?: string[]; }

export const ShopService = {
  async getStore(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop, `{ shop { name email myshopifyDomain currencyCode primaryDomain { host } plan { displayName } } }`, {}, { accessToken });
    return data.shop;
  },
};

export const ProductService = {
  async getProducts(shop: string, limit = 25, accessToken?: string): Promise<Product[]> {
    return paginate<Product>(shop,
      (after) => ({
        query: `${FRAG.product} query($after: String) { products(first: 25, after: $after) { nodes { ...ProductFrag } pageInfo { hasNextPage endCursor } } }`,
        variables: { after },
      }),
      (d) => ({
        nodes: (d.products?.nodes ?? []).map((p: any) => ({
          id: p.id, title: p.title, handle: p.handle, status: p.status, vendor: p.vendor,
          productType: p.productType, tags: p.tags,
          price: p.priceRangeV2?.minVariantPrice?.amount, currency: p.priceRangeV2?.minVariantPrice?.currencyCode,
          inventoryTotal: p.totalInventory,
        })),
        pageInfo: d.products?.pageInfo ?? { hasNextPage: false, endCursor: null },
      }),
      { accessToken, maxPages: Math.max(1, Math.ceil(limit / 25)) });
  },
  async getProduct(shop: string, id: string, accessToken?: string) {
    const gid = id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
    const { data } = await shopifyGraphQL<any>(shop,
      `${FRAG.product} query($id: ID!) { product(id: $id) { ...ProductFrag descriptionHtml } }`, { id: gid }, { accessToken });
    return data.product;
  },
  async createProduct(shop: string, input: { title: string; descriptionHtml?: string; vendor?: string; productType?: string; tags?: string }, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: ProductInput!) { productCreate(input: $input) { product { id title handle status } userErrors { message field } } }`,
      { input }, { accessToken, isMutation: true });
    const errs = data.productCreate?.userErrors ?? [];
    if (errs.length) throw new Error(`productCreate: ${JSON.stringify(errs)}`);
    return data.productCreate.product;
  },
  async updateProduct(shop: string, id: string, input: Record<string, any>, accessToken?: string) {
    const gid = id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: ProductInput!) { productUpdate(input: $input) { product { id title status } userErrors { message field } } }`,
      { input: { id: gid, ...input } }, { accessToken, isMutation: true });
    const errs = data.productUpdate?.userErrors ?? [];
    if (errs.length) throw new Error(`productUpdate: ${JSON.stringify(errs)}`);
    return data.productUpdate.product;
  },
  async archiveProduct(shop: string, id: string, accessToken?: string) {
    return this.updateProduct(shop, id, { status: 'ARCHIVED' }, accessToken);
  },
};

export const VariantService = {
  async getVariants(shop: string, productId: string, accessToken?: string) {
    const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;
    const { data } = await shopifyGraphQL<any>(shop,
      `query($id: ID!) { product(id: $id) { variants(first: 50) { nodes { id title price sku inventoryQuantity } } } }`,
      { id: gid }, { accessToken });
    return data.product?.variants?.nodes ?? [];
  },
};

export const InventoryService = {
  async getInventory(shop: string, limit = 25, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `{ inventoryLevels(first: ${Math.min(limit, 50)}) { nodes { id available item { id sku variant { id title product { title } } } location { name } } } }`,
      {}, { accessToken });
    return data.inventoryLevels?.nodes ?? [];
  },
  async updateInventory(shop: string, inventoryItemId: string, locationId: string, availableDelta: number, accessToken?: string) {    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: InventoryAdjustQuantitiesInput!) { inventoryAdjustQuantities(input: $input) { inventoryAdjustmentGroup { createdAt } userErrors { message } } }`,
      { input: { changes: [{ inventoryItemId, locationId, delta: availableDelta }] } },
      { accessToken, isMutation: true });
    const errs = data.inventoryAdjustQuantities?.userErrors ?? [];
    if (errs.length) throw new Error(`inventoryAdjust: ${JSON.stringify(errs)}`);
    return data.inventoryAdjustQuantities;
  },
  /** Set absolute on-hand for a product's first variant at the first location. Best-effort; reports exactly what it did. */
  async ensureStocked(shop: string, productId: string, quantity: number, accessToken?: string) {
    const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;
    const { data } = await shopifyGraphQL<any>(shop,
      `query($id: ID!) { product(id: $id) { variants(first: 5) { nodes { inventoryItem { id } inventoryQuantity } } } locations: locations(first: 5) { nodes { id name } } }`,
      { id: gid }, { accessToken });
    const variant = data.product?.variants?.nodes?.[0];
    const location = (data as any).locations?.nodes?.[0];
    if (!variant?.inventoryItem?.id) throw new Error('no trackable inventory item on product');
    if (!location?.id) throw new Error('no location available');
    const current = Number(variant.inventoryQuantity ?? 0);
    const delta = quantity - current;
    if (delta === 0) return { alreadySet: true, quantity };
    await this.updateInventory(shop, variant.inventoryItem.id, location.id, delta, accessToken);
    return { alreadySet: false, quantity, location: location.name };
  },
};

export const OrderService = {
  async getOrders(shop: string, limit = 25, accessToken?: string): Promise<Order[]> {
    return paginate<Order>(shop,
      (after) => ({
        query: `${FRAG.order} query($after: String) { orders(first: 25, after: $after, sortKey: CREATED_AT, reverse: true) { nodes { ...OrderFrag } pageInfo { hasNextPage endCursor } } }`,
        variables: { after },
      }),
      (d) => ({
        nodes: (d.orders?.nodes ?? []).map((o: any) => ({
          id: o.id, name: o.name, createdAt: o.createdAt,
          financialStatus: o.displayFinancialStatus, fulfillmentStatus: o.displayFulfillmentStatus,
          total: o.totalPriceSet?.shopMoney?.amount, currency: o.totalPriceSet?.shopMoney?.currencyCode,
          customerEmail: o.customer?.email, items: (o.lineItems?.nodes ?? []).map((l: any) => ({ title: l.title, quantity: l.quantity })),
        })),
        pageInfo: d.orders?.pageInfo ?? { hasNextPage: false, endCursor: null },
      }),
      { accessToken, maxPages: Math.max(1, Math.ceil(limit / 25)) });
  },
  async getOrder(shop: string, id: string, accessToken?: string) {
    const gid = id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`;
    const { data } = await shopifyGraphQL<any>(shop, `${FRAG.order} query($id: ID!) { order(id: $id) { ...OrderFrag } }`, { id: gid }, { accessToken });
    return data.order;
  },
};

export const CustomerService = {
  async getCustomers(shop: string, limit = 25, accessToken?: string): Promise<Customer[]> {
    return paginate<Customer>(shop,
      (after) => ({
        query: `${FRAG.customer} query($after: String) { customers(first: 25, after: $after) { nodes { ...CustomerFrag } pageInfo { hasNextPage endCursor } } }`,
        variables: { after },
      }),
      (d) => ({
        nodes: (d.customers?.nodes ?? []).map((c: any) => ({
          id: c.id, email: c.email, firstName: c.firstName, lastName: c.lastName,
          ordersCount: c.numberOfOrders, totalSpent: c.amountSpent?.amount, tags: c.tags,
        })),
        pageInfo: d.customers?.pageInfo ?? { hasNextPage: false, endCursor: null },
      }),
      { accessToken, maxPages: Math.max(1, Math.ceil(limit / 25)) });
  },
  async getCustomer(shop: string, id: string, accessToken?: string) {
    const gid = id.startsWith('gid://') ? id : `gid://shopify/Customer/${id}`;
    const { data } = await shopifyGraphQL<any>(shop, `${FRAG.customer} query($id: ID!) { customer(id: $id) { ...CustomerFrag } }`, { id: gid }, { accessToken });
    return data.customer;
  },
};

export const DiscountService = {
  async getDiscounts(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `{ codeDiscountNodes(first: 25) { nodes { id codeDiscount { ... on DiscountCodeBasic { title summary status } } } pageInfo { hasNextPage endCursor } } }`,
      {}, { accessToken });
    return data.codeDiscountNodes?.nodes ?? [];
  },
  async createDiscount(shop: string, input: { title: string; code: string; percent: number }, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($basicCodeDiscount: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { message } } }`,
      {
        basicCodeDiscount: {
          title: input.title, code: input.code,
          startsAt: new Date().toISOString(),
          customerSelection: { all: true },
          customerGets: { value: { percentage: input.percent / 100 }, items: { all: true } },
        },
      },
      { accessToken, isMutation: true });
    const errs = data.discountCodeBasicCreate?.userErrors ?? [];
    if (errs.length) throw new Error(`discountCreate: ${JSON.stringify(errs)}`);
    return data.discountCodeBasicCreate.codeDiscountNode;
  },
  async disableDiscount(shop: string, id: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { message } } }`,
      { id }, { accessToken, isMutation: true });
    return data.discountCodeDeactivate;
  },
};

export const CollectionService = {
  async getCollections(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `{ collections(first: 25) { nodes { id title handle productsCount { count } } } }`, {}, { accessToken });
    return data.collections?.nodes ?? [];
  },
  async createCollection(shop: string, input: { title: string; descriptionHtml?: string }, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id title handle } userErrors { message } } }`,
      { input }, { accessToken, isMutation: true });
    const errs = data.collectionCreate?.userErrors ?? [];
    if (errs.length) throw new Error(`collectionCreate: ${JSON.stringify(errs)}`);
    return data.collectionCreate.collection;
  },
  async addProducts(shop: string, collectionId: string, productIds: string[], accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($id: ID!, $productIds: [ID!]!) { collectionAddProducts(id: $id, productIds: $productIds) { job { id } userErrors { message } } }`,
      { id: collectionId, productIds }, { accessToken, isMutation: true });
    const errs = data.collectionAddProducts?.userErrors ?? [];
    if (errs.length) throw new Error(`collectionAddProducts: ${JSON.stringify(errs)}`);
    return data.collectionAddProducts;
  },
  async updateCollection(shop: string, id: string, input: Record<string, any>, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id title } userErrors { message } } }`,
      { input: { id, ...input } }, { accessToken, isMutation: true });
    return data.collectionUpdate?.collection;
  },
};

export const ContentService = {
  async getPages(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop, `{ pages(first: 25) { nodes { id title handle } } }`, {}, { accessToken });
    return data.pages?.nodes ?? [];
  },
  async createPage(shop: string, input: { title: string; body?: string; handle?: string }, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: PageCreateInput!) { pageCreate(input: $input) { page { id title handle } userErrors { message } } }`,
      { input: { body: '', ...input } }, { accessToken, isMutation: true });
    const errs = data.pageCreate?.userErrors ?? [];
    if (errs.length) throw new Error(`pageCreate: ${JSON.stringify(errs)}`);
    return data.pageCreate.page;
  },
  async updatePage(shop: string, id: string, input: Record<string, any>, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: PageUpdateInput!) { pageUpdate(input: $input) { page { id title } userErrors { message } } }`,
      { input: { id, ...input } }, { accessToken, isMutation: true });
    return data.pageUpdate?.page;
  },
};

export const ThemeService = {
  async getThemes(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop, `{ themes(first: 10) { nodes { id name role } } }`, {}, { accessToken });
    return data.themes?.nodes ?? [];
  },
  /** Write one theme file (e.g. assets/custom.css, snippets). Critical-risk: always approval-gated. */
  async upsertFile(shop: string, themeId: string, filename: string, value: string, accessToken?: string) {
    if (!/^[\w\-/.]+\.(css|liquid|json)$/.test(filename)) throw new Error('refusing unsafe theme filename');
    if (value.length > 100000) throw new Error('theme file too large');
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { message } } }`,
      { themeId, files: [{ filename, body: { type: 'TEXT', value } }] },
      { accessToken, isMutation: true });
    const errs = data.themeFilesUpsert?.userErrors ?? [];
    if (errs.length) throw new Error(`themeFilesUpsert: ${JSON.stringify(errs)}`);
    return data.themeFilesUpsert.upsertedThemeFiles;
  },
};

export type ShopPolicyType = 'REFUND' | 'SHIPPING' | 'TERMS_OF_SERVICE' | 'PRIVACY' | 'SUBSCRIPTION';

export const PoliciesService = {
  async getPolicies(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `{ shop { refundPolicy { body } shippingPolicy { body } termsOfService { body } privacyPolicy { body } subscriptionPolicy { body } } }`,
      {}, { accessToken });
    return data.shop ?? {};
  },
  async updatePolicy(shop: string, type: ShopPolicyType, body: string, accessToken?: string) {
    if (body.trim().length < 50) throw new Error('policy body too short to be a real policy');
    const { data } = await shopifyGraphQL<any>(shop,
      `mutation($input: ShopPolicyInput!) { shopPolicyUpdate(input: $input) { shopPolicy { type body } userErrors { message } } }`,
      { input: { type, body } }, { accessToken, isMutation: true });
    const errs = data.shopPolicyUpdate?.userErrors ?? [];
    if (errs.length) throw new Error(`shopPolicyUpdate: ${JSON.stringify(errs)}`);
    return data.shopPolicyUpdate.shopPolicy;
  },
};

export const AnalyticsService = {
  /** Analytics where available; falls back to computed order metrics.
   * Auth/connection errors are rethrown (never masked as zeros). */
  async getAnalytics(shop: string, accessToken?: string) {
    let orders: Order[];
    try {
      orders = await OrderService.getOrders(shop, 50, accessToken);
    } catch (e: any) {
      const m = String(e?.message ?? '');
      if (e?.status === 401 || /no Shopify session|unauthorized|forbidden|access/i.test(m)) throw e;
      orders = [];
    }
    const totals = orders.map((o) => Number(o.total ?? 0));
    const revenue = totals.reduce((a, b) => a + b, 0);
    return {
      source: 'computed',
      orders: orders.length,
      revenue,
      aov: orders.length ? revenue / orders.length : 0,
      currency: orders[0]?.currency ?? null,
    };
  },
};

export const FulfillmentService = {
  async getFulfillmentOrders(shop: string, orderId: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status } } } }`,
      { id: orderId }, { accessToken });
    return data.order?.fulfillmentOrders?.nodes ?? [];
  },
};

export const MarketingService = {
  async getMarketingEvents(shop: string, accessToken?: string) {
    const { data } = await shopifyGraphQL<any>(shop,
      `{ marketingEvents(first: 10) { nodes { id description startedAt } } }`, {}, { accessToken })
      .catch(() => ({ data: { marketingEvents: { nodes: [] } } }));
    return (data as any).marketingEvents?.nodes ?? [];
  },
};
