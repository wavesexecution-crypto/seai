import { randomUUID, scryptSync, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { db } from '../db/db.js';

// Password hashing using scrypt (built into Node.js crypto — no external deps)
// Format: scrypt$<salt_hex>$<hash_hex>
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCKSIZE = 8;
const SCRYPT_PARALLELISM = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCKSIZE,
    p: SCRYPT_PARALLELISM,
  });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, salt, expected.length, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCKSIZE,
    p: SCRYPT_PARALLELISM,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface User {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export async function createUser(fullName: string, email: string, password: string): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.list('users', { email: normalizedEmail }, 1);
  if (existing.length > 0) {
    throw new Error('An account with this email already exists');
  }
  const user = await db.insert('users', {
    id: randomUUID(),
    full_name: fullName.trim(),
    email: normalizedEmail,
    password_hash: hashPassword(password),
    email_verified: false,
  });
  return user as User;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db.list('users', { email: normalizedEmail }, 1);
  return rows.length > 0 ? (rows[0] as User) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const rows = await db.list('users', { id }, 1);
  return rows.length > 0 ? (rows[0] as User) : null;
}

export async function validateCredentials(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.insert('sessions', {
    id: randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  return token;
}

export async function validateSession(token: string): Promise<User | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const sessions = await db.list('sessions', { token_hash: tokenHash }, 1);
  if (sessions.length === 0) return null;
  const session = sessions[0] as Session;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.update('sessions', session.id, { expires_at: new Date(0).toISOString() }).catch(() => undefined);
    return null;
  }
  return findUserById(session.user_id);
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);
  const sessions = await db.list('sessions', { token_hash: tokenHash }, 1);
  if (sessions.length > 0) {
    await db.update('sessions', sessions[0].id, { expires_at: new Date(0).toISOString() });
  }
}

export async function createPasswordReset(userId: string): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
  await db.insert('password_resets', {
    id: randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  return token;
}

export async function validatePasswordReset(token: string): Promise<User | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db.list('password_resets', { token_hash: tokenHash }, 1);
  if (rows.length === 0) return null;
  const reset = rows[0];
  if (reset.used_at) return null;
  if (new Date(reset.expires_at).getTime() < Date.now()) return null;
  return findUserById(reset.user_id);
}

export async function markPasswordResetUsed(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const rows = await db.list('password_resets', { token_hash: tokenHash }, 1);
  if (rows.length > 0) {
    await db.update('password_resets', rows[0].id, { used_at: new Date().toISOString() });
  }
}

export async function setPassword(userId: string, newPassword: string): Promise<void> {
  await db.update('users', userId, {
    password_hash: hashPassword(newPassword),
    updated_at: new Date().toISOString(),
  });
}

export async function createEmailVerification(userId: string): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  await db.insert('email_verifications', {
    id: randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  return token;
}

export async function verifyEmail(token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const rows = await db.list('email_verifications', { token_hash: tokenHash }, 1);
  if (rows.length === 0) return false;
  const verification = rows[0];
  if (verification.used_at) return false;
  if (new Date(verification.expires_at).getTime() < Date.now()) return false;
  await db.update('email_verifications', verification.id, { used_at: new Date().toISOString() });
  await db.update('users', verification.user_id, {
    email_verified: true,
    updated_at: new Date().toISOString(),
  });
  return true;
}

export async function markEmailVerified(userId: string): Promise<void> {
  await db.update('users', userId, {
    email_verified: true,
    updated_at: new Date().toISOString(),
  });
}
