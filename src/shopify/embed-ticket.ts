import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/db.js';

// Mirror of the gateway ticket payload (D:\seaiapp\gateway\src\services\ticket.ts).
// The gateway mints: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, key)).
export interface GatewayTicketPayload {
  readonly version: 1;
  readonly shopDomain: string;
  readonly seaiAccountId: string;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

export type EmbedTicketErrorKind =
  | 'not_configured'
  | 'malformed'
  | 'invalid_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'replay';

export class EmbedTicketError extends Error {
  override readonly name = 'EmbedTicketError';
  readonly kind: EmbedTicketErrorKind;
  constructor(kind: EmbedTicketErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const b64url = (value: Buffer) => value.toString('base64url').replaceAll('=', '');
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a one-time gateway ticket. Pure function — no DB side effects — so it is
 * trivially testable. Throws EmbedTicketError on any failure.
 */
export function verifyGatewayTicket(token: string): GatewayTicketPayload {
  if (!config.gatewaySecret) {
    throw new EmbedTicketError('not_configured', 'Gateway ticket verification is not configured.');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new EmbedTicketError('malformed', 'Ticket is not in the expected format.');
  }
  const [encoded, signature] = parts as [string, string];
  if (!B64URL_RE.test(encoded) || !B64URL_RE.test(signature)) {
    throw new EmbedTicketError('malformed', 'Ticket encoding is invalid.');
  }

  const expectedSig = b64url(createHmac('sha256', config.gatewaySecret).update(encoded).digest());
  if (!constantTimeEqual(expectedSig, signature)) {
    throw new EmbedTicketError('invalid_signature', 'Ticket signature verification failed.');
  }

  let payload: GatewayTicketPayload;
  try {
    const json = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as Record<string, unknown>;
    if (json === null || typeof json !== 'object') throw new Error('not an object');
    if (json.version !== 1) throw new Error('unsupported version');
    if (typeof json.shopDomain !== 'string' || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(json.shopDomain)) {
      throw new Error('invalid shopDomain');
    }
    if (typeof json.seaiAccountId !== 'string' || json.seaiAccountId.length === 0) {
      throw new Error('invalid seaiAccountId');
    }
    if (typeof json.nonce !== 'string' || json.nonce.length === 0) throw new Error('invalid nonce');
    if (typeof json.iat !== 'number' || typeof json.exp !== 'number') throw new Error('invalid timestamps');
    payload = {
      version: 1,
      shopDomain: json.shopDomain,
      seaiAccountId: json.seaiAccountId,
      nonce: json.nonce,
      iat: json.iat,
      exp: json.exp,
    };
  } catch {
    throw new EmbedTicketError('malformed', 'Ticket payload is invalid.');
  }

  const now = Math.trunc(Date.now() / 1000);
  if (now >= payload.exp) {
    throw new EmbedTicketError('expired', 'Ticket has expired.');
  }
  if (now < payload.iat) {
    throw new EmbedTicketError('not_yet_valid', 'Ticket is not yet valid.');
  }
  return payload;
}

/**
 * Replay guard: record a nonce and reject duplicates. Returns true if the nonce
 * was newly recorded, false if it was already consumed (replay).
 */
export async function claimNonce(nonce: string, expiresAt: Date): Promise<boolean> {
  try {
    const existing = await db.list('nonces', { key: `ticket:${nonce}` } as Record<string, unknown>, 1);
    if (existing.length > 0) return false;
    await db.insert('nonces', {
      id: randomBytes(12).toString('hex'),
      key: `ticket:${nonce}`,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
    } as Record<string, unknown>);
    return true;
  } catch {
    // If the nonce store is unavailable, fail closed (treat as replay) rather
    // than allowing unauthenticated access.
    return false;
  }
}

/** Verify + consume in one step. Throws EmbedTicketError on any failure. */
export async function verifyAndConsumeTicket(token: string): Promise<GatewayTicketPayload> {
  const payload = verifyGatewayTicket(token);
  const claimed = await claimNonce(payload.nonce, new Date(payload.exp * 1000));
  if (!claimed) {
    throw new EmbedTicketError('replay', 'Ticket has already been used.');
  }
  return payload;
}
