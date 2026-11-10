/**
 * Retainer plans — SINGLE SOURCE OF TRUTH (proposed pricing, blueprint §7).
 * Change values here; the pricing page and homepage render from this file.
 * Ad budgets are NEVER part of these fees — clients pay platforms directly.
 */
export interface RetainerPlan {
  key: string;
  name: string;
  monthlyFeeInr: number;
  tagline: string;
  idealFor: string;
  features: string[];
  featured?: boolean;
}

export const RETAINER_PLANS: RetainerPlan[] = [
  {
    key: "starter",
    name: "Starter",
    monthlyFeeInr: 7999,
    tagline: "Be consistent, get noticed locally.",
    idealFor: "Small · single-location businesses",
    features: [
      "8 posts per month (Instagram + Facebook)",
      "1 ad campaign managed (Meta or Google)",
      "Google Business Profile hygiene",
      "Monthly performance summary (plain language)",
      "Festival/offer creative support",
      "Monthly renewal — earn it every month",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    monthlyFeeInr: 14999,
    tagline: "A full funnel, not just posts.",
    idealFor: "Growing businesses ready for ads + leads",
    featured: true,
    features: [
      "12–16 posts per month with strategy",
      "2 ad campaigns with weekly optimisation",
      "1 landing page per quarter",
      "Lead capture → CRM/sheet + follow-up templates",
      "Monthly report + strategy call",
      "Community management & DM handling",
      "Quarterly content calendar planning",
    ],
  },
  {
    key: "scale",
    name: "Scale",
    monthlyFeeInr: 29999,
    tagline: "Full-funnel growth, run like a department.",
    idealFor: "Established businesses & multi-location brands",
    features: [
      "20+ posts per month + content engine",
      "Meta + Google ads, weekly optimisation",
      "Quarterly strategy review with roadmap",
      "Automation + lead management workflows",
      "Priority support (same-day response)",
      "Conversion tracking & monthly funnel review",
      "Competitor & market watch",
    ],
  },
];

/** What is explicitly NOT included in any retainer. */
export const NOT_INCLUDED = [
  "Advertising budget — paid by you, directly to Meta/Google (we never mark it up)",
  "Third-party software (CRM, scheduling, review tools) — at cost, with your approval",
  "GST — added where applicable to service invoices",
  "Website redesigns & branding projects — quoted separately per scope",
  "Out-of-scope work — always a written change request first, never silently absorbed",
];

/** What SEAI never promises. */
export const NO_GUARANTEES =
  "No guaranteed leads, sales, impressions or revenue — anyone promising those is selling fantasy. We commit to strategy, execution, transparency and weekly optimisation.";
