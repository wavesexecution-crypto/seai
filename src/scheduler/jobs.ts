import { db } from '../db/db.js';
import { runAgent } from '../agent/loop.js';
import { getAccessToken } from '../shopify/sessions.js';

export interface JobDef { name: string; everyMs: number; kinds: string; run: (stores: { shop: string; storeId: string }[]) => Promise<void>; }

async function storeList(): Promise<{ shop: string; storeId: string }[]> {
  try {
    const sessions = await db.list('shopify_sessions', {}, 50);
    const shops = [...new Set(sessions.map((s) => s.shop))];
    const stores = await db.list('stores', {}, 50);
    return shops.map((shop) => ({ shop, storeId: stores.find((s) => s.shop_domain === shop)?.id ?? shop }));
  } catch { return []; }
}

async function ensureStoreRow(shop: string): Promise<string> {
  try {
    const ex = await db.list('stores', { shop_domain: shop } as any, 1);
    if (ex[0]) return ex[0].id;
    const row = await db.insert('stores', { id: shop, shop_domain: shop, shop_name: shop, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return row.id;
  } catch { return shop; }
}

export const JOBS: JobDef[] = [
  {
    name: 'daily-analysis', everyMs: 24 * 60 * 60 * 1000,
    kinds: 'What changed? What matters? What is abnormal? What opportunities exist?',
    run: async (stores) => {
      for (const s of stores) {
        const storeId = await ensureStoreRow(s.shop);
        const accessToken = (await getAccessToken(s.shop)) ?? undefined;
        await runAgent({ shop: s.shop, storeId, prompt: 'Daily analysis: what changed, what matters, anomalies, opportunities?', kind: 'schedule:daily', accessToken }).catch(() => undefined);
      }
    },
  },
  {
    name: 'inventory-check', everyMs: 6 * 60 * 60 * 1000,
    kinds: 'inventory checks, stockout risk',
    run: async (stores) => {
      for (const s of stores) {
        const storeId = await ensureStoreRow(s.shop);
        const accessToken = (await getAccessToken(s.shop)) ?? undefined;
        await runAgent({ shop: s.shop, storeId, prompt: 'Review inventory risk and stockout exposure.', kind: 'schedule:inventory', accessToken }).catch(() => undefined);
      }
    },
  },
  {
    name: 'experiment-eval', everyMs: 12 * 60 * 60 * 1000,
    kinds: 'experiment evaluation, action evaluation',
    run: async (stores) => {
      for (const s of stores) {
        const storeId = await ensureStoreRow(s.shop);
        const accessToken = (await getAccessToken(s.shop)) ?? undefined;
        await runAgent({ shop: s.shop, storeId, prompt: 'Evaluate open experiments and recent actions.', kind: 'schedule:experiments', accessToken }).catch(() => undefined);
      }
    },
  },
];

export function startScheduler(): void {
  // No interval scheduler on serverless (Vercel): use Vercel Cron hitting an
  // HTTP endpoint instead. Explicit opt-in always wins.
  if (process.env.SEAI_SCHEDULER === 'on') { /* fall through */ }
  else if (process.env.SEAI_SCHEDULER === 'off' || process.env.VERCEL) return;
  for (const j of JOBS) {
    setInterval(async () => {
      try { await j.run(await storeList()); } catch { /* never crash on schedule */ }
    }, j.everyMs).unref?.();
  }
}
