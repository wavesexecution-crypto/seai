import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID, randomBytes, scryptSync, createCipheriv } from 'node:crypto';
import { db } from '../db/db.js';
import { now } from '../growth/service.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;

function encryptionKey(): Buffer {
  const raw = process.env.SEAI_ENCRYPTION_KEY || '';
  if (!raw) throw new Error('SEAI_ENCRYPTION_KEY is not configured');
  return scryptSync(raw, 'seai-social-integration', KEY_LEN);
}

function encrypt(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') });
}

/** In-memory OAuth state nonce store (CSRF protection). Single-user app, short TTL. */
const oauthStateStore = new Map<string, { redirect_uri: string; created_at: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateState(redirect_uri: string): string {
  const state = randomBytes(32).toString('hex');
  oauthStateStore.set(state, { redirect_uri, created_at: Date.now() });
  return state;
}

function consumeState(state: string): { redirect_uri: string } | null {
  const entry = oauthStateStore.get(state);
  if (!entry) return null;
  if (Date.now() - entry.created_at > STATE_TTL_MS) {
    oauthStateStore.delete(state);
    return null;
  }
  oauthStateStore.delete(state);
  return entry;
}

// Cleanup expired states periodically
setInterval(() => {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [k, v] of oauthStateStore.entries()) {
    if (v.created_at < cutoff) oauthStateStore.delete(k);
  }
}, STATE_TTL_MS);

export const socialOAuthRouter = Router();

const META_SCOPE = 'instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,pages_read_engagement,pages_manage_posts,pages_manage_ads,pages_show_ads,ads_read,ads_management,business_management,pages_show_lead_forms,whatsapp_business_messaging';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly';

const metaOAuthSchema = z.object({
  code: z.string().trim().min(1),
  redirect_uri: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

const whatsappOAuthSchema = z.object({
  phone_number_id: z.string().trim().min(1),
  access_token: z.string().trim().min(1),
});

/** Required Meta permissions for publishing. */
const REQUIRED_META_PERMISSIONS = [
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];

socialOAuthRouter.get('/meta/url', async (_req: Request, res: Response) => {
  const clientId = process.env.META_APP_ID || '';
  const redirectUri = process.env.META_REDIRECT_URI || '';

  if (!clientId) {
    res.status(500).json({ ok: false, error: 'META_APP_ID not configured' });
    return;
  }
  if (!redirectUri) {
    res.status(500).json({ ok: false, error: 'META_REDIRECT_URI not configured' });
    return;
  }

  const state = generateState(redirectUri);
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(META_SCOPE)}&response_type=code&state=${encodeURIComponent(state)}`;
  res.json({ ok: true, auth_url: authUrl });
});

socialOAuthRouter.post('/meta/callback', async (req: Request, res: Response) => {
  const parsed = metaOAuthSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' }); return; }
  const { code, redirect_uri, state } = parsed.data;

  // CSRF: validate state nonce
  const stateEntry = consumeState(state);
  if (!stateEntry || stateEntry.redirect_uri !== redirect_uri) {
    res.status(400).json({ ok: false, error: 'Invalid or expired OAuth state' });
    return;
  }

  const clientId = process.env.META_APP_ID || '';
  const clientSecret = process.env.META_APP_SECRET || '';

  if (!clientId || !clientSecret) {
    res.status(500).json({ ok: false, error: 'Meta OAuth credentials not configured' });
    return;
  }

  try {
    // 1. Exchange short-lived code for short-lived access token
    const tokenResp = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect_uri)}&client_secret=${clientSecret}&code=${code}`);
    const tokenData = await tokenResp.json();

    if (!tokenResp.ok || !tokenData.access_token) {
      res.status(400).json({ ok: false, error: tokenData.error?.message || 'Failed to exchange code for token' });
      return;
    }

    let accessToken = tokenData.access_token;
    let expiresIn = Number(tokenData.expires_in || 3600);

    // 2. Exchange short-lived token for long-lived token (60 days)
    try {
      const longLivedResp = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${accessToken}`);
      const longLivedData = await longLivedResp.json();
      if (longLivedResp.ok && longLivedData.access_token) {
        accessToken = longLivedData.access_token;
        expiresIn = Number(longLivedData.expires_in || 5184000); // 60 days in seconds
      }
    } catch {
      // Long-lived exchange is best-effort; continue with short-lived token
    }

    // 3. Get user info
    const meResp = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${accessToken}`);
    const meData = await meResp.json();

    if (!meResp.ok) {
      res.status(400).json({ ok: false, error: 'Failed to get user info from Meta' });
      return;
    }

    // 4. Get pages with tokens
    const pagesResp = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_account&access_token=${accessToken}`);
    const pagesData = await pagesResp.json();

    const pages = pagesData.data || [];

    // 5. Validate required permissions are present on the token
    const debugResp = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${accessToken}&access_token=${clientId}|${clientSecret}`);
    const debugData = await debugResp.json();
    const grantedScopes: string[] = debugData.data?.scopes?.map((s: any) => s.scope) ?? [];
    const missingPermissions = REQUIRED_META_PERMISSIONS.filter((p) => !grantedScopes.includes(p));

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await db.insert('social_integrations', {
      id,
      platform: 'meta',
      account_id: meData.id,
      account_name: meData.name || meData.id,
      access_token_enc: encrypt(accessToken),
      refresh_token_enc: null,
      token_expires_at: expiresAt,
      scope: META_SCOPE,
      is_active: true,
      health_status: missingPermissions.length > 0 ? 'warning' : 'healthy',
      error_message: missingPermissions.length > 0 ? `Missing permissions: ${missingPermissions.join(', ')}` : null,
      last_synced_at: now(),
      workspace_type: 'seai',
      workspace_id: null,
      created_by: req.user!.id,
      created_at: now(),
      updated_at: now(),
    });

    const pageIntegrations: string[] = [];
    for (const page of pages) {
      const pageId = randomUUID();
      await db.insert('social_integrations', {
        id: pageId,
        platform: 'meta_page',
        account_id: page.id,
        account_name: page.name,
        access_token_enc: encrypt(page.access_token),
        refresh_token_enc: null,
        token_expires_at: expiresAt,
        scope: META_SCOPE,
        is_active: true,
        health_status: 'healthy',
        last_synced_at: now(),
        workspace_type: 'seai',
        workspace_id: null,
        created_by: req.user!.id,
        created_at: now(),
        updated_at: now(),
      });
      pageIntegrations.push(pageId);

      if (page.instagram_account) {
        await db.insert('social_integrations', {
          id: randomUUID(),
          platform: 'instagram',
          account_id: page.instagram_account.id,
          account_name: page.instagram_account.name || `Instagram (${page.instagram_account.id})`,
          access_token_enc: encrypt(page.access_token),
          refresh_token_enc: null,
          token_expires_at: expiresAt,
          scope: META_SCOPE,
          is_active: true,
          health_status: 'healthy',
          last_synced_at: now(),
          workspace_type: 'seai',
          workspace_id: null,
          created_by: req.user!.id,
          created_at: now(),
          updated_at: now(),
        });
      }
    }

    res.json({
      ok: true,
      id,
      account_id: meData.id,
      account_name: meData.name,
      pages: pages.length,
      page_integrations: pageIntegrations,
      missing_permissions: missingPermissions,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});

socialOAuthRouter.get('/google/url', async (_req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || '';

  if (!clientId) {
    res.status(500).json({ ok: false, error: 'GOOGLE_CLIENT_ID not configured' });
    return;
  }
  if (!redirectUri) {
    res.status(500).json({ ok: false, error: 'GOOGLE_REDIRECT_URI not configured' });
    return;
  }

  const state = generateState(redirectUri);
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(GOOGLE_SCOPE)}&response_type=code&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
  res.json({ ok: true, auth_url: authUrl });
});

