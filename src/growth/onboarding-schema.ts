/**
 * Client onboarding definition — the blueprint §5 information-collection
 * tables, encoded as data. Each field carries its mandatory/optional flag and
 * the reason SEAI collects it (shown in the UI). `services` scopes a field or
 * section to clients who purchased the matching service; omitted = everyone.
 *
 * Editing this file is the supported way to change the onboarding form —
 * no schema migration required (responses are stored as JSON per section).
 */

export interface OnboardingField {
  key: string;
  label: string;
  required: boolean;
  why: string;
  type: 'text' | 'textarea' | 'email' | 'tel' | 'url' | 'select' | 'boolean' | 'number';
  options?: string[];
  placeholder?: string;
  services?: string[]; // visible/required only when the client bought one of these
}

export interface OnboardingSection {
  key: string;
  title: string;
  intro: string;
  services?: string[];
  fields: OnboardingField[];
}

const ADS = ['advertising', 'lead_gen', 'social'];
const WEB = ['website'];

export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  {
    key: 'business',
    title: 'Business details',
    intro: 'Who we are working with — contracts, invoicing, targeting and creative all start here.',
    fields: [
      { key: 'legal_name', label: 'Legal business name', required: true, type: 'text', why: 'Contracts and GST invoicing require the legal entity name.' },
      { key: 'brand_name', label: 'Brand name (as used publicly)', required: true, type: 'text', why: 'All creative, profiles and ads use the brand name.' },
      { key: 'industry', label: 'Industry', required: true, type: 'text', placeholder: 'e.g. Clinic, Restaurant, Real estate…', why: 'Selects the playbook — channels, tone, metrics differ per industry.' },
      { key: 'description', label: 'What the business does (2–3 sentences)', required: true, type: 'textarea', why: 'Grounds all copy and strategy in reality, not assumptions.' },
      { key: 'address', label: 'Registered / primary address', required: true, type: 'textarea', why: 'Invoices and Google Business Profile / geo-targeting.' },
      { key: 'service_locations', label: 'Areas served', required: true, type: 'text', placeholder: 'e.g. Chennai, OMR, ECR', why: 'Defines ad targeting, local SEO and campaign radius.' },
      { key: 'website', label: 'Website', required: false, type: 'url', placeholder: 'https://', why: 'Audit baseline. No website is an opportunity, not a blocker.' },
      { key: 'social_links', label: 'Social media links', required: false, type: 'textarea', placeholder: 'Instagram, Facebook, LinkedIn, YouTube…', why: 'Audit and baseline — we measure growth against today.' },
      { key: 'registration_details', label: 'Registration / licence details', required: false, type: 'text', why: 'Needed for restricted ad categories (healthcare, finance) and billing.' },
    ],
  },
  {
    key: 'contact',
    title: 'Contact details',
    intro: 'Who we talk to, how fast they can decide, and where to reach them.',
    fields: [
      { key: 'primary_contact', label: 'Primary contact person', required: true, type: 'text', why: 'One accountable point of contact keeps delivery fast.' },
      { key: 'designation', label: 'Designation / role', required: true, type: 'text', why: 'Tells us their authority and day-to-day context.' },
      { key: 'email', label: 'Email', required: true, type: 'email', why: 'Proposals, reports, invoices and urgent pauses go here.' },
      { key: 'phone', label: 'Phone / WhatsApp', required: true, type: 'tel', why: 'Fastest channel for approvals and launch-day issues.' },
      { key: 'preferred_channel', label: 'Preferred communication channel', required: true, type: 'select', options: ['WhatsApp', 'Phone', 'Email'], why: 'We meet you where you actually respond.' },
      { key: 'decision_maker', label: 'Authorised decision-maker (name)', required: true, type: 'text', why: 'Prevents stalled approvals; this person signs the Scope of Work.' },
      { key: 'alt_contact', label: 'Alternate contact', required: false, type: 'text', why: 'Continuity when the primary is travelling or unavailable.' },
    ],
  },
  {
    key: 'brand',
    title: 'Brand assets & voice',
    intro: 'Everything that makes your brand look and sound like you — not like a template.',
    fields: [
      { key: 'brand_voice', label: 'How should the brand sound?', required: true, type: 'textarea', placeholder: 'e.g. Confident but warm, no jargon, speaks to busy parents…', why: 'Copy must sound like you, or every post needs rewriting.' },
      { key: 'competitors', label: 'Competitors (3–5)', required: true, type: 'textarea', placeholder: 'Names + links', why: 'Research, differentiation and benchmark creative/ad performance.' },
      { key: 'positioning', label: 'What makes you different?', required: false, type: 'textarea', why: 'The promise all creative anchors to.' },
      { key: 'logo_status', label: 'Logo files — what do you have?', required: false, type: 'select', options: ['Full logo pack (SVG/PNG)', 'Only a JPG/PNG', 'Nothing — need branding'], why: 'Determines whether we design or adapt; absence may mean a branding add-on.' },
      { key: 'brand_colours', label: 'Brand colours', required: false, type: 'text', placeholder: 'e.g. #0d1b2a, #f4f4f5', why: 'Visual consistency across every deliverable.' },
      { key: 'existing_materials', label: 'Existing creatives / brochures / posts', required: false, type: 'textarea', why: 'Quality bar and taste alignment; speeds up first deliverables.' },
      { key: 'design_references', label: 'Design references you like', required: false, type: 'textarea', why: 'Aligns taste before concepts — fewer rejection rounds.' },
    ],
  },
  {
    key: 'goals',
    title: 'Business goals & audience',
    intro: 'What success looks like, and who it is for. Strategy flows from this — nothing else.',
    fields: [
      { key: 'primary_objective', label: 'Primary objective', required: true, type: 'select', options: ['More footfall / calls', 'More leads & enquiries', 'More online sales', 'Brand awareness', 'Launch a new offering', 'Other'], why: 'Defines the metric we report and the funnel we build.' },
      { key: 'target_audience', label: 'Who is your ideal customer?', required: true, type: 'textarea', why: 'Targeting and creative tone both depend on this.' },
      { key: 'customer_demographics', label: 'Customer demographics', required: true, type: 'text', placeholder: 'Age, gender, income band…', why: 'Refines audience targeting and media selection.' },
      { key: 'geographic_market', label: 'Geographic market', required: true, type: 'text', placeholder: 'e.g. South Chennai, Tamil Nadu, India', why: 'Every campaign’s geography and language choices.' },
      { key: 'products_services', label: 'Products / services to promote', required: true, type: 'textarea', why: 'Whats promoted, in what order, and with what margin logic.' },
      { key: 'avg_transaction_value', label: 'Average transaction value (₹)', required: true, type: 'number', why: 'Economics check — what a lead/customer is worth to you.' },
      { key: 'acquisition_channels', label: 'Where customers come from today', required: false, type: 'textarea', why: 'We protect what works, fix what leaks, add what’s missing.' },
      { key: 'current_challenges', label: 'Biggest marketing challenge right now', required: true, type: 'textarea', why: 'The problem we are actually paid to solve.' },
      { key: 'desired_outcomes', label: 'What would a great 90 days look like?', required: true, type: 'textarea', why: 'Defines reported success and prevents mismatched expectations.' },
    ],
  },
  {
    key: 'advertising',
    title: 'Advertising accounts & access',
    intro: 'Access is via platform invites — never share passwords. We only request the access we need.',
    services: ADS,
    fields: [
      { key: 'meta_bm_status', label: 'Meta Business Manager status', required: true, type: 'select', options: ['Exists — can add you as partner', 'Exists — need help setting up', 'Does not exist — please create'], why: 'Required to run Facebook/Instagram ads and publish content.', services: ADS },
      { key: 'facebook_page', label: 'Facebook Page', required: false, type: 'text', why: 'Needed for ads, publishing and community management.', services: ADS },
      { key: 'instagram_account', label: 'Instagram account', required: false, type: 'text', why: 'Primary organic + ads surface for most local businesses.', services: ADS },
      { key: 'google_ads_status', label: 'Google Ads account', required: false, type: 'select', options: ['Exists — can add you as manager', 'Exists — need help', 'Does not exist — please create'], why: 'Required for Search/YouTube campaigns.', services: ADS },
      { key: 'analytics_status', label: 'Google Analytics (GA4)', required: false, type: 'select', options: ['Installed & shared', 'Installed — need help sharing', 'Not installed'], why: 'Clean conversion tracking; without it we fly blind.', services: ADS },
      { key: 'gtm_status', label: 'Google Tag Manager', required: false, type: 'select', options: ['Installed & shared', 'Not installed'], why: 'Fast, reliable tracking changes without code deploys.', services: ADS },
      { key: 'target_locations', label: 'Target locations for campaigns', required: true, type: 'text', placeholder: 'e.g. OMR, Sholinganallur, 10 km radius', why: 'Every campaign’s geo — wasted spend otherwise.', services: ADS },
      { key: 'monthly_ad_budget', label: 'Monthly advertising budget (₹, paid to platforms)', required: true, type: 'number', why: 'Sets scale and expected volume. Separate from SEAI fees — always paid by you directly to Meta/Google.', services: ADS },
      { key: 'historical_spend', label: 'Previous ad spend (last 6–12 months)', required: false, type: 'text', why: 'Avoids repeating failed targeting; calibrates budgets.', services: ADS },
      { key: 'previous_campaigns', label: 'What has been tried before?', required: false, type: 'textarea', why: 'We learn from your data, not from generic templates.', services: ADS },
      { key: 'existing_creatives', label: 'Existing ad creatives / photos / videos', required: false, type: 'textarea', why: 'Faster launch and lower production cost.', services: ADS },
    ],
  },
  {
    key: 'website',
    title: 'Website & domain',
    intro: 'You own the domain and hosting — we only hold the access we need to build and maintain.',
    services: WEB,
    fields: [
      { key: 'domain_registrar', label: 'Domain registrar & domain', required: true, type: 'text', placeholder: 'e.g. GoDaddy — yourbrand.in', why: 'The domain must be in your name; we need DNS access to launch.', services: WEB },
      { key: 'hosting', label: 'Hosting provider / panel', required: true, type: 'text', why: 'Determines deployment route and who pays hosting (you, at cost).', services: WEB },
      { key: 'existing_site_access', label: 'Existing website (if any) — access or export', required: false, type: 'text', why: 'Content migration and URL mapping for redesigns.', services: WEB },
      { key: 'required_pages', label: 'Pages required', required: true, type: 'textarea', placeholder: 'Home, About, Services, Gallery, Contact…', why: 'Defines sitemap, scope and quote.', services: WEB },
      { key: 'site_content', label: 'Content: text, images, prices, hours', required: true, type: 'textarea', why: 'Real content, no lorem ipsum — we need the raw material.', services: WEB },
      { key: 'booking_requirements', label: 'Booking / appointment needs', required: false, type: 'textarea', why: 'Scopes scheduling integrations (clinics, salons, gyms).', services: WEB },
      { key: 'payment_requirements', label: 'Online payments / e-commerce needs', required: false, type: 'textarea', why: 'Scopes gateway integration — your gateway account, never our card data.', services: WEB },
      { key: 'integrations', label: 'Forms / integrations (CRM, WhatsApp, email)', required: false, type: 'textarea', why: 'Enquiry destinations and automation hooks.', services: WEB },
    ],
  },
  {
    key: 'content',
    title: 'Content & approvals',
    intro: 'How content gets made, approved and posted — and who signs off.',
    fields: [
      { key: 'photos', label: 'Photo library (premises / products / team)', required: true, type: 'textarea', placeholder: 'Link a shared folder or note “will upload” below', why: 'Real visuals beat stock — first posts depend on this.' },
      { key: 'videos', label: 'Videos / reels material', required: false, type: 'textarea', why: 'Reels and shorts feeds; phone clips are fine.' },
      { key: 'testimonials', label: 'Testimonials / reviews', required: false, type: 'textarea', why: 'Social proof for ads and landing pages.' },
      { key: 'content_do_donts', label: 'Content do’s and don’ts', required: true, type: 'textarea', placeholder: 'Topics to avoid, words we never use, claims we can’t make…', why: 'Prevents rejected work and legal trouble (healthcare claims, etc.).' },
      { key: 'content_approver', label: 'Who approves content? (name + channel)', required: true, type: 'text', why: 'One approver keeps the calendar on schedule.' },
    ],
  },
  {
    key: 'financial',
    title: 'Financial & contract',
    intro: 'Fees, budgets, GST and renewal — the paperwork that keeps everything clean.',
    fields: [
      { key: 'selected_services', label: 'Services purchased', required: true, type: 'text', placeholder: 'Auto-filled from your plan — confirm or correct', why: 'Scope of Work and invoice line items.' },
      { key: 'monthly_service_fee', label: 'Monthly service fee (₹)', required: true, type: 'number', why: 'Your retainer — SEAI revenue, billed monthly in advance.' },
      { key: 'separate_ad_budget', label: 'Ad budget paid by you directly to platforms (₹/mo)', required: true, type: 'number', why: 'Hard separation: we never mark up ad spend. Confirm even if ₹0 for now.' },
      { key: 'billing_frequency', label: 'Billing frequency', required: true, type: 'select', options: ['Monthly', 'Quarterly', 'Annual'], why: 'Sets invoice cadence and renewal anchor date.' },
      { key: 'gstin', label: 'GSTIN (if registered)', required: false, type: 'text', why: 'Mandatory on compliant tax invoices when you are GST-registered.' },
      { key: 'contract_duration', label: 'Contract duration', required: true, type: 'select', options: ['Month-to-month (15-day notice)', '3 months', '6 months', '12 months'], why: 'Renewal and cancellation terms, up front — no surprises.' },
      { key: 'renewal_terms', label: 'Renewal terms agreed', required: false, type: 'text', placeholder: 'e.g. Auto-renews monthly, 15-day written notice to cancel', why: 'Matches the signed agreement.' },
      { key: 'billing_contact', label: 'Billing contact (if different)', required: false, type: 'text', why: 'Invoices reach whoever pays them.' },
    ],
  },
];

export function sectionsForServices(services: string[] | null | undefined): OnboardingSection[] {
  const set = new Set((services ?? []).map((s) => s.toLowerCase()));
  return ONBOARDING_SECTIONS.filter((section) => {
    if (section.services && set.size > 0 && !section.services.some((s) => set.has(s))) return false;
    return true;
  }).map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !field.services || set.size === 0 || field.services.some((s) => set.has(s))),
  }));
}

/** Mandatory fields across visible sections for the given services. */
export function requiredFields(services: string[] | null | undefined): { section: string; field: string }[] {
  return sectionsForServices(services).flatMap((s) =>
    s.fields.filter((f) => f.required).map((f) => ({ section: s.key, field: f.key })),
  );
}
