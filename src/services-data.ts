/**
 * Service catalogue — single source for services.html.
 * Mirrors the SEAI business blueprint (§2). No fabricated claims:
 * capabilities are what SEAI actually delivers or is openly proposing.
 */
export interface ServiceDef {
  id: string;
  name: string;
  summary: string;
  available: "available" | "proposed" | "one_time";
  what: string;
  who: string;
  delivers: string[];
  execution: string[];
  requires: string[];
  receives: string[];
  measured: string;
  ctaSubject: string;
}

export const SERVICES: ServiceDef[] = [
  {
    id: "branding",
    name: "Branding & Identity",
    summary: "Positioning, visual identity, logo and guidelines — the foundation everything else stands on.",
    available: "proposed",
    what: "Defines who you are, who you are for, why you are different — then designs the identity that makes it unmistakable: positioning, logo, colour, type, voice, and lightweight guidelines your whole team can use.",
    who: "New businesses launching · established businesses with an inconsistent look · businesses repositioning for a new market or premium tier · anyone whose marketing materials were clearly made in five different decades.",
    delivers: ["Brand positioning & messaging sheet", "Logo system (primary, secondary, mono) in SVG/PNG", "Colour palette + typography selection", "Mini brand guidelines (PDF): usage, voice, do/don'ts", "Creative direction for campaigns", "File pack handover — yours to keep, forever"],
    execution: ["Discovery interview — history, values, ambition, non-negotiables", "Research & positioning — market, competitors, audience", "2–3 concept routes, presented with rationale", "You pick a route; 2 refinement rounds", "Final approval → file pack + guidelines"],
    requires: ["Your story honestly told (even if messy)", "Existing assets, if any (logo files, old ads, packaging)", "3–5 competitors you respect (and 1 you don't)", "Decision-maker in the room for route selection — one approver, not a committee"],
    receives: ["Complete logo + identity file pack", "Positioning & messaging one-pager", "Brand guidelines PDF", "30-minute handover call to walk your team through it"],
    measured: "Sign-off quality, consistency across assets, team adoption — branding is judged by usage, not by applause.",
    ctaSubject: "Branding & Identity",
  },
  {
    id: "advertising",
    name: "Advertising — Meta, Google, YouTube",
    summary: "Campaigns planned, built, approved by you, launched, optimised weekly — with honest reporting.",
    available: "available",
    what: "Full-funnel advertising across Instagram & Facebook (traffic, leads, messages, retargeting), Google (Search, Display, Performance Max) and YouTube (video ads): strategy, audience research, creative, media buying, targeting, launch, weekly optimisation and monthly plain-language reporting.",
    who: "Businesses with a working offer that need predictable demand · clinics, real estate, gyms, restaurants, salons, e-commerce and local services · anyone tired of boosting posts and calling it marketing.",
    delivers: ["Campaign strategy + offer & funnel design", "Audience research & segmentation", "Ad creative production (statics, carousels, video scripts)", "Media buying & budget allocation across platforms", "Tracking setup review (Pixel/CAPI, GA4, GTM)", "Weekly optimisation — bids, audiences, budgets, creatives", "Monthly report: spend, reach, clicks, leads, CPL, next steps"],
    execution: ["Account & tracking audit — what exists, what leaks", "Audience research → targeting hypotheses", "Strategy & budget plan — approved by you before launch", "Campaign build — audiences, creatives, copy, placements", "Your approval on strategy + creatives (nothing launches without it)", "Launch → weekly optimisation → monthly review"],
    requires: ["Ad account access via invites (Meta Business Manager partner access, Google Ads manager link) — never passwords", "Your monthly advertising budget — paid by you directly to the platforms; SEAI never marks it up", "An offer worth advertising — we'll help sharpen it, not invent a fake one", "Brand assets: logo, photos/videos, or budget for creative production", "Locations to target and a decision-maker for quick approvals"],
    receives: ["Live campaigns + complete setup documentation", "Creative files used in the campaigns", "Weekly optimisation notes + monthly plain-language report", "A dashboard-ready metrics summary your accountant and your team can both read"],
    measured: "CPC, CTR, cost-per-lead, lead quality, and agreed business outcomes vs targets we set together. We report misses as plainly as wins.",
    ctaSubject: "Advertising (Meta / Google / YouTube)",
  },
  {
    id: "social",
    name: "Digital Marketing & Social Media",
    summary: "Strategy, calendars, creative, publishing, community — consistency that compounds.",
    available: "available",
    what: "End-to-end social presence management: brand & presence audit, content strategy and pillars, monthly content calendar, creative production (statics, carousels, reels), captioning, scheduling, community management, Google Business Profile hygiene, and a monthly review that feeds next month's plan.",
    who: "Businesses that know they 'should post' but don't have the time or the system · restaurants, salons, gyms, clinics, retail and D2C brands · anyone whose Instagram is a ghost town but whose product is genuinely good.",
    delivers: ["Presence audit + 90-day content strategy", "Monthly content calendar (approved by you)", "12–20 posts/month depending on plan — statics, carousels, reels", "Captions, hashtags, CTAs in your brand voice", "Scheduling & publishing (verified) via Meta Business Suite", "Community management — comments, DMs, reviews", "Google Business Profile updates & review hygiene", "Monthly review: engagement, reach, profile visits, enquiries"],
    execution: ["Audit → pillars → calendar — the thinking before the making", "Monthly calendar presented for your approval", "Creative production in batches (saves time, keeps quality)", "Publish on schedule → monitor → engage", "Month-end review → next calendar informed by data"],
    requires: ["Photo/video library — phone clips are fine; real beats stock", "Access via invites (Facebook Page, Instagram, GBP)", "One approver with authority — slow approvals kill calendars", "Clear do's and don'ts (topics, words, claims you can't make)", "Your offers & festival calendar for the month"],
    receives: ["Consistent, on-brand posting — on schedule", "A growing content library you own", "Monthly performance review + next month's calendar", "Community handled — you stop being the full-time replier"],
    measured: "Posting consistency, reach, engagement rate, profile visits, DM enquiries and review velocity — reported in plain language every month.",
    ctaSubject: "Digital Marketing & Social Media",
  },
  {
    id: "website",
    name: "Website Development",
    summary: "Business sites, landing pages and e-commerce that convert — designed, built, deployed, maintained.",
    available: "one_time",
    what: "Everything from one-page sites to multi-page business websites, campaign landing pages and scoped e-commerce: requirements → sitemap → design → your approval → development → content → testing → deployment → optional monthly care plan. Fast, mobile-first, conversion-focused.",
    who: "Businesses without a website · businesses with a 2015 brochure-site losing trust · campaign teams needing high-converting landing pages · stores moving from social DMs to real checkout.",
    delivers: ["Requirements + sitemap + copy outline", "Design mockups (desktop + mobile) — approved before build", "Development (responsive, semantic, fast, accessible)", "Content integration — real copy, real imagery", "Forms, WhatsApp click-to-chat, booking & payment hooks (scoped)", "SEO fundamentals — meta, OG, sitemap, robots, speed", "Launch — domain, hosting, SSL handled with you (you own both)", "Optional monthly care plan — updates, fixes, monitoring"],
    execution: ["Requirements session → sitemap + scope (fixed, written)", "Design route — you review and approve", "Build → content → internal QA (forms, speed, mobile, SSL)", "Your sign-off on the staging link — nothing goes live without it", "DNS/hosting handover — domain always in YOUR name"],
    requires: ["Domain (you own it — we never hold it hostage)", "Content: text, images, logo, prices, hours — or we write copy as an add-on", "Page list + references you like (and ones you hate)", "Booking/payment needs up front — integrations change scope", "Hosting choice — or we recommend; you pay at cost, directly"],
    receives: ["A production website you own outright — code, content, domain", "Launch checklist + handover + basic training call", "Analytics + form tracking configured and verified", "Optional care plan: edits, updates, uptime monitoring"],
    measured: "On-time delivery vs scope, page speed, form/enquiry volume — and whether the site actually produces conversations.",
    ctaSubject: "Website Development",
  },
  {
    id: "lead-generation",
    name: "Lead Generation",
    summary: "Offer → funnel → capture → qualify → follow-up. Enquiries you can actually close.",
    available: "available",
    what: "Designing and running lead acquisition systems: lead campaigns (forms, messages, landing funnels), capture infrastructure (forms, click-to-chat, call tracking), qualification rules so you get serious enquiries, CRM/sheet delivery, and follow-up workflows — with monthly quality review.",
    who: "Clinics, real estate, gyms, salons, education, home services and B2B services with a clear offer and capacity to service more customers · businesses tired of 'leads' that are just curiosity.",
    delivers: ["Offer & funnel design — the why before the how", "Landing page (or improvement of yours) with tracking", "Lead capture — Meta lead forms / landing forms / click-to-chat", "Qualification criteria — agreed filters, enforced in the form", "CRM/Google Sheet routing with dedupe", "Follow-up templates + call scripts for your team", "Monthly lead quality audit — graded, not just counted"],
    execution: ["Business & offer assessment → target definition", "Funnel map approved by you → page + form + tracking built", "Campaign (with Ads service) or organic push launched", "Leads routed & deduped → your team follows the scripts", "Weekly quality check → monthly review → funnel iterations"],
    requires: ["An offer with a reason to act now (price, slots, season, bonus)", "Qualification criteria — at minimum: area, budget, timeline, need", "Someone to call leads within minutes — speed-to-lead is the conversion", "CRM or Google Sheet access (we'll set it up if you have neither)", "Ad budget if paid acquisition — separate, client-funded, never marked up"],
    receives: ["A live, tracked lead pipeline — not a spreadsheet of maybes", "Qualified, contactable enquiries delivered to your CRM/sheet", "Follow-up scripts + objection handling for your team", "Monthly quality report: lead count, CPL, quality grade, conversion hints"],
    measured: "Volume, cost-per-lead, qualification rate, lead→appointment rate — and honesty: if the offer is weak, we say so before you spend more.",
    ctaSubject: "Lead Generation",
  },
  {
    id: "sales-automation",
    name: "Sales & Automation",
    summary: "Follow-ups, pipelines and workflows that stop enquiries going cold — humans still close them.",
    available: "proposed",
    what: "The infrastructure between enquiry and revenue: enquiry routing, automated follow-ups and reminders, simple pipeline (new → contacted → won/lost), conversational FAQ + qualification with mandatory human handoff, and workflow automation connecting forms → CRM → alerts. Automation routes; humans sell.",
    who: "Businesses losing leads to slow or missed follow-ups · teams drowning in repetitive replies · founders who are the entire sales department and need leverage — not more software.",
    delivers: ["Journey map — what happens on every enquiry, today vs fixed", "Pipeline setup (CRM or sheet) with stages & SLAs", "Automated follow-up sequences (WhatsApp/SMS/email — channel per consent)", "Conversational reply flows — FAQ + qualify, human handoff always", "Internal alerts — to you, not to a void", "Monthly tuning — response time, follow-up completion, pipeline movement"],
    execution: ["Map the current journey — find the leaks", "Design flows + handoff rules — you approve what goes out", "Build on your CRM/tools (or recommend + set up)", "Team test — real scenarios, real objections", "Go live → monitor → monthly tuning"],
    requires: ["CRM access (invite) or agreement to set one up", "Your FAQs, pricing, and red-lines (what we never say)", "Escalation contact — a human, reachable", "Consent-appropriate channels & opt-out handling", "Honest availability: automation buys minutes, not days"],
    receives: ["Working pipeline + sequences — documented", "Who replied, who didn't, what went cold — visible", "Scripts + objection handling your team actually uses", "Monthly tuning report — response time, pipeline hygiene"],
    measured: "Response time, follow-up completion rate, pipeline movement, handoff quality — not vanity 'automation deployed' checkboxes.",
    ctaSubject: "Sales & Automation",
  },
  {
    id: "growth-strategy",
    name: "Growth Strategy & Audits",
    summary: "Marketing audits, competitor research, roadmaps — where the money actually moves.",
    available: "proposed",
    what: "Structured thinking for unstructured situations: full marketing audit (scored, prioritised fix list), competitor research, 90-day growth roadmap, conversion analysis ('where clicks leak'), and quarterly strategy reviews at Growth/Scale tiers.",
    who: "Owners who suspect they're wasting spend but can't see where · businesses plateaued at a revenue rung · established brands needing an outside, unsentimental read on their marketing.",
    delivers: ["Scored marketing audit + prioritised fix list (impact × effort)", "Competitor teardown — positioning, ads, content, offers", "90-day growth roadmap with owners & dates", "Conversion analysis — funnel leaks, ranked", "Findings presentation — decisions, not just observation", "Quarterly roadmap refresh (Scale tier / add-on)"],
    execution: ["Data pull — your accounts (read-only), your numbers", "Analysis — 3–5 working days, no theatre", "Written deliverable + presentation", "Actions you approve enter the retainer scope", "Re-audit next quarter — progress, not promises"],
    requires: ["Read-only access: ad accounts, analytics, search console, GBP", "High-level sales numbers (not sensitive data — just magnitudes)", "Your goals and your red lines", "Decision-maker availability for the findings session"],
    receives: ["The audit document — yours to keep", "A ranked action plan — what to fix first, what to kill", "Honest verdict: where SEAI fits (or doesn't)", "A roadmap your whole team can execute against"],
    measured: "Adoption of recommendations + movement on the target metric you chose. If the diagnosis is wrong, we say so — that's the point of outside eyes.",
    ctaSubject: "Growth Strategy & Audits",
  },
];

export const SERVICE_NAV = SERVICES.map((s) => ({ id: s.id, label: s.name.split("—")[0].trim().split("&")[0].trim() }));
