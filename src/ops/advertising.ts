import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { requireStaffRole } from '../auth/middleware.js';
import { now } from '../growth/service.js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { isConfigured as googleAdsConfigured, setCampaignStatus as googleAdsSetCampaignStatus, syncCampaignMetrics as googleAdsSyncCampaignMetrics } from './google-ads.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;

function encryptionKey(): Buffer {
  const raw = process.env.SEAI_ENCRYPTION_KEY || '';
  if (!raw) throw new Error('SEAI_ENCRYPTION_KEY is not configured');
  return scryptSync(raw, 'seai-ads-integration', KEY_LEN);
}

function encrypt(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') });
}

function decrypt(ciphertext: string): string {
  const key = encryptionKey();
  const { iv, tag, data } = JSON.parse(ciphertext) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export const advertisingRouter = Router();
advertisingRouter.use(requireStaffRole('owner', 'administrator', 'admin', 'marketing'));

const adAccountSchema = z.object({
  platform: z.enum(['meta', 'google']),
  account_id: z.string().trim().min(1),
  account_name: z.string().trim().min(1),
  access_token: z.string().trim().min(1),
  refresh_token: z.string().trim().optional(),
  token_expires_at: z.string().trim().optional(),
});

// GET /api/ops/ads/accounts - List ad account integrations
advertisingRouter.get('/accounts', async (_req: Request, res: Response) => {
  const rows = await db.list('social_integrations', { platform: 'meta' }, 1000);
  const google = await db.list('social_integrations', { platform: 'google' }, 1000);
  const all = [...rows, ...google].map((r) => ({ ...r, access_token_enc: undefined, refresh_token_enc: undefined }));
  res.json({ ok: true, accounts: all });
});

// POST /api/ops/ads/accounts - Connect ad account (stores into social_integrations)
advertisingRouter.post('/accounts', async (req: Request, res: Response) => {
  const parsed = adAccountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid account' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  await db.insert('social_integrations', {
    id,
    platform: d.platform,
    account_id: d.account_id,
    account_name: d.account_name,
    access_token_enc: encrypt(d.access_token),
    refresh_token_enc: d.refresh_token ? encrypt(d.refresh_token) : null,
    token_expires_at: d.token_expires_at || null,
    is_active: true,
    health_status: 'healthy',
    workspace_type: 'seai',
    workspace_id: null,
    created_by: req.user!.id,
    created_at: now(),
    updated_at: now(),
  });
  res.json({ ok: true, id });
});

// GET /api/ops/ads/campaigns - List campaigns (marketing_campaigns table)
advertisingRouter.get('/campaigns', async (req: Request, res: Response) => {
  const { status, platform } = req.query;
  let rows = await db.list('marketing_campaigns', {}, 10000);
  if (status) rows = rows.filter((r) => r.status === status);
  if (platform) rows = rows.filter((r) => r.platform === platform);
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ ok: true, campaigns: rows.slice(0, 500), total: rows.length });
});

