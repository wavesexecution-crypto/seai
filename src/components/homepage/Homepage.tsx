import SiteChrome from "@/components/site/SiteChrome";
import { openCalPopup } from "@/components/ui/calcom";

const SERVICE_CARDS = [
  { key: "branding", name: "Branding & Identity", desc: "Positioning, logos, guidelines and creative direction that make you unmistakable.", href: "/services.html#branding" },
  { key: "advertising", name: "Advertising", desc: "Meta, Facebook, Instagram, Google & YouTube — planned, built, approved, launched, optimised.", href: "/services.html#advertising" },
  { key: "social", name: "Digital Marketing", desc: "Social management, content strategy, calendars, creative production and community.", href: "/services.html#social" },
  { key: "website", name: "Website Development", desc: "Business sites, landing pages, e-commerce, redesigns and conversion optimisation.", href: "/services.html#website" },
  { key: "lead-generation", name: "Lead Generation", desc: "Funnels, lead capture, qualification and CRM hand-off — enquiry to opportunity.", href: "/services.html#lead-generation" },
  { key: "sales-automation", name: "Sales & Automation", desc: "Follow-ups, workflow automation and engagement systems — humans still close.", href: "/services.html#sales-automation" },
  { key: "growth-strategy", name: "Growth Strategy", desc: "Marketing audits, competitor research, strategy and conversion optimisation.", href: "/services.html#growth-strategy" },
];

const INDUSTRIES = [
  "Restaurants & Cafés", "Gyms & Fitness", "Salons & Beauty", "Clinics & Healthcare", "Real Estate",
  "Retail Stores", "E-commerce", "Education", "Professional Services", "Startups",
];

const DEMOS = [
  { name: "Restaurant", url: "/examples/restaurant.html" },
  { name: "Cafe", url: "/examples/cafe.html" },
  { name: "Gym", url: "/examples/gym.html" },
  { name: "Salon", url: "/examples/salon.html" },
  { name: "Clinic", url: "/examples/clinic.html" },
  { name: "Real Estate", url: "/examples/real-estate.html" },
  { name: "Business", url: "/examples/business.html" },
];

