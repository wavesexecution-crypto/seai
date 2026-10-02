import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { createUser, findUserByEmail } from '../auth/service.js';
import { adoptIntakeFiles } from '../customer/routes.js';
import { dispatchEmail } from '../mail/dispatch.js';

export interface PaymentProvisionInput {
  orderId?: string;
  paymentId?: string;
  customerId?: string | null;
  email: string;
  businessName?: string;
  planName?: string;
  amountPaise?: number;
  currency?: string;
  purchaseConfirmedAt?: string;
  intakeSessionId?: string;
  storageFileIds?: string[];
}

/**
 * Idempotent post-purchase provision: a paid order lands here from an
 * authoritative payment event. A repeated event updates nothing and returns
 * the same customer/website pair.
 */
export async function provisionPaidOrder(input: PaymentProvisionInput): Promise<{ ok: true; userId: string; websiteId: string; repeated: boolean; reason?: string } | { ok: false; reason: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'missing customer email' };
  }
  if (!input.orderId) {
    return { ok: false, reason: 'missing order id' };
  }

  const now = new Date().toISOString();
  let user = await findUserByEmail(email);

  if (!user) {
    const displayName = input.businessName?.trim() || email.split('@')[0] || 'SEAI customer';
    // A staff operator can reset this unknown password after signup; the
    // customer's payment email tells them the workspace was created.
    user = await createUser(displayName, email, randomUUID());
  }

  const existingRows = await db.list('customer_websites', { user_id: user.id }, 1);
  let website = existingRows[0] as any | undefined;

  if (!website) {
    const row = await db.insert('customer_websites', {
      id: randomUUID(),
      user_id: user.id,
      site_name: input.businessName?.trim() || email.split('@')[0] || 'SEAI project',
      domain: '',
      deployment_status: 'unknown',
      last_deployment_at: null,
      ssl_status: 'unknown',
      order_id: input.orderId,
      plan_name: input.planName ?? null,
      order_amount_paise: input.amountPaise ?? null,
      order_currency: input.currency ?? 'INR',
      order_confirmed_at: input.purchaseConfirmedAt ?? now,
    });
    website = row as any;
  }

  let repeated = false;
  if (website?.order_id === input.orderId && website?.plan_name === input.planName) {
    repeated = true;
  } else {
    await db.update('customer_websites', website.id, {
      site_name: website.site_name || input.businessName?.trim() || input.email,
      order_id: input.orderId,
      plan_name: input.planName ?? null,
      order_amount_paise: input.amountPaise ?? null,
      order_currency: input.currency ?? 'INR',
      order_confirmed_at: input.purchaseConfirmedAt ?? now,
    });
    website = await db.list('customer_websites', { id: website.id }, 1).then((rows) => rows[0]) as any;
  }

  if (input.storageFileIds?.length) {
    try {
      const adopted = await adoptIntakeFiles(user.id, website.id, input.storageFileIds, input.orderId);
      if ('error' in adopted) {
        console.warn('[payment] intake file adoption skipped:', adopted.error);
      }
    } catch (err) {
      console.warn('[payment] intake file adoption failed:', (err as Error).message);
    }
  }

  return { ok: true, userId: user.id, websiteId: website.id, repeated, reason: repeated ? 'already provisioned' : undefined };
}
