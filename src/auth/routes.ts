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
import { createHash } from 'node:crypto';
import { isMailConfigured } from '../mail/transport.js';
import { trackPendingMail } from '../mail/pending.js';
import { dispatchEmail } from '../mail/dispatch.js';
import { passwordResetUrl } from '../mail/urls.js';
import { notifyWelcome } from '../mail/notify.js';

// The raw reset token is never stored or logged. The dedupe key is a one-way
// hash so a replayed reset request cannot double-send, while two genuinely
// different reset tokens still send two emails.
function resetDedupeHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export const authRouter = Router();

const SESSION_COOKIE = 'seai_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
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
    notifyWelcome(user.email, user.full_name, user.id);
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
  // Generic response in every branch: never reveal whether the account exists.
  // The reset token is only ever delivered inside the email to the owner.
  if (!user) {
    res.json({ ok: true, message: 'If an account exists for this email, a password reset link has been sent.' });
    return;
  }
  if (!isMailConfigured()) {
    console.error('[auth] password reset requested but email service is not configured');
    res.status(503).json({ ok: false, error: 'Password reset is temporarily unavailable. Please try again later or contact support.' });
    return;
  }
  const token = await createPasswordReset(user.id);
  const resetUrl = passwordResetUrl(token);
  const result = await dispatchEmail({
    eventName: 'account.password_reset',
    template: 'account.password_reset',
    to: user.email,
    customerId: user.id,
    dedupeParts: [user.id, resetDedupeHash(token)],
    variables: { reset_url: resetUrl, email: user.email, expires_in_hours: '1' },
  });
  if (result.status === 'failed') {
    res.status(502).json({ ok: false, error: 'Could not send the reset email. Please try again later.' });
    return;
  }
  res.json({ ok: true, message: 'If an account exists for this email, a password reset link has been sent.' });
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
  // Security notice. Fire-and-forget: a mail failure must never block or roll
  // back a password the customer already changed. Tracked (not dropped) so the
  // serverless runtime drains it before freezing.
  trackPendingMail(() =>
    dispatchEmail({
      eventName: 'account.password_changed',
      template: 'account.password_changed',
      to: user.email,
      customerId: user.id,
      dedupeParts: [user.id, resetDedupeHash(token)],
      variables: { changed_at: new Date().toISOString(), email: user.email },
    }),
  );
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