// POST /api/ops/ads/campaigns - Create campaign
advertisingRouter.post('/campaigns', async (req: Request, res: Response) => {
  const parsed = z.object({
    integration_id: z.string().trim().optional().or(z.literal('')),
    platform: z.enum(['meta', 'google']),
    name: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(200),
    budget_total_inr: z.coerce.number().min(0).default(0),
    budget_daily_inr: z.coerce.number().min(0).optional(),
    currency: z.string().trim().min(1).max(10).default('INR'),
    start_date: z.string().trim().optional(),
    end_date: z.string().trim().optional(),
    targeting: z.record(z.any()).optional(),
    approval_required: z.boolean().default(true),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid campaign' }); return; }
  const d = parsed.data;
  const id = randomUUID();
  const status = d.approval_required ? 'pending_approval' : 'draft';
  await db.insert('marketing_campaigns', {
    id, integration_id: d.integration_id || null, platform: d.platform,
    name: d.name, objective: d.objective, status,
    budget_total_inr: d.budget_total_inr, budget_daily_inr: d.budget_daily_inr || null,
    budget_spent_inr: 0, currency: d.currency,
    start_date: d.start_date || null, end_date: d.end_date || null,
    targeting: d.targeting ? JSON.stringify(d.targeting) : '{}',
    approval_required: Boolean(d.approval_required),
    created_by: req.user!.id,
    created_at: now(), updated_at: now(),
  });
  res.json({ ok: true, id, status });
});

// PATCH /api/ops/ads/campaigns/:id - Update campaign
advertisingRouter.patch('/campaigns/:id', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  const allowed = ['name', 'objective', 'status', 'budget_total_inr', 'budget_daily_inr', 'start_date', 'end_date', 'targeting', 'approval_required', 'external_campaign_id'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      if (k === 'targeting') patch[k] = JSON.stringify(req.body[k]);
      else patch[k] = req.body[k];
    }
  }
  if ('status' in patch) {
    const s = String(patch.status);
    if (!['draft', 'pending_approval', 'approved', 'active', 'paused', 'completed', 'cancelled'].includes(s)) {
      res.status(400).json({ ok: false, error: 'Invalid status' }); return;
    }
    if (s === 'approved') patch.approved_by = req.user!.id;
    if (s === 'approved') patch.approved_at = now();
  }
  patch.updated_at = now();
  await db.update('marketing_campaigns', req.params.id, patch);
  res.json({ ok: true });
});

// POST /api/ops/ads/campaigns/:id/approve - Approve campaign
advertisingRouter.post('/campaigns/:id/approve', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  await db.update('marketing_campaigns', req.params.id, {
    status: 'approved', approved_by: req.user!.id, approved_at: now(), updated_at: now(),
  });
  res.json({ ok: true, status: 'approved' });
});

