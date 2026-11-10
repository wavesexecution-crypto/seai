/**
 * Service delivery workflows — blueprint §6 rendered as task templates.
 * Each step: title, detail, kind, approval_required (gate), optional dependency
 * on the previous step. `launch`-type steps never auto-complete: completing
 * them records a human-verified action, it does not claim a platform launch.
 */
export interface WorkflowStep {
  title: string;
  detail?: string;
  kind: 'task' | 'deliverable' | 'milestone';
  gate?: boolean;         // requires client/staff approval before it can be marked done
  deps?: number[];        // indexes of steps in this template that must finish first
}

export const WORKFLOW_TEMPLATES: Record<string, WorkflowStep[]> = {
  advertising: [
    { title: 'Client onboarding & access', detail: 'Platform invites (Meta BM, Facebook Page, Instagram, Google Ads) — never passwords', kind: 'task' },
    { title: 'Account & tracking audit', detail: 'Pixel/CAPI, GA4, GTM, past campaigns, page quality', kind: 'task' },
    { title: 'Audience research & segmentation', kind: 'task', deps: [1] },
    { title: 'Campaign strategy & offer', detail: 'Objective, offer, funnel, budgets, KPI targets', kind: 'deliverable', deps: [2] },
    { title: 'Campaign build (ad sets, creatives, copy)', kind: 'task', deps: [3] },
    { title: 'Client approval — strategy & creatives', gate: true, kind: 'milestone', deps: [4] },
    { title: 'Launch (human-verified)', detail: 'Launch only after approval; record what was launched, where, and when', kind: 'task', deps: [5] },
    { title: 'Monitor & weekly optimisation', detail: 'Budget pacing, search terms, placements, creative rotation', kind: 'task', deps: [6] },
    { title: 'Monthly plain-language report', detail: 'Spend, reach, clicks, leads, CPL, what changed, what’s next — ad spend listed separately', kind: 'deliverable', deps: [7] },
  ],
  social: [
    { title: 'Brand & presence audit', detail: 'Profiles, post history, engagement, GBP, competitors', kind: 'task' },
    { title: 'Content strategy & pillars', kind: 'deliverable', deps: [0] },
    { title: 'Monthly content calendar', gate: true, kind: 'deliverable', deps: [1] },
    { title: 'Creative production (statics/carousels/reels + captions)', kind: 'task', deps: [2] },
    { title: 'Client approval — calendar & creatives', gate: true, kind: 'milestone', deps: [3] },
    { title: 'Schedule & publish (verified)', detail: 'Scheduling via Meta Business Suite; record published items', kind: 'task', deps: [4] },
    { title: 'Community management & engagement', kind: 'task', deps: [5] },
    { title: 'Monthly review & next-month plan', kind: 'deliverable', deps: [6] },
  ],
  website: [
    { title: 'Requirements & sitemap', kind: 'task' },
    { title: 'Wireframes / design direction', kind: 'deliverable', deps: [0] },
    { title: 'Client approval — design', gate: true, kind: 'milestone', deps: [1] },
    { title: 'Development build', kind: 'task', deps: [2] },
    { title: 'Content integration', detail: 'Real copy + imagery supplied by client; no lorem ipsum', kind: 'task', deps: [3] },
    { title: 'Testing (forms, speed, mobile, SSL)', kind: 'task', deps: [4] },
    { title: 'Client sign-off', gate: true, kind: 'milestone', deps: [5] },
    { title: 'Deploy & handover (client owns domain/hosting)', kind: 'task', deps: [6] },
    { title: 'Maintenance plan offer', kind: 'task', deps: [7] },
  ],
  lead_gen: [
    { title: 'Business assessment & offer definition', kind: 'task' },
    { title: 'Audience definition & qualification criteria', kind: 'task', deps: [0] },
    { title: 'Funnel design (page → form/click-to-chat → CRM/sheet)', kind: 'deliverable', deps: [1] },
    { title: 'Landing page build + tracking', kind: 'task', deps: [2] },
    { title: 'Client approval — funnel & offer', gate: true, kind: 'milestone', deps: [3] },
    { title: 'Campaign launch (human-verified)', kind: 'task', deps: [4] },
    { title: 'Lead capture routing & dedupe', detail: 'Route to CRM/sheet; dedupe against existing contacts', kind: 'task', deps: [5] },
    { title: 'Lead quality review', detail: 'Sample and grade leads against agreed criteria', kind: 'task', deps: [6] },
    { title: 'Monthly funnel report', kind: 'deliverable', deps: [7] },
  ],
  branding: [
    { title: 'Brand discovery interview', kind: 'task' },
    { title: 'Research & positioning (market, competitors, audience)', kind: 'task', deps: [0] },
    { title: 'Concept routes (2–3)', kind: 'deliverable', deps: [1] },
    { title: 'Client route selection', gate: true, kind: 'milestone', deps: [2] },
    { title: 'Refinement rounds (×2)', kind: 'task', deps: [3] },
    { title: 'Final approval', gate: true, kind: 'milestone', deps: [4] },
    { title: 'File pack + mini guidelines', detail: 'SVG/PNG logo pack, colours, type, usage do/don’ts', kind: 'deliverable', deps: [5] },
  ],
  automation: [
    { title: 'Journey mapping (enquiry → follow-up → close)', kind: 'task' },
    { title: 'Flow design (CRM stages, triggers, messages)', kind: 'deliverable', deps: [0] },
    { title: 'Build automations + handoff rules', detail: 'Human handoff mandatory; automation routes, humans sell', kind: 'task', deps: [1] },
    { title: 'Team test & sign-off', gate: true, kind: 'milestone', deps: [2] },
    { title: 'Go live (human-verified)', kind: 'task', deps: [3] },
    { title: 'Monitor & monthly tuning', kind: 'task', deps: [4] },
  ],
  growth: [
    { title: 'Read-only account & data access', kind: 'task' },
    { title: 'Marketing audit (scored)', kind: 'deliverable', deps: [0] },
    { title: 'Competitor research', kind: 'task', deps: [0] },
    { title: 'Strategy & 90-day roadmap', kind: 'deliverable', deps: [1, 2] },
    { title: 'Findings presentation', gate: true, kind: 'milestone', deps: [3] },
    { title: 'Actions enter retainer scope', kind: 'task', deps: [4] },
  ],
};

export const WORKFLOW_KEYS = Object.keys(WORKFLOW_TEMPLATES);
