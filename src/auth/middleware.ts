import { type Request, type Response, type NextFunction } from 'express';
import { validateSession } from './service.js';
import { getSessionToken } from './routes.js';
import type { User } from './service.js';

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
