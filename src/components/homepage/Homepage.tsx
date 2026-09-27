import { useEffect, useMemo, useState } from "react";
import SocialCards from "@/components/ui/card-fan-carousel";
import {
  RestaurantMark,
  CafeMark,
  GymMark,
  SalonMark,
  ClinicMark,
  RealEstateMark,
  BusinessMark,
} from "@/components/ui/example-icons";

// Minimal index: exact category names only — no brand names, no descriptions.
// The card is the index; the linked demo website provides all detail.
const EXAMPLES = [
  { type: "Restaurant", url: "/examples/restaurant.html", icon: <RestaurantMark /> },
  { type: "Cafe", url: "/examples/cafe.html", icon: <CafeMark /> },
  { type: "Gym", url: "/examples/gym.html", icon: <GymMark /> },
  { type: "Salon", url: "/examples/salon.html", icon: <SalonMark /> },
  { type: "Clinic", url: "/examples/clinic.html", icon: <ClinicMark /> },
  { type: "Real Estate", url: "/examples/real-estate.html", icon: <RealEstateMark /> },
  { type: "Business", url: "/examples/business.html", icon: <BusinessMark /> },
];

const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve",
];

const HOW_STEPS = [
  { num: "01", name: "Tell us about your business", copy: "Answer a short intake form — name, type, what you do, location, contact info, style preferences, and goals. Takes about 5 minutes." },
  { num: "02", name: "SEAI builds your website", copy: "SEAI generates a complete, professional website — design, copy, responsive layout, SEO fundamentals, and integrations — tailored to your business." },
  { num: "03", name: "You review and request changes", copy: "See the full site before it goes live. Request revisions on design, copy, or structure. SEAI iterates until you approve." },
  { num: "04", name: "We put it live", copy: "Connect your domain (or buy one through us). SEAI handles deployment, SSL, and goes live. Ongoing revision support included." },
];

const DELIVERABLES = [
  { name: "Responsive design", desc: "Flawless on mobile, tablet, and desktop. Mobile-first, not mobile-last.", icon: "✦" },
  { name: "Professional copy", desc: "Headlines, descriptions, and calls-to-action written for your business — not placeholder text.", icon: "✦" },
  { name: "Mobile optimization", desc: "Touch-friendly navigation, fast loading, thumb-zone CTAs. More than half your visitors use phones.", icon: "✦" },
  { name: "WhatsApp & contact CTAs", desc: "Click-to-call, click-to-WhatsApp, contact forms — built-in and styled for your brand.", icon: "✦" },
  { name: "SEO fundamentals", desc: "Semantic HTML, meta tags, Open Graph, sitemap, robots.txt, structured data — done correctly.", icon: "✦" },
  { name: "Domain connection", desc: "Use your existing domain or buy one through us. DNS configuration handled.", icon: "✦" },
  { name: "Deployment & SSL", desc: "Global CDN, automatic HTTPS, edge caching. Your site is fast everywhere.", icon: "✦" },
  { name: "Revision support", desc: "Request changes after launch. We don't disappear once the site is live.", icon: "✦" },
];

const PRICING = [
  { tier: "STARTER", price: "₹2,999", per: "one-time", desc: "One-page business website", features: ["Single-page layout", "Responsive design", "Professional copy", "WhatsApp / contact CTA", "SEO fundamentals", "Domain connection", "Deployment & SSL", "2 rounds of revisions"], cta: "Start your website", plan: "starter", featured: false },
  { tier: "BUSINESS", price: "₹4,999", per: "one-time", desc: "Multi-section premium website", features: ["Multi-section layout (5+ sections)", "Responsive design", "Professional copy", "WhatsApp / contact CTA", "SEO fundamentals", "Domain connection", "Deployment & SSL", "4 rounds of revisions", "Blog / news section", "Google Maps integration"], cta: "Start your website", plan: "business", featured: true },
  { tier: "COMPLETE", price: "₹7,999", per: "one-time", desc: "Premium website + copy + SEO + integrations", features: ["Everything in BUSINESS", "Custom copywriting (all pages)", "Full SEO setup & submission", "Integrations (WhatsApp, forms, analytics)", "Domain purchase & setup included", "Priority deployment", "Unlimited revisions (30 days)", "Analytics dashboard setup", "3 months revision support"], cta: "Start your website", plan: "complete", featured: false },
];