socialOAuthRouter.post('/google/callback', async (req: Request, res: Response) => {
  const parsed = metaOAuthSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' }); return; }
  const { code, redirect_uri, state } = parsed.data;

  // CSRF: validate state nonce
  const stateEntry = consumeState(state);
  if (!stateEntry || stateEntry.redirect_uri !== redirect_uri) {
    res.status(400).json({ ok: false, error: 'Invalid or expired OAuth state' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    res.status(500).json({ ok: false, error: 'Google OAuth credentials not configured' });
    return;
  }

  try {
    const tokenResp = await fetch(`https://oauth2.googleapis.com/token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect_uri)}&client_secret=${clientSecret}&code=${code}&grant_type=authorization_code`);
    const tokenData = await tokenResp.json();

    if (!tokenResp.ok || !tokenData.access_token) {
      res.status(400).json({ ok: false, error: tokenData.error?.description || 'Failed to exchange code for token' });
      return;
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in || 3600;

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

    await db.insert('social_integrations', {
      id,
      platform: 'google',
      account_id: 'google_user',
      account_name: 'Google Ads Account',
      access_token_enc: encrypt(accessToken),
      refresh_token_enc: refreshToken ? encrypt(refreshToken) : null,
      token_expires_at: expiresAt,
      scope: GOOGLE_SCOPE,
      is_active: true,
      health_status: 'healthy',
      last_synced_at: now(),
      workspace_type: 'seai',
      workspace_id: null,
      created_by: req.user!.id,
      created_at: now(),
      updated_at: now(),
    });

    res.json({ ok: true, id, account_id: 'google_user', account_name: 'Google Ads Account' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});

socialOAuthRouter.post('/whatsapp/connect', async (req: Request, res: Response) => {
  const parsed = whatsappOAuthSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' }); return; }
  const { phone_number_id, access_token } = parsed.data;

  try {
    const resp = await fetch(`https://graph.facebook.com/v21.0/${phone_number_id}?fields=id,name&access_token=${access_token}`);
    const data = await resp.json();

    if (!resp.ok) {
      res.status(400).json({ ok: false, error: data.error?.message || 'Failed to verify WhatsApp account' });
      return;
    }

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.insert('social_integrations', {
      id,
      platform: 'whatsapp',
      account_id: phone_number_id,
      account_name: data.name || phone_number_id,
      access_token_enc: encrypt(access_token),
      refresh_token_enc: null,
      token_expires_at: expiresAt,
      scope: META_SCOPE,
      is_active: true,
      health_status: 'healthy',
      last_synced_at: now(),
      workspace_type: 'seai',
      workspace_id: null,
      created_by: req.user!.id,
      created_at: now(),
      updated_at: now(),
    });

    res.json({ ok: true, id, account_id: phone_number_id, account_name: data.name });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err).slice(0, 300) });
  }
});

export default socialOAuthRouter;
