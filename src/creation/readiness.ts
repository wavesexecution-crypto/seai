import { ProductService, CollectionService, ContentService, PoliciesService, ThemeService, AnalyticsService } from '../shopify/services.js';
import { Memory } from '../memory/store.js';

export interface ReadinessCheck {
  name: string;
  pass: boolean;
  severity: 'blocking' | 'warning';
  detail: string;
  resolution: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  generatedAt: string;
}

const PLACEHOLDERS = [/lorem ipsum/i, /\bTODO\b/, /\[.+?\]/, /\bxxx+\b/i, /\basdf/i, /sample text/i];

function hasPlaceholder(s: string): boolean {
  return PLACEHOLDERS.some((re) => re.test(s || ''));
}

/** Launch checklist against REAL store state. Blocking = must fix. Warning = human-action or advisory. */
export async function runReadiness(shop: string, accessToken?: string): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const warn = (name: string, detail: string, resolution: string) =>
    checks.push({ name, pass: true, severity: 'warning', detail, resolution });

  // Products
  let products: any[] = [];
  try { products = await ProductService.getProducts(shop, 50, accessToken); } catch (e: any) {
    checks.push({ name: 'Products exist', pass: false, severity: 'blocking', detail: `catalog unreadable: ${e.message}`, resolution: 'Reconnect the store / check scopes' });
  }
  if (products.length === 0 && !checks.some((c) => c.name === 'Products exist')) {
    checks.push({ name: 'Products exist', pass: false, severity: 'blocking', detail: 'catalog is empty', resolution: 'Run the catalog phase' });
  } else if (products.length > 0) {
    const active = products.filter((p) => String(p.status).toUpperCase() === 'ACTIVE');
    checks.push({
      name: 'Products exist', pass: active.length > 0, severity: 'blocking',
      detail: `${products.length} products, ${active.length} active`,
      resolution: active.length ? '' : 'Activate at least one product',
    });
    const noPrice = products.filter((p) => !(Number(p.price) > 0));
    checks.push({
      name: 'Prices exist', pass: noPrice.length === 0, severity: 'blocking',
      detail: noPrice.length ? `${noPrice.length} products missing prices` : 'all sampled products priced',
      resolution: noPrice.length ? 'Price every product before launch' : '',
    });
    const fake = products.filter((p) => hasPlaceholder(`${p.title} ${(p as any).descriptionHtml ?? ''}`));
    checks.push({
      name: 'No placeholder text', pass: fake.length === 0, severity: 'blocking',
      detail: fake.length ? `placeholder copy in: ${fake.map((p) => p.title).slice(0, 3).join(', ')}` : 'no placeholder copy detected',
      resolution: fake.length ? 'Rewrite flagged copy with real claims only' : '',
    });
  }

  // Inventory: real totals from the catalog sample
  if (products.length > 0) {
    const total = products.reduce((a, p) => a + Number((p as any).inventoryTotal ?? 0), 0);
    checks.push({
      name: 'Inventory state valid', pass: total > 0, severity: 'blocking',
      detail: `sampled on-hand total: ${total}`,
      resolution: total > 0 ? '' : 'Declare opening stock per product (recorded as a declared assumption — confirm physical stock)',
    });
  }

  // Collections
  try {
    const cols = await CollectionService.getCollections(shop, accessToken);
    checks.push({
      name: 'Collections exist', pass: cols.length > 0, severity: 'blocking',
      detail: cols.length ? `${cols.length} collections` : 'no collections',
      resolution: cols.length ? '' : 'Create merchandising collections',
    });
  } catch (e: any) {
    checks.push({ name: 'Collections exist', pass: false, severity: 'blocking', detail: String(e.message).slice(0, 120), resolution: 'Check scopes' });
  }

  // Pages / content
  try {
    const pages = await ContentService.getPages(shop, accessToken);
    checks.push({
      name: 'Store content present', pass: pages.length >= 2, severity: 'warning',
      detail: `${pages.length} pages`,
      resolution: pages.length >= 2 ? '' : 'Publish About / FAQ / shipping pages',
    });
  } catch { /* ignore */ }

  // Policies
  try {
    const pol: any = await PoliciesService.getPolicies(shop, accessToken);
    const missing = ['refundPolicy', 'shippingPolicy', 'termsOfService', 'privacyPolicy'].filter((k) => !pol?.[k]?.body);
    checks.push({
      name: 'Policies present', pass: missing.length === 0, severity: 'warning',
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'core policies published',
      resolution: missing.length ? 'Publish missing policies' : '',
    });
  } catch { /* ignore */ }

  // Theme / storefront
  try {
    const themes: any[] = await ThemeService.getThemes(shop, accessToken);
    checks.push({
      name: 'Theme installed', pass: themes.length > 0, severity: 'blocking',
      detail: themes.length ? `active: ${themes.find((t) => t.role === 'MAIN')?.name ?? themes[0]?.name}` : 'no theme',
      resolution: themes.length ? '' : 'Install a theme (human action in Theme Store)',
    });
  } catch { /* ignore */ }

  // Human-action items Shopify exposes no API for
  warn('Navigation wired', 'menus have no public Admin API — unverifiable by SEAI', 'Wire menus in Online Store > Navigation (one human step)');
  warn('Trademark review', 'registry verification unavailable', 'Human legal review of the brand name before scale');
  warn('Domain verified', 'DNS lives outside Shopify APIs', 'Complete domain verification in Settings > Domains if using a custom domain');

  // Analytics reachable
  try {
    await AnalyticsService.getAnalytics(shop, accessToken);
    checks.push({ name: 'Analytics readable', pass: true, severity: 'warning', detail: 'order metrics computable', resolution: '' });
  } catch { /* ignore */ }

  // Trademark in-catalog collision would already have blocked brand phase; re-assert via memory
  try {
    const mem = await Memory.recall(shop);
    const brand: any = mem['STORE_MEMORY:brand'];
    if (brand?.trademark?.collision) {
      checks.push({ name: 'Brand collision', pass: false, severity: 'blocking', detail: brand.trademark.note, resolution: 'Rename the brand' });
    }
  } catch { /* ignore */ }

  const ready = !checks.some((c) => !c.pass && c.severity === 'blocking');
  return { ready, checks, generatedAt: new Date().toISOString() };
}