const BUSINESS_TYPES = [
  { name: "Restaurants", desc: "Menu, reservations, location, hours", url: "/examples/restaurant.html" },
  { name: "Gyms & Studios", desc: "Schedules, trainers, memberships", url: "/examples/gym.html" },
  { name: "Salons & Spas", desc: "Services, booking, gallery, team", url: "/examples/salon.html" },
  { name: "Clinics", desc: "Services, providers, patient portal, insurance", url: "/examples/clinic.html" },
  { name: "Consultants", desc: "Case studies, insights, contact, authority", url: "/examples/business.html" },
  { name: "Agencies", desc: "Portfolio, team, services, inquiry", url: "/examples/business.html" },
  { name: "Real Estate", desc: "Listings, agents, calculator, areas", url: "/examples/real-estate.html" },
  { name: "Local Services", desc: "Emergency CTA, areas, reviews, call now", url: "/examples/clinic.html" },
];

const FAQS = [
  { q: "How long does it take?", a: "Most websites are delivered within 5–7 business days after the intake form is submitted. Complex projects may take up to 14 days. You'll see a preview before anything goes live." },
  { q: "Can I request changes?", a: "Yes. Every plan includes revision rounds (2 for STARTER, 4 for BUSINESS, unlimited for 30 days on COMPLETE). You review the full site before launch and request changes on design, copy, or structure." },
  { q: "Can I use my own domain?", a: "Absolutely. Connect an existing domain (we guide you through DNS) or purchase one through us with the COMPLETE plan. SSL and deployment are handled automatically." },
  { q: "Do you provide the copy?", a: "Yes. Professional copy is included in every tier — headlines, descriptions, service text, and CTAs written for your business. COMPLETE adds custom copywriting for all pages." },
  { q: "Will it work on mobile?", a: "Mobile-first is our default. Every SEAI website is fully responsive, touch-friendly, and optimized for thumb-zone navigation. More than half your visitors use phones — we design for them first." },
  { q: "Can I connect WhatsApp?", a: "Yes. Click-to-WhatsApp, click-to-call, and contact forms are built into every site. They're styled to match your brand and placed for maximum conversion." },
  { q: "What happens after I pay?", a: "You'll receive a confirmation and your project enters our build queue. We'll send the first preview within the delivery window. You review, request changes if needed, approve, and we deploy. Simple." },
  { q: "Is there a monthly fee?", a: "No. SEAI is a one-time payment. No subscriptions, no recurring charges. Revision support periods are included as noted per tier (30 days for STARTER/BUSINESS, 90 days for COMPLETE)." },
  { q: "What if I need changes later?", a: "Revision support is included. After the included period, you can request changes at a per-update rate. We don't disappear once the site is live — your business evolves, your website should too." },
];

