import { Router, type Request, type Response } from 'express';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';

export const reportsRouter = Router();
reportsRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'account_manager', 'project_manager', 'marketing', 'finance'));

// GET /api/ops/reports/pipeline - Leads pipeline by stage
reportsRouter.get('/pipeline', async (_req: Request, res: Response) => {
  const leads = await db.list('leads', {}, 10000);
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[String(l.stage)] = (byStage[String(l.stage)] ?? 0) + 1;
  const total = leads.length;
  const won = byStage['won'] ?? 0;
  const lost = byStage['lost'] ?? 0;
  const closed = won + lost;
  res.json({
    ok: true,
    total,
    by_stage: byStage,
    conversion_rate: closed ? Math.round((won / closed) * 100) : null,
    won_deals: won,
    lost_deals: lost,
  });
});

// GET /api/ops/reports/revenue - Invoice revenue by status
reportsRouter.get('/revenue', async (_req: Request, res: Response) => {
  const invoices = await db.list('invoices', {}, 10000);
  const byStatus: Record<string, { count: number; total_inr: number }> = {};
  let totalRevenue = 0;
  let outstanding = 0;
  for (const i of invoices) {
    const st = String(i.status);
    if (!byStatus[st]) byStatus[st] = { count: 0, total_inr: 0 };
    byStatus[st].count += 1;
    byStatus[st].total_inr += Number(i.total_inr ?? 0);
    if (st === 'paid') totalRevenue += Number(i.total_inr ?? 0);
    if (['sent', 'overdue'].includes(st)) outstanding += Number(i.total_inr ?? 0);
  }
  res.json({
    ok: true,
    total_revenue: totalRevenue,
    outstanding_payments: outstanding,
    by_status: byStatus,
    invoice_count: invoices.length,
  });
});

// GET /api/ops/reports/ads - Ad campaign performance summary
reportsRouter.get('/ads', async (_req: Request, res: Response) => {
  const campaigns = await db.list('marketing_campaigns', {}, 10000);
  const metrics = await db.list('ad_metrics', {}, 10000);
  const byPlatform: Record<string, { count: number; spend_inr: number }> = {};
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  for (const c of campaigns) {
    const p = String(c.platform);
    if (!byPlatform[p]) byPlatform[p] = { count: 0, spend_inr: 0 };
    byPlatform[p].count += 1;
    byPlatform[p].spend_inr += Number(c.budget_spent_inr ?? 0);
    totalSpend += Number(c.budget_spent_inr ?? 0);
  }
  for (const m of metrics) {
    totalImpressions += Number(m.impressions ?? 0);
    totalClicks += Number(m.clicks ?? 0);
    totalSpend += Number(m.spend_inr ?? 0);
  }
  res.json({
    ok: true,
    campaign_count: campaigns.length,
    by_platform: byPlatform,
    total_spend_inr: totalSpend,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
  });
});

// GET /api/ops/reports/content - Social post publishing summary
reportsRouter.get('/content', async (_req: Request, res: Response) => {
  const posts = await db.list('social_posts', {}, 10000);
  const byStatus: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  let published = 0;
  let failed = 0;
  for (const p of posts) {
    const st = String(p.status);
    const pl = String(p.platform);
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    byPlatform[pl] = (byPlatform[pl] ?? 0) + 1;
    if (st === 'published') published += 1;
    if (st === 'failed') failed += 1;
  }
  res.json({
    ok: true,
    total_posts: posts.length,
    by_status: byStatus,
    by_platform: byPlatform,
    published,
    failed,
  });
});
