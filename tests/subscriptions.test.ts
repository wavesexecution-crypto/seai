import { describe, it, expect } from 'vitest';
import { subscriptionPlanFor } from '../src/growth/billing.js';

describe('subscriptionPlanFor', () => {
  it('maps standard plans at catalogue fees', () => {
    expect(subscriptionPlanFor({ plan: 'starter', monthly_fee_inr: 7999 })).toEqual({ planKey: 'retainer_starter', amountInr: 7999 });
    expect(subscriptionPlanFor({ plan: 'growth', monthly_fee_inr: 14999 })).toEqual({ planKey: 'retainer_growth', amountInr: 14999 });
    expect(subscriptionPlanFor({ plan: 'scale', monthly_fee_inr: 29999 })).toEqual({ planKey: 'retainer_scale', amountInr: 29999 });
  });

  it('rejects custom agreements (invoice-billed, amounts are server-side)', () => {
    expect(subscriptionPlanFor({ plan: 'custom', monthly_fee_inr: 19999 })).toBeNull();
  });

  it('rejects standard plans with non-catalogue fees', () => {
    expect(subscriptionPlanFor({ plan: 'starter', monthly_fee_inr: 5999 })).toBeNull();
  });
});
