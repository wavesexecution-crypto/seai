import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';

process.env.SEAI_GATEWAY_SECRET = 'test-gateway-secret-32-bytes-long!!';
process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.SHOPIFY_APP_URL = 'http://localhost:3000';
process.env.SEAI_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
process.env.SEAI_BRAIN_DIR = mkdtempSync(join(tmpdir(), 'seai-embed-test-'));
process.env.SEAI_SCHEDULER = 'off';

const b64url = (value: Buffer) => value.toString('base64url').replaceAll('=', '');

function mintTicket(overrides: Record<string, unknown> = {}): string {
  const now = Math.trunc(Date.now() / 1000);
  const payload = { version: 1, shopDomain: 'demo-store.myshopify.com', seaiAccountId: 'user-123', nonce: randomBytes(16).toString('hex'), iat: now, exp: now + 300, ...overrides };
  const encoded = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig = b64url(createHmac('sha256', process.env.SEAI_GATEWAY_SECRET!).update(encoded).digest());
  return `${encoded}.${sig}`;
}

beforeAll(async () => {
  const { db } = await import('../src/db/db.js');
  await db.init();
  await db.migrate();
  const { createUser } = await import('../src/auth/service.js');
  try { await createUser('Demo Operator', 'demo@example.com', 'Test-Password-123'); } catch { /* exists */ }
  await db.insert('shopify_sessions', { id: 'seed', shop: 'demo-store.myshopify.com', access_token_enc: 'tok', scope: 'read_products', is_online: false, updated_at: new Date().toISOString() } as Record<string, unknown>);
});

describe('Phase 6 — ticket verification', () => {
  it('accepts a valid ticket', async () => {
    const { verifyGatewayTicket } = await import('../src/shopify/embed-ticket.js');
    const p = verifyGatewayTicket(mintTicket());
    expect(p.shopDomain).toBe('demo-store.myshopify.com');
    expect(p.seaiAccountId).toBe('user-123');
  });

  it('rejects invalid signature', async () => {
    const { verifyGatewayTicket, EmbedTicketError } = await import('../src/shopify/embed-ticket.js');
    const t = mintTicket(); const [e] = t.split('.');
    try { verifyGatewayTicket(`${e}.${b64url(randomBytes(32))}`); expect.unreachable(); } catch (err: any) { expect(err.kind).toBe('invalid_signature'); }
  });

  it('rejects expired ticket', async () => {
    const { verifyGatewayTicket, EmbedTicketError } = await import('../src/shopify/embed-ticket.js');
    try { verifyGatewayTicket(mintTicket({ exp: Math.trunc(Date.now() / 1000) - 100 })); expect.unreachable(); } catch (err: any) { expect(err.kind).toBe('expired'); }
  });

  it('rejects not-yet-valid ticket', async () => {
    const { verifyGatewayTicket, EmbedTicketError } = await import('../src/shopify/embed-ticket.js');
    try { verifyGatewayTicket(mintTicket({ iat: Math.trunc(Date.now() / 1000) + 3600 })); expect.unreachable(); } catch (err: any) { expect(err.kind).toBe('not_yet_valid'); }
  });

  it('rejects malformed ticket', async () => {
    const { verifyGatewayTicket, EmbedTicketError } = await import('../src/shopify/embed-ticket.js');
    try { verifyGatewayTicket('not-valid'); expect.unreachable(); } catch (err: any) { expect(err.kind).toBe('malformed'); }
  });

  it('rejects invalid shop domain', async () => {
    const { verifyGatewayTicket, EmbedTicketError } = await import('../src/shopify/embed-ticket.js');
    try { verifyGatewayTicket(mintTicket({ shopDomain: 'bad.com' })); expect.unreachable(); } catch (err: any) { expect(err.kind).toBe('malformed'); }
  });

  it('rejects wrong signing key', async () => {
    const { verifyGatewayTicket, EmbedTicketError } = await import('../src/shopify/embed-ticket.js');
    const now = Math.trunc(Date.now() / 1000);
    const p = { version: 1, shopDomain: 'evil.myshopify.com', seaiAccountId: 'a', nonce: 'n', iat: now, exp: now + 300 };
    const e = b64url(Buffer.from(JSON.stringify(p)));
    const s = b64url(createHmac('sha256', 'wrong-key').update(e).digest());
    try { verifyGatewayTicket(`${e}.${s}`); expect.unreachable(); } catch (err: any) { expect(err.kind).toBe('invalid_signature'); }
  });

  it('rejects replayed nonce', async () => {
    const { claimNonce, verifyGatewayTicket } = await import('../src/shopify/embed-ticket.js');
    const p = verifyGatewayTicket(mintTicket());
    expect(await claimNonce(p.nonce, new Date(p.exp * 1000))).toBe(true);
    expect(await claimNonce(p.nonce, new Date(p.exp * 1000))).toBe(false);
  });
});