export default function Homepage() {
  return (
    <SiteChrome active="home">
      {/* HERO */}
      <section className="g-hero" aria-labelledby="hero-title">
        <div className="container-wide">
          <p className="g-kicker">Marketing · Advertising · Growth</p>
          <h1 id="hero-title" className="g-wordmark">SEAI</h1>
          <p className="g-tagline">“Get Exposed. But in a Good Way.”</p>
          <p className="g-sub">We help businesses get noticed, reach the right audience and turn attention into growth — branding, ads, social, websites, lead generation and follow-up systems, delivered as one integrated monthly service.</p>
          <div className="g-actions">
            <a className="btn btn-invert btn-lg" href="/contact.html" onClick={(e) => { e.preventDefault(); openCalPopup(); }}>Let's Grow Your Business <span className="arr" aria-hidden="true">→</span></a>
            <a className="btn btn-ghost-dark btn-lg" href="/services.html">Explore Our Services</a>
          </div>
          <p className="g-note">Every business needs exposure — regardless of size. No guaranteed leads, ever; real strategy, real execution, plain reporting.</p>
          <div className="g-proof" aria-label="How we work">
            <div><b>Strategy first</b>Audit → plan → execute</div>
            <div><b>Approved, not assumed</b>Nothing ships without your sign-off</div>
            <div><b>Plain-language reporting</b>Spend, leads, CPL — in words, not jargon</div>
            <div><b>Ad budget stays yours</b>Paid to platforms, never marked up</div>
          </div>
        </div>
      </section>

      {/* THE PROBLEM */}
      <section className="g-sec" aria-labelledby="problem-title">
        <div className="container-wide">
          <p className="g-num">01 — The problem</p>
          <h2 id="problem-title" className="sec-title">Good businesses stay invisible.</h2>
          <p className="sec-lede">You built something worth noticing. But without visibility, the market never finds out — and your competitors with louder (not better) marketing take the demand.</p>
          <div className="g-grid" style={{ marginTop: 26 }}>
            {[
              ["No consistent presence", "Posting whenever you remember means the algorithm forgets you. Consistency is the entry ticket, not a luxury."],
              ["Ads that “don't work”", "Usually not the ad — no offer, no targeting, no follow-up, no tracking. Campaigns need a funnel, not just a budget."],
              ["Leads that go cold", "Enquiries sit unanswered for hours; by evening the customer has already booked a competitor."],
              ["Agencies you can't afford or trust", "Big retainers, black-box reports, long lock-ins — and zero clarity on what the money did."],
              ["A website that doesn't sell", "Pretty, but no offer, no CTA, no proof, no follow-up. Traffic without conversion is just expense."],
              ["No plan, just activity", "Random reels, random boosts. Activity without strategy is motion without progress."],
            ].map(([t, d]) => (
              <div className="g-card" key={t as string}><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      {/* THE APPROACH */}
      <section className="g-sec g-sec--alt" aria-labelledby="approach-title">
        <div className="container-wide">
          <p className="g-num">02 — Our approach</p>
          <h2 id="approach-title" className="sec-title">One engine, everything it needs.</h2>
          <p className="sec-lede">SEAI is a marketing, advertising and growth company — not a website vendor, not an ads vendor, not a social media page manager. We run the whole loop: get you seen, get you chosen, get you repeated.</p>
          <div className="g-steps" style={{ marginTop: 28 }}>
            {[
              ["Listen & audit", "Your business, goals, numbers, current presence — plus a quick public audit of site, socials, Google profile and ads."],
              ["Strategy & offer", "Who we target, what we promise, which channels, with what offer — agreed with you before a rupee is spent."],
              ["Create & approve", "Brand, content, ads, pages, funnels — built to your market, reviewed by you. Nothing ships without sign-off."],
              ["Launch & manage", "Campaigns go live, content publishes on schedule, community gets handled, leads get routed."],
              ["Measure & refine", "Weekly optimisation and a plain-language monthly report: spend, reach, leads, cost per lead — and what we change next."],
            ].map(([t, d], i) => (
              <div className="g-step" key={t as string}>
                <div className="n">{String(i + 1).padStart(2, "0")}</div>
                <div><h3>{t}</h3><p>{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className="g-sec" aria-labelledby="services-title">
        <div className="container-wide">
          <p className="g-num">03 — What we do</p>
          <h2 id="services-title" className="sec-title">Every lever of exposure, one team.</h2>
          <p className="sec-lede">Pick what you need — we'll tell you honestly what you don't.</p>
          <div className="g-grid" style={{ marginTop: 26 }}>
            {SERVICE_CARDS.map((s) => (
              <a key={s.key} href={s.href} className="g-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                <h3>{s.name}</h3><p>{s.desc}</p>
                <p style={{ marginTop: 10, color: "#144d5e", fontWeight: 600, fontSize: 13 }}>See how it works →</p>
              </a>
            ))}
          </div>
          <p className="g-fineprint">Full details, deliverables and "what we need from you" per service: <a href="/services.html">services overview</a>.</p>
        </div>
      </section>

      {/* INDUSTRIES */}
      <section className="g-sec g-sec--alt" aria-labelledby="industries-title">
        <div className="container-wide">
          <p className="g-num">04 — Who we serve</p>
          <h2 id="industries-title" className="sec-title">Same engine, different fuel.</h2>
          <p className="sec-lede">The process never changes; the offer, creative, channels and metrics do. We work with:</p>
          <div className="g-industry-pills">
            {INDUSTRIES.map((i) => (
              <a key={i} href="/industries.html" className="g-industry-pill">{i}</a>
            ))}
          </div>
          <p className="g-fineprint"><a href="/industries.html">Industry-specific plays, demo sites and what “good” looks like →</a></p>
        </div>
      </section>

      {/* WORKING PROCESS */}
      <section className="g-sec" id="how" aria-labelledby="process-title" style={{ scrollMarginTop: "calc(var(--header-h) + 16px)" }}>
        <div className="container-wide">
          <p className="g-num">05 — How it works</p>
          <h2 id="process-title" className="sec-title">From first call to first results.</h2>
          <div className="g-steps" style={{ marginTop: 26 }}>
            {[
              ["Discovery call (30–45 min)", "Goals, current marketing, budget comfort, decision-makers. We listen more than we pitch — fit matters both ways."],
              ["Business assessment", "Quick audit + a one-page findings note: top 3 opportunities, honestly prioritised."],
              ["Proposal & scope", "Services, monthly deliverables, fee (ad budget separate and yours to control), timelines. Sent within 3 working days."],
              ["Agreement & kickoff", "Signed Scope of Work → onboarding: access via official platform invites (never passwords), assets, goals, tracking."],
              ["Execution & approvals", "Strategy → creative → your approval → launch. Cadence and reporting set from week one."],
              ["Monthly review & renewal", "Delivered vs scope, metrics, next month's focus. Monthly renewal — we re-earn the engagement every month."],
            ].map(([t, d], i) => (
              <div className="g-step" key={t as string}>
                <div className="n">{String(i + 1).padStart(2, "0")}</div>
                <div><h3>{t}</h3><p>{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY SEAI */}
      <section className="g-sec g-sec--dark" aria-labelledby="why-title">
        <div className="container-wide">
          <p className="g-num">06 — Why businesses choose us</p>
          <h2 id="why-title" className="sec-title dark-title">Exposure you can actually account for.</h2>
          <div className="g-grid" style={{ marginTop: 26 }}>
            {[
              ["Full funnel, one team", "Brand → ads → social → website → leads → follow-up. No hand-offs to freelancers who never saw the strategy."],
              ["Accessible monthly plans", "Starter ₹7,999 · Growth ₹14,999 · Scale ₹29,999 — scoped to what moves your metrics, not vanity deliverables."],
              ["No lock-ins", "Month-to-month after the first cycle. 15-day written notice; work completes through the paid period."],
              ["Total ad-spend transparency", "You pay platforms directly; we report spend to the rupee. Zero markup, zero markup, zero markup."],
              ["Approval before everything", "Creatives, campaigns, calendars — approved by you. Nothing ships on our assumption."],
              ["Honest reporting", "Plain language, real numbers, manual or API-sourced — labelled as such. Never estimates dressed as results."],
            ].map(([t, d]) => (
              <div className="dark-card" key={t as string}><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      {/* PORTFOLIO / DEMONSTRATIONS */}
      <section className="g-sec" aria-labelledby="portfolio-title">
        <div className="container-wide">
          <p className="g-num">07 — Portfolio & demonstrations</p>
          <h2 id="portfolio-title" className="sec-title">See the standard we hold ourselves to.</h2>
          <p className="sec-lede">These are demonstration builds we designed to show our bar — not client work, and we don't attach borrowed results to them. For references from businesses like yours, ask in your discovery call.</p>
          <div className="demo-strip" style={{ marginTop: 22 }}>
            {DEMOS.map((d) => (
              <a key={d.name} href={d.url}>{d.name}<small>Demonstration build ↗</small></a>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIAL PLACEHOLDER — deliberately omitted */}
      {/* We publish no testimonials we haven't earned and verified. Ask for references on your discovery call. */}

      {/* FAQ */}
      <section className="g-sec" id="faq" aria-labelledby="faq-title" style={{ scrollMarginTop: "calc(var(--header-h) + 16px)" }}>
        <div className="container-wide">
          <p className="g-num">08 — Frequently asked</p>
          <h2 id="faq-title" className="sec-title">Fair questions, straight answers.</h2>
          <div className="g-grid" style={{ marginTop: 26, gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" }}>
            {[
              ["What does SEAI actually cost?", "Monthly retainers from ₹7,999 (Starter), ₹14,999 (Growth) and ₹29,999 (Scale) — see Pricing. Ad budgets are separate and paid by you directly to Meta/Google; we never mark them up. GST extra where applicable."],
              ["Do you guarantee leads or sales?", "No — and be careful with any agency that does. We guarantee strategy, execution, transparency and weekly optimisation. Your offer, market and follow-up speed decide the rest."],
              ["What do you need from me?", "A short intake (goals, audience, budgets), platform access via official invites (never passwords), your brand assets, and one approver who can say yes fast. About an hour up front; then ~20 minutes a week."],
              ["Who owns the ad accounts, domain and data?", "You do — all registered in your name. We hold only the access we need. Leave any time with 15 days' notice and keep everything we've built."],
              ["How fast do we start and see results?", "Discovery → proposal within 3 working days → kickoff the same week. First deliverables land in approval within the first fortnight; ad tests typically start flowing leads within 2–4 weeks depending on budget and offer."],
              ["What if I'm not sure SEAI is right for me?", "Say so on the discovery call. If we're not the right fit — wrong stage, wrong budget, or a problem we can't solve — we'll tell you plainly instead of taking the retainer."],
            ].map(([q, a]) => (
              <details key={q as string} style={{ background: "#fff" }}>
                <summary>{q}</summary>
                <div className="db"><p style={{ margin: 0 }}>{a}</p></div>
              </details>
            ))}
          </div>
          <p className="g-fineprint">Still unsure? <a href="/contact.html">Ask us directly →</a></p>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="g-sec g-sec--dark" aria-labelledby="final-title">
        <div className="container-wide" style={{ textAlign: "center", maxWidth: 900 }}>
          <p className="g-num">Ready when you are</p>
          <h2 id="final-title" className="sec-title dark-title" style={{ marginInline: "auto" }}>Let's get you noticed —<br />then chosen.</h2>
          <p className="sec-lede" style={{ marginInline: "auto" }}>One honest call is all it takes to know whether SEAI is right for your business. We'll tell you if it isn't.</p>
          <div className="g-actions" style={{ justifyContent: "center" }}>
            <a className="btn btn-invert btn-lg" href="/contact.html" onClick={(e) => { e.preventDefault(); openCalPopup(); }}>Let's Grow Your Business <span className="arr" aria-hidden="true">→</span></a>
            <a className="btn btn-ghost-dark btn-lg" href="/pricing.html">See pricing</a>
          </div>
        </div>
      </section>
    </SiteChrome>
  );
}
