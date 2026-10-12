import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { createSession, findUserById, type User } from '../auth/service.js';
import { normalizeShop } from '../stores/connections.js';
import { listConnectedShops } from '../shopify/sessions.js';
import { verifyAndConsumeTicket, EmbedTicketError } from '../shopify/embed-ticket.js';

const router = Router();

// Public Shopify configuration needed by the frontend for App Bridge init.
// Only public, non-sensitive fields are returned: the API key (used in OAuth
// redirects and App Bridge — it is NOT a secret), API version, and app URL.
// The client secret and Admin API tokens are NEVER exposed here.
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    apiKey: config.shopify.apiKey,
    apiVersion: config.shopify.apiVersion,
    appUrl: config.shopify.appUrl,
  });
});

// Cross-site iframe cookie: SameSite=None is required for the embedded flow.
// This is a SEPARATE cookie from the normal seai_session so the stricter
// sameSite:'strict' policy is preserved for direct (non-embedded) access.
const EMBED_SESSION_COOKIE = 'seai_session_embedded';
const EMBED_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours, the merchant's working session

function setEmbedSessionCookie(res: Response, token: string): void {
  res.cookie(EMBED_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: EMBED_COOKIE_MAX_AGE,
    path: '/',
  });
}

/**
 * GET /embed/activity?shop=<shop>&ticket=<gateway-ticket>
 *
 * Gateway entry point. The gateway has already validated the Shopify session-token
 * and minted a short-lived one-time HMAC ticket. We verify it, create a session
 * for the mapped SEAI account, set an embedded-compatible cookie, then redirect
 * to /activity (ticket is consumed — it must not remain in the URL).
 */
router.get('/activity', async (req: Request, res: Response) => {
  const query = z.object({
    shop: z.string().min(1),
    ticket: z.string().min(1),
  }).safeParse(req.query);

  if (!query.success) {
    res.status(400).json({ error: 'Missing shop or ticket.' });
    return;
  }

  const shop = normalizeShop(query.data.shop);
  if (!shop) {
    res.status(400).json({ error: 'Invalid shop domain.' });
    return;
  }

  let accountId: string;
  try {
    const payload = await verifyAndConsumeTicket(query.data.ticket);
    if (payload.shopDomain !== shop) {
      res.status(400).json({ error: 'Ticket shop mismatch.' });
      return;
    }
    accountId = payload.seaiAccountId;
  } catch (err) {
    if (err instanceof EmbedTicketError) {
      // Do not leak secret details; map to safe HTTP responses.
      const status = err.kind === 'expired' ? 410 : err.kind === 'replay' ? 409 : 401;
      res.status(status).json({ error: 'Authentication failed.', code: err.kind });
      return;
    }
    res.status(500).json({ error: 'Authentication service unavailable.' });
    return;
  }

  // Defense in depth: the gateway ticket (HMAC-verified, one-time) proves the
  // shop is linked to `seaiAccountId` via the gateway's shop-bound OAuth state
  // and ticket HMAC. SEAI's *separate* `shopify_sessions` (its own OAuth) is
  // NOT required for the delegated gateway flow — the gateway owns the
  // Shopify token and proxies GraphQL. Require the ticket + user; a missing
  // local `shopify_sessions` row is expected when the gateway delegated.
  // Keep a soft check: if SEAI does have local sessions, verify consistency
  // but never block a valid ticket solely on local disconnected state.
  try {
    const connected = await listConnectedShops();
    if (connected.length > 0 && !connected.includes(shop)) {
      // Shop is connected elsewhere but not this one — log for ops but do not
      // hard-fail a valid gateway ticket (gateway is source of truth for token).
      console.warn(`[embed] shop ${shop} has no local shopify_sessions row but ticket is valid — allowing delegated auth`);
    }
  } catch {
    // Non-fatal: ticket verification already succeeded
  }

  // Resolve the SEAI user bound to this account.
  const user: User | null = await findUserById(accountId);
  if (!user) {
    res.status(403).json({ error: 'No SEAI account is linked to this store.' });
    return;
  }

  const sessionToken = await createSession(user.id);
  setEmbedSessionCookie(res, sessionToken);

  // Redirect to /activity — ticket is consumed, it must not persist in the URL.
  res.redirect(`/activity?shop=${encodeURIComponent(shop)}`);
});

export const embedRouter = router;