// POST /api/ops/ads/campaigns/:id/launch - Launch campaign
advertisingRouter.post('/campaigns/:id/launch', async (req: Request, res: Response) => {
  const campaign = (await db.list('marketing_campaigns', { id: req.params.id }, 1))[0];
  if (!campaign) { res.status(404).json({ ok: false, error: 'Campaign not found' }); return; }
  if (campaign.status !== 'approved') {
    res.status(400).json({ ok: false, error: 'Campaign must be approved before launch' });
    return;
  }
  const integration = campaign.integration_id ? (await db.list('social_integrations', { id: campaign.integration_id }, 1))[0] : null;
  try {
    if (campaign.platform === 'meta' && integration) {
      const accessToken = decrypt(integration.access_token_enc);
      const publishResp = await fetch(`https://graph.facebook.com/v21.0/${campaign.integration_id}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          name: campaign.name,
          objective: campaign.objective,
          status: 'ACTIVE',
          daily_budget: campaign.budget_daily_inr,
          access_token: accessToken,
        }),
      });
      const publishData = await publishResp.json();
      if (!publishResp.ok || !publishData.id) {
        await db.update('marketing_campaigns', req.params.id, { status: 'failed', updated_at: now() });
        res.status(400).json({ ok: false, error: publishData.error?.message || 'Failed to launch campaign' });
        return;
      }
      await db.update('marketing_campaigns', req.params.id, {
        status: 'active', external_campaign_id: publishData.id, updated_at: now(),
      });
    } else if (campaign.platform === 'google') {
      if (!integration) {
        await db.update('marketing_campaigns', req.params.id, { status: 'failed', updated_at: now() });
        res.status(400).json({ ok: false, error: 'No integration linked to campaign' });
        return;
      }
      if (!googleAdsConfigured()) {
        await db.update('marketing_campaigns', req.params.id, { status: 'failed', updated_at: now() });
        res.status(503).json({ ok: false, error: 'Google Ads developer token not configured' });
        return;
      }
      const accessToken = decrypt(integration.access_token_enc);
      const customerId = campaign.integration_id;
      try {
        await googleAdsSetCampaignStatus(customerId, accessToken, campaign.external_campaign_id || campaign.id, 'ENABLED');
        await db.update('marketing_campaigns', req.params.id, {
          status: 'active', external_campaign_id: campaign.external_campaign_id || campaign.id, updated_at: now(),
        });
      } catch (err: any) {
        await db.update('marketing_campaigns', req.params.id, { status: 'failed', updated_at: now() });
        res.status(502).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
        return;
      }
    } else {
      await db.update('marketing_campaigns', req.params.id, { status: 'active', updated_at: now() });
    }
    res.json({ ok: true, status: 'active', external_campaign_id: campaign.external_campaign_id });
  } catch (err: any) {
    await db.update('marketing_campaigns', req.params.id, { status: 'failed', updated_at: now() });
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});

// GET /api/ops/ads/metrics - Get ad metrics
advertisingRouter.get('/metrics', async (req: Request, res: Response) => {
  const { campaign_id, platform } = req.query;
  let rows = await db.list('ad_metrics', {}, 10000);
  if (campaign_id) rows = rows.filter((r) => r.campaign_id === campaign_id);
  if (platform) rows = rows.filter((r) => r.platform === platform);
  rows.sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  res.json({ ok: true, metrics: rows.slice(0, 500), total: rows.length });
});

// POST /api/ops/ads/metrics/sync - Sync metrics from platforms
advertisingRouter.post('/metrics/sync', async (_req: Request, res: Response) => {
  const campaigns = await db.list('marketing_campaigns', {}, 10000);
  let synced = 0;
  let skipped = 0;
  for (const campaign of campaigns) {
    const integration = campaign.integration_id ? (await db.list('social_integrations', { id: campaign.integration_id }, 1))[0] : null;
    if (!integration) { skipped++; continue; }
    try {
      if (campaign.platform === 'meta' && campaign.external_campaign_id) {
        const accessToken = decrypt(integration.access_token_enc);
        const resp = await fetch(`https://graph.facebook.com/v21.0/${campaign.external_campaign_id}/insights?fields=impressions,clicks,spend,cost_per_result,reach&access_token=${accessToken}`);
        const data = await resp.json();
        if (data.data?.[0]) {
          const m = data.data[0];
          await db.insert('ad_metrics', {
            id: randomUUID(),
            campaign_id: campaign.id,
            platform: campaign.platform,
            date: new Date().toISOString().split('T')[0],
            impressions: m.impressions || 0,
            clicks: m.clicks || 0,
            spend_inr: m.spend || 0,
            ctr: m.ctr || 0,
            cpc: m.cpc || 0,
            cpm: m.cpm || 0,
            conversions: m.actions?.filter((a: any) => a.action_type === 'purchase')?.reduce((sum: number, a: any) => sum + Number(a.value), 0) || 0,
            cost_per_conversion: m.cost_per_result || 0,
            created_at: now(),
          });
          synced++;
        }
      } else if (campaign.platform === 'google' && campaign.external_campaign_id) {
        if (!googleAdsConfigured()) { skipped++; continue; }
        const accessToken = decrypt(integration.access_token_enc);
        const customerId = campaign.integration_id;
        const date = new Date().toISOString().split('T')[0];
        const metrics = await googleAdsSyncCampaignMetrics(customerId, accessToken, campaign.external_campaign_id, date);
        if (metrics) {
          await db.insert('ad_metrics', {
            id: randomUUID(),
            campaign_id: campaign.id,
            platform: campaign.platform,
            date,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            spend_inr: metrics.costMicros / 1000000,
            ctr: 0,
            cpc: metrics.clicks > 0 ? metrics.costMicros / 1000000 / metrics.clicks : 0,
            cpm: metrics.impressions > 0 ? (metrics.costMicros / 1000000) / (metrics.impressions / 1000) : 0,
            conversions: metrics.conversions,
            cost_per_conversion: metrics.costPerConversion,
            created_at: now(),
          });
          synced++;
        }
      }
    } catch (err: any) {
      console.error(`Failed to sync metrics for campaign ${campaign.id}: ${err.message}`);
    }
  }
  res.json({ ok: true, synced, skipped });
});
