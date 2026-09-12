import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createApp } from '../src/server.js';

const config = loadConfig({ NODE_ENV: 'test' });
const logger = createLogger('silent');
const app = createApp({ config, logger });

describe('health endpoints', () => {
  it('GET /health returns ok with service metadata', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('seai-shopify-gateway');
    expect(res.body.version).toBe('0.2.0');
    expect(res.body.featureMode).toBe(false);
  });

  it('GET /health/ready reports readiness (memory store in tests)', async () => {
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.database).toBe('ok');
  });

  it('attaches an X-Request-Id to every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/definitely-not-a-route').expect(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('not_found');
  });
});

describe('phase 2 live routes (feature mode OFF => graceful 503/401/400)', () => {
  it('auth: GET /auth without a shop returns invalid_shop (400)', async () => {
    const res = await request(app).get('/auth').expect(400);
    expect(res.body.error).toBe('invalid_shop');
  });

  it('embed: GET /embed/activity without a session token returns missing_token (401)', async () => {
    const res = await request(app).get('/embed/activity').expect(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('connect: GET /connect/callback without params returns invalid_callback (400)', async () => {
    const res = await request(app).get('/connect/callback').expect(400);
    expect(res.body.error).toBe('invalid_callback');
  });

  it('webhooks: POST /webhooks/app/uninstalled without config returns 503 (not hang)', async () => {
    const res = await request(app)
      .post('/webhooks/app/uninstalled')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(503);
    expect(res.body.error).toBe('webhooks_not_configured');
  });

  it('graphql proxy: POST /v1/graphql/:shop without a token returns missing_token (401)', async () => {
    const res = await request(app)
      .post('/v1/graphql/example.myshopify.com')
      .send({ query: '{ shop { id } }' })
      .expect(401);
    expect(res.body.error).toBe('missing_token');
  });
});