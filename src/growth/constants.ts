/**
 * Shared vocabulary for the SEAI growth system.
 * Stage keys are stored in the DB; labels are for display only.
 */

export const LEAD_STAGES = [
  { key: 'new', label: 'New lead' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'responded', label: 'Responded' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'discovery_scheduled', label: 'Discovery scheduled' },
  { key: 'discovery_completed', label: 'Discovery completed' },
  { key: 'proposal_sent', label: 'Proposal sent' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
  { key: 'follow_up', label: 'Follow-up' },
] as const;

export const LEAD_STAGE_KEYS = LEAD_STAGES.map((s) => s.key) as string[];
export const LEAD_STAGE_LABEL: Record<string, string> = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.label]));

/** Stages that count as "closed" for conversion-rate reporting. */
export const CLOSED_STAGES = ['won', 'lost'];

export const LEAD_SOURCES = [
  'referral', 'outbound', 'inbound', 'dm', 'campaign', 'website', 'import', 'event', 'other', 'manual',
] as const;

export const LEAD_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const BUSINESS_SIZES = ['solo', 'small', 'medium', 'large'] as const;

/**
 * Service catalogue — mirrors blueprint §2. `recurring` marks services billed
 * monthly; `oneTime` marks scoped projects. Ad budget is never a SEAI fee.
 */
export const SERVICE_CATALOGUE = [
  { key: 'branding', label: 'Branding & Identity', recurring: false, oneTime: true, workflow: 'branding' },
  { key: 'advertising', label: 'Advertising (Meta / Google / YouTube)', recurring: true, oneTime: false, workflow: 'advertising' },
  { key: 'social', label: 'Digital Marketing / Social Media', recurring: true, oneTime: false, workflow: 'social' },
  { key: 'website', label: 'Website Development', recurring: false, oneTime: true, workflow: 'website' },
  { key: 'lead_gen', label: 'Lead Generation', recurring: true, oneTime: false, workflow: 'lead_gen' },
  { key: 'automation', label: 'Sales & Automation', recurring: true, oneTime: true, workflow: 'automation' },
  { key: 'growth', label: 'Growth Strategy & Audits', recurring: true, oneTime: true, workflow: 'growth' },
] as const;

export const SERVICE_KEYS = SERVICE_CATALOGUE.map((s) => s.key) as string[];
export const SERVICE_LABEL: Record<string, string> = Object.fromEntries(SERVICE_CATALOGUE.map((s) => [s.key, s.label]));

/** Retainer plans — proposed pricing, single source of truth (mirrors /pricing). */
export const PLAN_CATALOGUE = [
  { key: 'starter', name: 'Starter', monthlyFeeInr: 7999, blurb: 'Small / single-location businesses' },
  { key: 'growth', name: 'Growth', monthlyFeeInr: 14999, blurb: 'Growing businesses' },
  { key: 'scale', name: 'Scale', monthlyFeeInr: 29999, blurb: 'Established businesses / full funnel' },
  { key: 'custom', name: 'Custom', monthlyFeeInr: 0, blurb: 'Scoped to your requirements' },
] as const;
export type PlanKey = (typeof PLAN_CATALOGUE)[number]['key'];

export const INQUIRY_SERVICES = SERVICE_KEYS; // inquiry form reuses the same keys
