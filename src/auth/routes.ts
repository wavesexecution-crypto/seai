import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createUser,
  validateCredentials,
  createSession,
  validateSession,
  destroySession,
  createPasswordReset,
  validatePasswordReset,
  markPasswordResetUsed,
  setPassword,
  createEmailVerification,
  verifyEmail,
  findUserByEmail,
  type User,
} from './service.js';

export const authRouter = Router();

const SESSION_COOKIE = 'seai_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

const EMBED_SESSION_COOKIE = 'seai_session_embedded';

export function getSessionToken(req: Request): string {
  // Check the normal session first, then the embedded (cross-site iframe) session.
  // Both cookies resolve to the same sessions table via validateSession.
  return req.cookies?.[SESSION_COOKIE] || req.cookies?.[EMBED_SESSION_COOKIE] || '';
}

const signInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const signUpSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

function publicUser(user: User) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    emailVerified: user.email_verified,
  };
}

// POST /api/auth/sign-in
authRouter.post('/sign-in', async (req: Request, res: Response) => {
  const parsed = signInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const { email, password } = parsed.data;
  const user = await validateCredentials(email, password);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Invalid email or password' });
    return;
  }
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ ok: true, user: publicUser(user) });
});

// POST /api/auth/sign-up
authRouter.post('/sign-up', async (req: Request, res: Response) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const { fullName, email, password } = parsed.data;
  try {
    const user = await createUser(fullName, email, password);
    await createEmailVerification(user.id);
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ ok: true, user: publicUser(user) });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/auth/forgot-password
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email('Enter a valid email address') }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const { email } = parsed.data;
  const user = await findUserByEmail(email);
  if (user) {
    await createPasswordReset(user.id);
  }
  res.json({ ok: true, message: 'If an account exists, a reset link has been sent' });
});

// POST /api/auth/reset-password
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = z.object({
    token: z.string().min(1),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  }).refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const { token, password } = parsed.data;
  const user = await validatePasswordReset(token);
  if (!user) {
    res.status(400).json({ ok: false, error: 'Invalid or expired reset token' });
    return;
  }
  await setPassword(user.id, password);
  await markPasswordResetUsed(token);
  res.json({ ok: true, message: 'Password updated' });
});

// POST /api/auth/verify-email
authRouter.post('/verify-email', async (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ ok: false, error: 'Verification token required' });
    return;
  }
  const ok = await verifyEmail(token);
  if (!ok) {
    res.status(400).json({ ok: false, error: 'Invalid or expired verification token' });
    return;
  }
  res.json({ ok: true, message: 'Email verified' });
});

// POST /api/auth/resend-verification
authRouter.post('/resend-verification', async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email('Enter a valid email address') }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0].message });
    return;
  }
  const { email } = parsed.data;
  const user = await findUserByEmail(email);
  if (user && !user.email_verified) {
    await createEmailVerification(user.id);
  }
  res.json({ ok: true, message: 'If an account exists, a verification email has been sent' });
});

// POST /api/auth/sign-out
authRouter.post('/sign-out', async (req: Request, res: Response) => {
  const token = getSessionToken(req);
  await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — get current user
authRouter.get('/me', async (req: Request, res: Response) => {
  const token = getSessionToken(req);
  const user = await validateSession(token);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Not authenticated' });
    return;
  }
  res.json({ ok: true, user: publicUser(user) });
});

// GET /api/auth/validate-reset-token — check if reset token is valid
authRouter.get('/validate-reset-token', async (req: Request, res: Response) => {
  const token = String(req.query.token ?? '');
  if (!token) {
    res.status(400).json({ ok: false, error: 'Token required' });
    return;
  }
  const user = await validatePasswordReset(token);
  if (!user) {
    res.status(400).json({ ok: false, error: 'Invalid or expired token' });
    return;
  }
  res.json({ ok: true });
});
