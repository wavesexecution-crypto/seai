/**
 * Session persistence for the gateway.
 *
 * The concrete store (Postgres in production, in-memory in tests/dev) and all
 * shared row types live in `./data-store.ts`; this module intentionally re-
 * exports them so callers import from the planned `services/session-store`
 * module. Nothing here ever holds a plaintext Shopify access token — the
 * `StoredSession.accessTokenCiphertext` value is AES-256-GCM encrypted (see
 * `./crypto.ts`).
 */

export * from './data-store.js';

import { createDataStore } from './data-store.js';
export { createDataStore };
/** @deprecated prefer {@link createDataStore} (kept for the planned layout). */
export const createSessionStore = createDataStore;