/**
 * SEAI Public Site - Payment Proxy Server
 *
 * Server-side proxy for seai.payments API calls.
 * Keeps service-to-service authentication keys out of the browser.
 *
 * Deploy this as a separate service or alongside the static site.
 * Required environment variables:
 * - SEAI_PUBLIC_SERVICE_KEY (service API key for seai.public)
 * - SEAI_PAYMENT_API_BASE (e.g., https://payments.seai.store/api/v1)
 * - ALLOWED_ORIGIN (e.g., https://seai.store)
 *
 * Contract: seai.payments README (API Reference). Auth is
 * `Authorization: Bearer <SEAI_PUBLIC_SERVICE_KEY>`. Plan pricing is
 * server-authoritative in seai.payments — this proxy allowlists plan IDs
 * and never forwards browser-supplied amounts.
 */

import express from 'express';
import cors from 'cors';
import { config } from './config.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Server-authoritative plan allowlist. Amounts are resolved by seai.payments;
// unknown plan IDs are rejected here before any upstream call.
const ALLOWED_PLANS = ['starter', 'business', 'complete'];

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'https://seai.store',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'seai.public-payment-proxy' });
});

// Proxy: Create payment order
app.post('/api/payment/order', async (req, res) => {
  try {
    const { customerId, planId, idempotencyKey, metadata } = req.body;

    if (!customerId || !planId) {
      return res.status(400).json({ ok: false, error: 'customerId and planId required' });
    }
    if (!ALLOWED_PLANS.includes(planId)) {
      return res.status(400).json({ ok: false, error: 'Unknown plan' });
    }

    const payload = {
      customerId,
      planId,
      idempotencyKey: idempotencyKey || `intake_${Date.now()}`,
      metadata: {
        source: 'seai.public',
        ...metadata
      }
    };

    const response = await fetch(`${config.paymentApiBase}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceKey}`,
        'X-Idempotency-Key': payload.idempotencyKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[proxy] Create order failed:', result);
      return res.status(response.status).json({ ok: false, error: result.error || 'Failed to create payment order' });
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[proxy] Create order error:', err);
    res.status(500).json({ ok: false, error: 'Payment service unavailable' });
  }
});

// Proxy: Verify payment
app.post('/api/payment/verify', async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ ok: false, error: 'Missing verification fields' });
    }

    const response = await fetch(`${config.paymentApiBase}/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceKey}`
      },
      body: JSON.stringify({ razorpayOrderId, razorpayPaymentId, razorpaySignature }),
      signal: AbortSignal.timeout(15000)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[proxy] Verify payment failed:', result);
      return res.status(response.status).json({ ok: false, error: result.error || 'Payment verification failed' });
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[proxy] Verify payment error:', err);
    res.status(500).json({ ok: false, error: 'Payment verification service unavailable' });
  }
});

// Proxy: Get plans (public info)
app.get('/api/payment/plans', async (req, res) => {
  try {
    const response = await fetch(`${config.paymentApiBase}/plans`, { signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    console.error('[proxy] Get plans error:', err);
    res.status(500).json({ ok: false, error: 'Failed to load plans' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[proxy] Payment proxy server running on port ${PORT}`);
  });
}

export { app };
