/**
 * GET /api/payment/plans
 *
 * Server-authoritative plan catalogue, read from seai.payments.
 *
 * The intake form displays prices, but those must come from here rather than
 * from a hard-coded table in the bundle: seai.payments is the single pricing
 * authority, and this endpoint keeps the marketing page and the charge aligned
 * without shipping a second copy of the prices.
 *
 * The upstream `/plans` route sits behind the same service auth as every other
 * `/api/v1` route, so the call must carry the service key.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { callPaymentsApi, resolvePaymentsConfig } from '../../server/payments-core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { paymentApiBase, serviceKey } = resolvePaymentsConfig();

  const upstream = await callPaymentsApi({
    baseUrl: paymentApiBase,
    serviceKey,
    path: '/plans',
    method: 'GET',
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, error: upstream.error });
  }

  const plans: any[] = Array.isArray(upstream.data?.plans) ? upstream.data.plans : [];
  const safePlans = plans
    .filter(
      (plan: any) =>
        plan &&
        typeof plan.id === 'string' &&
        typeof plan.name === 'string' &&
        Number.isFinite(plan.amountPaise),
    )
    .map((plan: any) => ({
      id: plan.id,
      name: plan.name,
      amountPaise: plan.amountPaise,
      currency: plan.currency ?? 'INR',
      type: plan.type ?? 'one_time',
    }));

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({ ok: true, plans: safePlans });
}
