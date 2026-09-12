/**
 * One-time SEAI tickets.
 *
 * A ticket is a self-contained, HMAC-SHA256-signed payload:
 *
 *     base64url(jsonPayload) "." base64url(hmac)
 *
 * The gateway mints it after embedded session-token validation and passes it
 * to the SEAI platform frontend (as a short-lived URL query param). SEAI
 * verifies it with the shared signing secret. It proves "this shop is linked
 * to this SEAI account" and carries NO Shopify credentials — it cannot be
 * exchanged for a Shopify access token.
 *
 * Replay protection: the ticket nonce is recorded in the shared nonce store
 * at verification time; a second verification of the same nonce is rejected.
 * Tickets are short-lived (SEAI_TICKET_TTL_SECONDS, default 300s).
 */

import type { AppConfig } from '../config.js';
import { randomToken, type CryptoBox } from './crypto.js';
import type { DataStore } from './data-store.js';

export interface TicketPayload {
  readonly version: 1;
  readonly shopDomain: string;
  readonly seaiAccountId: string;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

export type TicketErrorKind =
  | 'invalid_signature'
  | 'malformed'
  | 'expired'
  | 'replay'
  | 'not_yet_valid'
  | 'not_configured';

export class TicketError extends Error {
  override readonly name = 'TicketError';
  readonly kind: TicketErrorKind;
  constructor(kind: TicketErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface TicketService {
  /** Mint a short-lived one-time ticket for a linked store. */
  issue(shopDomain: string, seaiAccountId: string, ttlSeconds: number): Promise<string>;
  /** Verify + consume a ticket (throws TicketError on any failure). */
  verify(token: string): Promise<TicketPayload>;
}

export function createTicketService(
  config: AppConfig,
  box: CryptoBox,
  store: DataStore,
): TicketService {
  const signingKey = config.gatewayTokenSigningKey;

  async function issue(
    shopDomain: string,
    seaiAccountId: string,
    ttlSeconds: number,
  ): Promise<string> {
    if (!signingKey) {
      throw new TicketError('not_configured', 'Ticket signing key is not configured.');
    }
    const now = Math.trunc(Date.now() / 1000);
    const payload: TicketPayload = {
      version: 1,
      shopDomain,
      seaiAccountId,
      nonce: randomToken(24),
      iat: now,
      exp: now + ttlSeconds,
    };
    const encoded = encodeBase64(JSON.stringify(payload));
    const rawSig = box.signHmac(signingKey, encoded);
    const signature = Buffer.from(rawSig, 'base64').toString('base64url').replaceAll('=', '');
    return `${encoded}.${signature}`;
  }

  async function verify(token: string): Promise<TicketPayload> {
    if (!signingKey) {
      throw new TicketError('not_configured', 'Ticket signing key is not configured.');
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new TicketError('malformed', 'Ticket is not in the expected format.');
    }
    const [encoded, signature] = parts as [string, string];
    // Accept both base64 and base64url signatures for backwards compat
    const sigBase64 = signature.includes('-') || signature.includes('_') || !signature.includes('=') ? Buffer.from(signature, 'base64url').toString('base64') : signature;
    if (!box.verifyHmac(signingKey, encoded, sigBase64)) {
      throw new TicketError('invalid_signature', 'Ticket signature verification failed.');
    }

    let payload: TicketPayload;
    try {
      payload = JSON.parse(decodeBase64(encoded)) as TicketPayload;
      if (payload === null || typeof payload !== 'object') {
        throw new Error('not an object');
      }
    } catch {
      throw new TicketError('malformed', 'Ticket payload is not valid JSON.');
    }

    const now = Math.trunc(Date.now() / 1000);
    if (payload.version !== 1) {
      throw new TicketError('malformed', 'Unsupported ticket version.');
    }
    if (typeof payload.shopDomain !== 'string' || typeof payload.seaiAccountId !== 'string') {
      throw new TicketError('malformed', 'Ticket payload is missing required fields.');
    }
    if (typeof payload.nonce !== 'string' || payload.nonce.length === 0) {
      throw new TicketError('malformed', 'Ticket payload is missing a nonce.');
    }
    if (now > payload.exp) {
      throw new TicketError('expired', 'Ticket has expired.');
    }
    if (now < payload.iat) {
      throw new TicketError('not_yet_valid', 'Ticket is not yet valid.');
    }

    // Replay protection: the nonce must not have been claimed before.
    const expires = new Date(payload.exp * 1000);
    const claimed = await store.setNonceIfAbsent(`ticket:${payload.nonce}`, expires);
    if (!claimed) {
      throw new TicketError('replay', 'Ticket has already been used.');
    }
    return payload;
  }

  return { issue, verify };
}

function encodeBase64(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64url');
}
function decodeBase64(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf-8');
}

/**
 * Independent helper kept for parity with the SEAI-side verifier (shared
 * secret): allowed to avoid duplicating nonce logic on that side.
 */
export function signTicketHMAC(box: CryptoBox, key: string, payload: object): string {
  const encoded = encodeBase64(JSON.stringify(payload));
  const raw = box.signHmac(key, encoded);
  const sig = Buffer.from(raw, 'base64').toString('base64url').replaceAll('=', '');
  return `${encoded}.${sig}`;
}