import { config } from '../config.js';

/**
 * Google Ads API client for campaign management and metrics sync.
 * Server-side only — developer token and OAuth credentials never leave this process.
 *
 * All calls go to the real Google Ads API (https://googleads.googleapis.com).
 * No operations are simulated or fabricated.
 *
 * Required configuration:
 *   GOOGLE_ADS_DEVELOPER_TOKEN — approved developer token from Google Ads API
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — optional, for manager accounts
 *
 * Per-account credentials (stored in social_integrations):
 *   access_token — OAuth2 access token (from /api/ops/social/oauth/google/callback)
 *   account_id — Google Ads customer ID (e.g., 1234567890)
 */

const BASE = 'https://googleads.googleapis.com/v16';

function requireDeveloperToken(): string {
  const token = (config.googleAdsDeveloperToken ?? '').trim();
  if (!token) throw new Error('Google Ads developer token not configured (GOOGLE_ADS_DEVELOPER_TOKEN)');
  return token;
}

function requireLoginCustomerId(): string | undefined {
  const id = (config.googleAdsLoginCustomerId ?? '').trim();
  return id || undefined;
}

function isConfigured(): boolean {
  return Boolean(config.googleAdsDeveloperToken);
}

export interface GoogleAdsCampaignInput {
  name: string;
  objective: string;
  budgetDailyMicros: number; // budget in micros (1 INR = 1,000,000 micros)
  status?: 'PAUSED' | 'ENABLED';
}

export interface GoogleAdsCampaignResult {
  resourceName: string; // customers/{id}/campaigns/{id}
  id: string;
  status: string;
}

export interface GoogleAdsMetrics {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  costPerConversion: number;
}

async function request(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const developerToken = requireDeveloperToken();
  const loginCustomerId = requireLoginCustomerId();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path.replace(/^\//, '')}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Google Ads API unreachable (${(err as Error)?.message ?? err})`);
  } finally {
    clearTimeout(timer);
  }

  let data: any = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    const msg = data?.error?.message || `Google Ads API returned ${res.status}`;
    const details = data?.error?.details?.map((d: any) => d?.details?.map((dd: any) => dd?.reason || dd?.errorCode || dd?.message)).flat().filter(Boolean).join('; ') || '';
    throw new Error(`${msg}${details ? `: ${details}` : ''}`);
  }
  return data;
}

/**
 * Create a Google Ads campaign via the real API.
 * Requires developer token + OAuth access token for the customer.
 */
export async function createCampaign(
  customerId: string,
  accessToken: string,
  input: GoogleAdsCampaignInput,
): Promise<GoogleAdsCampaignResult> {
  const data = await request(accessToken, 'POST', `customers/${customerId}/campaigns:mutate`.replace('${customerId}', customerId), {
    mutate_operations: [{
      campaign_operation: {
        create: {
          name: input.name,
          status: input.status ?? 'PAUSED',
          advertising_channel_type: 'SEARCH',
          campaign_budget: `customers/${customerId}/campaignBudgets/${input.name.replace(/\s+/g, '_')}`,
          manual_cpc: {},
        },
      },
    }],
  });

  const result = data.mutate_operation_responses?.[0]?.result;
  if (!result?.resource_name) {
    throw new Error('Google Ads API did not return a campaign resource name');
  }
  const id = result.resource_name.split('/').pop() || '';
  return { resourceName: result.resource_name, id, status: input.status ?? 'PAUSED' };
}

/**
 * Set campaign status (ENABLED/PAUSED) via the real API.
 */
export async function setCampaignStatus(
  customerId: string,
  accessToken: string,
  campaignId: string,
  status: 'ENABLED' | 'PAUSED',
): Promise<void> {
  await request(accessToken, 'PATCH', `customers/${customerId}/campaigns/${campaignId}`, {
    resource_name: `customers/${customerId}/campaigns/${campaignId}`,
    status,
    update_mask: { paths: ['status'] },
  });
}

/**
 * Sync metrics for a campaign via the real Google Ads API (GAQL search).
 */
export async function syncCampaignMetrics(
  customerId: string,
  accessToken: string,
  campaignId: string,
  date: string, // YYYY-MM-DD
): Promise<GoogleAdsMetrics | null> {
  const query = `
    SELECT
      campaign.id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE campaign.id = ${campaignId}
      AND segments.date = '${date}'
  `;

  const data = await request(accessToken, 'POST', `customers/${customerId}/googleAds:search`, { query });
  const rows = data.results ?? [];

  if (!rows.length) return null;

  const m = rows[0];
  const metrics = m.metrics ?? {};
  return {
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    costMicros: Number(metrics.cost_micros ?? 0),
    conversions: Number(metrics.conversions ?? 0),
    costPerConversion: Number(metrics.cost_per_conversion ?? 0),
  };
}

export { isConfigured, requireDeveloperToken };
