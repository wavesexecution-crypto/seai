/**
 * Short-lived gateway tokens (HS256 JWTs) used by the SEAI BACKEND to call the
 * GraphQL proxy (`POST /v1/graphql/:shop`).
 *
 * Flow:
 *   1. During store linking the gateway generates a long-lived per-store
 *      machine token and hands it to SEAI once. Only its SHA-256 is stored.
 *   2. SEAI calls `POST /v1/exchange` with that machine token + shop.
 *      The gateway verifies the hash, then mints a SHORT-LIVED gateway token
 *      (HS256, GATEWAY_TOKEN_SIGNING_KEY, default 300s TTL).
 *   3. SEAI calls the proxy with `Authorization: Bearer <short-lived-token>`.
 *
 * Short TTL + per-request verification keeps the window for token theft
 * minimal, and revoking the store link instantly invalidates the machine
 * credential.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.js';

export interface GatewayTokenClaims {
  readonly shopDomain: string;
  readonly seaiAccountId: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

export type GatewayTokenErrorKind =
  | 'invalid_signature'
  | 'malformed'
  | 'expired'
  | 'not_yet_valid'
  | 'not_configured';

export class GatewayTokenError extends Error {
  override readonly name = 'GatewayTokenError';
  readonly kind: GatewayTokenErrorKind;
  constructor(kind: GatewayTokenErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface GatewayTokenService {
  issue(shopDomain: string, seaiAccountId: string, ttlSeconds: number): Promise<string>;
  verify(token: string): Promise<GatewayTokenClaims>;
}

export function createGatewayTokenService(config: AppConfig): GatewayTokenService {
  const signingKey = config.gatewayTokenSigningKey;

  async function issue(
    shopDomain: string,
    seaiAccountId: string,
    ttlSeconds: number,
  ): Promise<string> {
    if (!signingKey) {
      throw new GatewayTokenError('not_configured', 'Gateway token signing key is not configured.');
    }
    const now = Math.trunc(Date.now() / 1000);
    const claims: GatewayTokenClaims = {
      shopDomain,
      seaiAccountId,
      iat: now,
      exp: now + ttlSeconds,
      jti: randomToken(24),
    };
    return signJwt(claims, signingKey);
  }

  async function verify(token: string): Promise<GatewayTokenClaims> {
    if (!signingKey) {
      throw new GatewayTokenError('not_configured', 'Gateway token signing key is not configured.');
    }
    const payload = verifyJwt(token, signingKey);
    const now = Math.trunc(Date.now() / 1000);
    const { exp, iat } = payload;
    if (typeof exp !== 'number' || typeof iat !== 'number') {
      throw new GatewayTokenError('malformed', 'Gateway token is missing temporal claims.');
    }
    if (now > exp) {
      throw new GatewayTokenError('expired', 'Gateway token has expired.');
    }
    if (now < iat) {
      throw new GatewayTokenError('not_yet_valid', 'Gateway token is not yet valid.');
    }
    const { shopDomain, seaiAccountId, jti } = payload;
    if (
      typeof shopDomain !== 'string' ||
      typeof seaiAccountId !== 'string' ||
      typeof jti !== 'string'
    ) {
      throw new GatewayTokenError('malformed', 'Gateway token is missing required claims.');
    }
    return { shopDomain, seaiAccountId, iat, exp, jti };
  }

  return { issue, verify };
}

/** Minimal HS256 JWT implementation (no external dependency). */
const b64url = (value: Buffer) => value.toString('base64url').replaceAll('=', '');

function signJwt(claims: object, key: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf-8'));
  const body = b64url(Buffer.from(JSON.stringify(claims), 'utf-8'));
  const signingInput = `${header}.${body}`;
  const signature = b64url(createHmac('sha256', key).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

function verifyJwt(token: string, key: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new GatewayTokenError('malformed', 'Token is not in the expected JWT format.');
  }
  const [header, body, signature] = parts as [string, string, string];
  const signingInput = `${header}.${body}`;
  const expected = b64url(createHmac('sha256', key).update(signingInput).digest());
  const expectedBuf = Buffer.from(expected, 'base64url');
  const actualBuf = Buffer.from(signature, 'base64url');
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw new GatewayTokenError('invalid_signature', 'Token signature verification failed.');
  }
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (decoded === null || typeof decoded !== 'object') {
      throw new Error('not an object');
    }
    return decoded as Record<string, unknown>;
  } catch {
    throw new GatewayTokenError('malformed', 'Token body is not valid JSON.');
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url').replaceAll('=', '');
}