function Homepage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [faqOpen, setFaqOpen] = useState<Set<number>>(new Set());

  // Gate reveal styles on JS availability (matches legacy main.js behaviour)
  useEffect(() => {
    document.documentElement.classList.add("js");
  }, []);

  // Keep the legacy `body.menu-open` contract so responsive.css shows the mobile nav,
  // lock scroll while open, and close on Escape / desktop resize.
  useEffect(() => {
    document.body.classList.toggle("menu-open", mobileMenuOpen);
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 980) setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // Header scrolled state
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Reveal on scroll via IntersectionObserver (adds `.in`, like legacy main.js)
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "80px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Smooth scroll for anchor links
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLAnchorElement;
      if (target.tagName === "A" && target.getAttribute("href")?.startsWith("#")) {
        const href = target.getAttribute("href");
        if (href && href !== "#") {
          const targetEl = document.querySelector(href);
          if (targetEl) {
            e.preventDefault();
            const headerOffset = 80;
            const elementPosition = targetEl.getBoundingClientRect().top + window.scrollY;
            const offsetPosition = elementPosition - headerOffset;
            window.scrollTo({ top: offsetPosition, behavior: "smooth" });
          }
        }
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Restore an incoming deep link, e.g. /index.html#pricing from the intake
  // page navbar. The browser only honours a hash during initial HTML parsing,
  // but this page is client-rendered, so the target section does not exist yet
  // and the browser silently stays at the top. Re-apply it once mounted.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash === "#") return;

    const jump = () => {
      const targetEl = document.querySelector(hash);
      if (!targetEl) return;
      const headerOffset = 80;
      const top = targetEl.getBoundingClientRect().top + window.scrollY - headerOffset;
      // base.css sets `scroll-behavior: smooth`; a load-time jump across the
      // whole page should be instant, not a long animation.
      const root = document.documentElement;
      const prev = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo({ top, behavior: "auto" });
      root.style.scrollBehavior = prev;
    };

    jump();
    // The example fan carousel settles its layout after mount; retry once so
    // late layout shifts do not leave the scroll position short of the target.
    const t = window.setTimeout(jump, 350);
    window.addEventListener("load", jump, { once: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("load", jump);
    };
  }, []);

  // Footer year
  useEffect(() => {
    document.querySelectorAll(".year").forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });
  }, []);

  // Example cards for the index grid — exact category names, real demo routes.
  // Memoized so the grid's identity is stable across parent re-renders
  // (scroll state, FAQ toggles, menu).
  const exampleCards = useMemo(
    () =>
      EXAMPLES.map((ex) => ({
        imgUrl: "",
        title: ex.type,
        alt: `${ex.type} website example`,
        linkUrl: ex.url,
        icon: ex.icon,
      })),
    []
  );

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>

      <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
        <div className="header-in">
          <a className="brand" href="/" aria-label="SEAI — home">
            <img src="/logo.svg" width="26" height="26" alt="" />
            <span>SEAI</span>
          </a>
          <nav className="nav" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#examples">Examples</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="header-actions">
            <a className="btn btn-dark" href="/intake.html">Build my website <span className="arr" aria-hidden="true">→</span></a>
          </div>
          <button className="menu-btn" type="button" aria-label={mobileMenuOpen ? "Close menu" : "Open menu"} aria-expanded={mobileMenuOpen} aria-controls="mobile-nav" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <span></span><span></span>
          </button>
        </div>
        <nav className="mobile-nav" id="mobile-nav" aria-label="Mobile">
          <a href="#how" onClick={() => setMobileMenuOpen(false)}>How it works</a>
          <a href="#examples" onClick={() => setMobileMenuOpen(false)}>Examples</a>
          <a href="#pricing" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
          <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
          <span className="m-sep" aria-hidden="true"></span>
          <a className="btn btn-dark m-cta" href="/intake.html">Build my website <span className="arr" aria-hidden="true">→</span></a>
        </nav>
      </header>

      <main id="main">

        {/* HERO */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="hero-eyebrow">AI-built websites for real businesses</p>
            <h1 id="hero-title" className="hero-title reveal" data-reveal-id="hero-title">YOUR BUSINESS.<br />A BETTER WEBSITE.</h1>
            <p className="hero-sub reveal" data-reveal-id="hero-sub">SEAI builds premium business websites from a simple description of what you do.</p>
            <div className="hero-actions reveal" data-reveal-id="hero-actions">
              <a className="btn btn-dark btn-lg" href="/intake.html">Build my website <span className="arr" aria-hidden="true">→</span></a>
              <a className="btn btn-ghost btn-lg" href="#examples">See examples</a>
            </div>
          </div>
          <div className="hero-preview" aria-label="Website examples preview">
            <div className="preview-grid" id="preview-grid">
              {EXAMPLES.map((ex) => (
                <div key={ex.type} className="preview-item">
                  <div className="preview-thumb"></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* EXAMPLES / PROOF - Fan Carousel */}
        <section className="examples" id="examples" aria-labelledby="examples-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="examples-eyebrow">01 — Proof</p>
            <h2 id="examples-title" className="sec-title reveal" data-reveal-id="examples-title">Websites people actually pay for.</h2>
            <p className="sec-lede reveal" data-reveal-id="examples-lede">{`${NUMBER_WORDS[EXAMPLES.length] ?? EXAMPLES.length} business types. Tap any card to open the real demo website.`}</p>
            <SocialCards cards={exampleCards} />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="how" id="how" aria-labelledby="how-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="how-eyebrow">02 — How it works</p>
            <h2 id="how-title" className="sec-title reveal" data-reveal-id="how-title">From description to live website in four steps.</h2>
            <p className="sec-lede reveal" data-reveal-id="how-lede">No dashboards to learn. No templates to customize. Four steps and your website is live.</p>
            <ol className="how-grid">
              {HOW_STEPS.map((step, i) => (
                <li key={step.num} className="how-card reveal" data-reveal-id={`how-${step.num}`} style={{ transitionDelay: `${i * 60}ms` }}>
                  <span className="how-num">{step.num}</span>
                  <h3 className="how-name">{step.name}</h3>
                  <p className="how-copy">{step.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* WHAT YOU GET */}
        <section className="deliverables" id="deliverables" aria-labelledby="deliverables-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="deliverables-eyebrow">03 — What you get</p>
            <h2 id="deliverables-title" className="sec-title reveal" data-reveal-id="deliverables-title">A complete, professional website — not a template.</h2>
            <p className="sec-lede reveal" data-reveal-id="deliverables-lede">Every SEAI website includes the fundamentals that make a business look established and trustworthy.</p>
            <ul className="deliverables-grid">
              {DELIVERABLES.map((item, i) => (
                <li key={item.name} className="deliverable reveal" data-reveal-id={`deliverable-${i}`} style={{ transitionDelay: `${i * 40}ms` }}>
                  <span className="deliverable-icon" aria-hidden="true">{item.icon}</span>
                  <h3 className="deliverable-name">{item.name}</h3>
                  <p className="deliverable-desc">{item.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* PRICING */}
        <section className="pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="pricing-eyebrow">04 — Pricing</p>
            <h2 id="pricing-title" className="sec-title reveal" data-reveal-id="pricing-title">Simple, transparent pricing.</h2>
            <p className="sec-lede reveal" data-reveal-id="pricing-lede">One-time payment. No monthly fees. No hidden costs. Choose the tier that fits your business.</p>
            <div className="price-grid">
              {PRICING.map((plan, i) => (
                <article key={plan.tier} className={`price-card reveal ${plan.featured ? "price-feat" : ""}`} data-reveal-id={`price-${plan.tier}`} style={{ transitionDelay: `${i * 60}ms` }}>
                  {plan.featured && <span className="price-badge">Most popular</span>}
                  <p className="price-tier">{plan.tier}</p>
                  <p className="price-tag">{plan.price} <span className="price-per">{plan.per}</span></p>
                  <p className="price-desc">{plan.desc}</p>
                  <ul className="price-feats">
                    {plan.features.map((feat, fi) => (
                      <li key={fi}>{feat}</li>
                    ))}
                  </ul>
                  <a className={`btn ${plan.featured ? "btn-dark" : "btn-ghost"} price-cta`} href={`/intake.html?plan=${plan.plan}`}>{plan.cta}</a>
                </article>
              ))}
            </div>
            <p className="price-note">One-time payment. No subscriptions. No monthly fees. Revision periods as noted above.</p>
          </div>
        </section>

        {/* BEFORE / AFTER */}
        <section className="before-after" id="before-after" aria-labelledby="ba-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="ba-eyebrow">05 — Before & After</p>
            <h2 id="ba-title" className="sec-title reveal" data-reveal-id="ba-title">The difference a professional website makes.</h2>
            <p className="sec-lede reveal" data-reveal-id="ba-lede">No proper web presence versus a professional SEAI website.</p>
            <div className="ba-grid">
              <div className="ba-col reveal" data-reveal-id="ba-before">
                <p className="ba-label">Before</p>
                <div className="ba-card ba-before">
                  <div className="ba-visual">
                    <svg className="ba-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h4M9 15h2"/></svg>
                  </div>
                  <h3 className="ba-name">No website</h3>
                  <ul className="ba-list">
                    <li>Customers can't find you</li>
                    <li>No credibility or trust</li>
                    <li>Losing to competitors</li>
                    <li>No way to book or contact</li>
                    <li>Invisible on Google</li>
                  </ul>
                </div>
              </div>
              <div className="ba-arrow" aria-hidden="true">→</div>
              <div className="ba-col reveal" data-reveal-id="ba-after">
                <p className="ba-label">After</p>
                <div className="ba-card ba-after">
                  <div className="ba-visual">
                    <svg className="ba-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/><path d="M16 5l3 3-3 3"/></svg>
                  </div>
                  <h3 className="ba-name">SEAI website</h3>
                  <ul className="ba-list">
                    <li>Professional web presence</li>
                    <li>Builds trust instantly</li>
                    <li>Stands out from competitors</li>
                    <li>Clear CTAs: call, WhatsApp, book</li>
                    <li>Searchable on Google</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* BUSINESS TYPES */}
        <section className="business-types" id="business-types" aria-labelledby="bt-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="bt-eyebrow">06 — Business types</p>
            <h2 id="bt-title" className="sec-title reveal" data-reveal-id="bt-title">SEAI works for any local business.</h2>
            <p className="sec-lede reveal" data-reveal-id="bt-lede">Different industries need different structures. SEAI adapts the layout, copy, and features to your business type.</p>
            <ul className="bt-grid" id="bt-grid">
              {BUSINESS_TYPES.map((bt, i) => (
                <li key={bt.name} className="bt-card reveal" data-reveal-id={`bt-${i}`} style={{ transitionDelay: `${i * 40}ms` }}>
                  <a href={bt.url} className="bt-link">
                    <h3 className="bt-name">{bt.name}</h3>
                    <p className="bt-desc">{bt.desc}</p>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="faq" id="faq" aria-labelledby="faq-title">
          <div className="container">
            <p className="eyebrow reveal" data-reveal-id="faq-eyebrow">07 — FAQ</p>
            <h2 id="faq-title" className="sec-title reveal" data-reveal-id="faq-title">Questions, answered directly.</h2>
            <div className="faq-list" id="faq-list">
              {FAQS.map((faq, i) => (
                <article key={i} className={`faq-item reveal ${faqOpen.has(i) ? "open" : ""}`} data-reveal-id={`faq-${i}`} style={{ transitionDelay: `${i * 40}ms` }}>
                  <h3 className="faq-q">
                    <button type="button" aria-expanded={faqOpen.has(i)} onClick={() => setFaqOpen(prev => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })}>
                      <span>{faq.q}</span>
                      <span className="faq-x" aria-hidden="true"></span>
                    </button>
                  </h3>
                  <div className="faq-a"><p>{faq.a}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="final" aria-labelledby="final-title">
          <div className="final-bg" aria-hidden="true"></div>
          <div className="container">
            <h2 id="final-title" className="final-title reveal" data-reveal-id="final-title">YOUR BUSINESS IS ALREADY REAL.<br />YOUR WEBSITE SHOULD LOOK LIKE IT.</h2>
            <div className="final-actions reveal" data-reveal-id="final-actions">
              <a className="btn btn-invert btn-lg" href="/intake.html">Build my website <span className="arr" aria-hidden="true">→</span></a>
            </div>
            <p className="final-note reveal" data-reveal-id="final-note">SEAI · AI-built websites for real businesses</p>
          </div>
        </section>

      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="foot-left">
            <p className="footer-brand"><img src="/logo.svg" width="22" height="22" alt="" /><span>SEAI</span></p>
            <p className="footer-tag">Website building, simplified.</p>
          </div>
          <nav className="footer-nav" aria-label="Footer">
            <a href="#examples">Examples</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href="/terms.html">Terms</a>
            <a href="/privacy.html">Privacy</a>
            <a href="mailto:hello@seai.store">Contact</a>
          </nav>
        </div>
        <div className="container fit-bottom">
          <p className="copyright">© <span className="year">2026</span> SEAI. All rights reserved.</p>
        </div>
      </footer>
    </>
  );
}

export default Homepage;