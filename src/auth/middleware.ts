import { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { validateSession } from './service.js';
import { getSessionToken } from './routes.js';
import { config } from '../config.js';
import type { User } from './service.js';
import { isStaffRole, normalizeRole } from './roles.js';

// Extend Express Request to include user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Middleware: require a valid session, else 401
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getSessionToken(req);
  const user = await validateSession(token);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

// Middleware: populate req.user if authenticated, but don't block
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = getSessionToken(req);
  const user = await validateSession(token);
  if (user) {
    req.user = user;
  }
  next();
}

// For SPA page routes: if not authenticated, redirect to /sign-in
export async function requireAuthRedirect(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getSessionToken(req);
  const user = await validateSession(token);
  if (!user) {
    res.redirect('/sign-in');
    return;
  }
  req.user = user;
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** True when the caller presented the SEAI staff/service key. */
      isStaff?: boolean;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Gate for authoritative, non-customer actions: completing a change request,
 * recording a deployment, marking a website live.
 *
 * These are the transitions a customer must never be able to assert about
 * their own work, so they accept a service key (`Authorization: Bearer
 * SEAI_STAFF_API_KEY`) rather than a customer session. A valid customer
 * session is NOT sufficient here — that is the whole point.
 *
 * Fails closed: if `SEAI_STAFF_API_KEY` is unset the route is disabled (503),
 * so a missing secret can never widen access.
 */
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  const expected = (config.staffApiKey ?? '').trim();
  if (!expected) {
    res.status(503).json({ ok: false, error: 'Staff operations are not configured' });
    return;
  }
  const header = String(req.header('authorization') ?? '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !safeEqual(token, expected)) {
    res.status(403).json({ ok: false, error: 'Staff authorisation required' });
    return;
  }
  req.isStaff = true;
  next();
}

/**
 * Staff dashboard gate: a valid session whose user carries a staff role
 * (admin|sales|account_manager|marketing|designer|developer|finance).
 * Customer sessions get 403 — staff capability is a property of the account,
 * never of a cookie alone. `roles` narrows further when a route is
 * role-specific.
 */
export function requireStaffRole(...roles: string[]) {
  const allowed = roles.map((r) => r.toLowerCase());
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = getSessionToken(req);
    const user = await validateSession(token);
    const role = normalizeRole(user?.role);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }
    if (!isStaffRole(role)) {
      res.status(403).json({ ok: false, error: 'Staff access required' });
      return;
    }
    if (allowed.length && !allowed.includes(role) && role !== 'admin') {
      res.status(403).json({ ok: false, error: 'Insufficient role for this resource' });
      return;
    }
    req.user = user;
    next();
  };
}

/** Express-ready instance for the common case (any staff role). */
export const staffOnly = requireStaffRole();

/** Page guard for /staff: unauthenticated → /sign-in, customers → /overview. */
export async function requireStaffRedirect(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getSessionToken(req);
  const user = await validateSession(token);
  const role = normalizeRole(user?.role);
  if (!user) { res.redirect('/sign-in'); return; }
  if (!isStaffRole(role)) { res.redirect('/overview'); return; }
  req.user = user;
  next();
}

/**
 * Guard for the scheduled-maintenance route: accepts the staff service key or
 * Vercel's `CRON_SECRET` bearer. Used for jobs that must be triggerable by
 * Vercel Cron, which cannot compute our HMAC event signature.
 */
export function requireStaffOrCron(req: Request, res: Response, next: NextFunction): void {
  const header = String(req.header('authorization') ?? '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(403).json({ ok: false, error: 'Staff authorisation required' });
    return;
  }
  const staff = (config.staffApiKey ?? '').trim();
  const cron = (config.cronSecret ?? '').trim();
  if ((staff && safeEqual(token, staff)) || (cron && safeEqual(token, cron))) {
    req.isStaff = true;
    next();
    return;
  }
  res.status(403).json({ ok: false, error: 'Staff authorisation required' });
}
