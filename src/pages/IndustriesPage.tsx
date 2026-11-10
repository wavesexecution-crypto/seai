import SiteChrome from "@/components/site/SiteChrome";

interface Industry {
  id: string; name: string; who: string; channels: string[]; good: string; services: string; demo?: string;
}

const INDUSTRIES: Industry[] = [
  {
    id: "restaurants", name: "Restaurants & Cafés",
    who: "Independent restaurants, cafés, cloud kitchens, QSRs and bakeries that live or die by daily covers and repeat visits.",
    channels: ["Instagram Reels (food-first visuals)", "Geo-targeted Meta ads within delivery/visit radius", "Google Business Profile + Maps presence"],
    good: "Appetising, consistent posting; offers that fill off-peak hours; a Maps profile with fresh photos and prompt review replies; WhatsApp for reservations.",
    services: "Social media management · Local ads · GBP hygiene · Content & offers calendar",
    demo: "/examples/restaurant.html",
  },
  {
    id: "gyms", name: "Gyms & Fitness Studios",
    who: "Independent gyms, boutique studios (yoga/pilates/HIIT), martial arts and personal trainers selling memberships and trials.",
    channels: ["FB/IG lead ads with free-trial offer", "Transformation content & member stories", "Retargeting website visitors & lapsed members"],
    good: "A steady free-trial funnel, visible transformations, community content, fast call-back on enquiries, and a review-rich Google profile.",
    services: "Lead generation · Advertising · Social management · Landing page funnels",
    demo: "/examples/gym.html",
  },
  {
    id: "salons", name: "Salons & Beauty Businesses",
    who: "Hair studios, nail salons, spas, barbershops and makeup artists competing on trust, style and convenience.",
    channels: ["Instagram-first — portfolio grid + Reels", "Booking CTAs everywhere (WhatsApp / forms)", "Seasonal packages & bridal campaigns"],
    good: "A booking flow that takes 20 seconds, appointment gaps filled with offers, and a portfolio that pre-sells the experience.",
    services: "Social media · Website with booking · Local ads · Review management",
    demo: "/examples/salon.html",
  },
  {
    id: "clinics", name: "Clinics & Healthcare Businesses",
    who: "Dental, skin, physiotherapy, fertility, diagnostics and wellness clinics — trust-driven, compliance-aware marketing.",
    channels: ["Google Search — high-intent queries", "Educational content (no exaggerated claims)", "Reviews & credentials front and centre"],
    good: "Credible doctor profiles, patient education content, review velocity, and a booking flow — never cure claims or fear marketing.",
    services: "Search ads · Website · Social content (compliance-safe) · GBP · Lead capture",
    demo: "/examples/clinic.html",
  },
  {
    id: "real-estate", name: "Real Estate",
    who: "Builders, brokers, channel partners and property consultants launching or selling residential and commercial projects.",
    channels: ["FB/IG lead ads + Google Search", "WhatsApp follow-up automation", "Project-specific landing pages"],
    good: "Filtered leads (budget/location/timeline), fast call-backs, and a follow-up cadence — plus project pages that answer real buyer questions.",
    services: "Lead generation · Advertising · Landing pages · Follow-up automation",
    demo: "/examples/real-estate.html",
  },
  {
    id: "retail", name: "Retail Stores",
    who: "Fashion, electronics, home, jewellery, grocery and specialty retail with footfall to grow and stock to move.",
    channels: ["Geo ads within catchment radius", "Festive & launch campaigns (Diwali, Pongal, wedding season)", "Catalogue posts + GBP for local discovery"],
    good: "Store-visit campaigns, festive calendar executed on time, catalogue-driven discovery, and a loyalty/repeat-visit push.",
    services: "Local ads · Social media · Festive campaign execution · GBP",
  },
  {
    id: "ecommerce", name: "E-commerce",
    who: "D2C brands and online sellers (Shopify/Woo/own store) with ROAS targets and stock to move.",
    channels: ["Meta + Google Shopping (feed-based)", "Retargeting stack (viewers → cart → purchase)", "Email/WhatsApp retention flows"],
    good: "Purchase tracking set up correctly, ROAS reported honestly (spend shown separately), feeds clean, creative testing weekly — not one ad forever.",
    services: "Advertising (Meta/Google) · Conversion optimization · Retargeting · Reporting",
  },
  {
    id: "education", name: "Education",
    who: "COACHING centres, schools, colleges, upskilling academies and course creators — admission-cycle businesses.",
    channels: ["Search ads during intake windows", "Open-day & webinar funnels", "Content that answers parent/student doubts"],
    good: "Admission funnels timed to cycles, doubt-clearing content, campus visit bookings, and honest outcome reporting — no fake placement claims.",
    services: "Funnels & landing pages · Search ads · Social content · Lead nurturing",
  },
  {
    id: "professional-services", name: "Professional Services",
    who: "CA firms, lawyers, architects, consultants, agencies and niche B2B experts selling high-trust expertise.",
    channels: ["Authority content (LinkedIn-first)", "Google Search — high-intent local queries", "Case studies & credentials (privacy-safe)"],
    good: "Proof-led positioning, a consultation booking flow, and a steady referral+search pipeline — without fake urgency or invented logos.",
    services: "Growth strategy · Content · Website · Search ads · LinkedIn presence",
  },
  {
    id: "startups", name: "Startups",
    who: "Pre-seed to Series A teams who need to look established, find first customers and learn fast on a budget.",
    channels: ["Lean brand kit + one-pager", "Launch campaign — one offer, one funnel", "Compounding content from day one"],
    good: "Ship fast, brand credible enough to sell, one measurable launch, weekly learning loops — spend tiny, learn fast.",
    services: "Branding & identity · Landing page · Launch ads · Strategy sprints",
  },
];

export default function IndustriesPage() {
  return (
    <SiteChrome active="industries">
      <section className="g-hero" style={{ paddingBottom: 64 }}>
        <div className="container-wide">
          <p className="g-kicker">Industries</p>
          <h1 className="g-wordmark" style={{ fontSize: "clamp(40px, 7vw, 88px)", lineHeight: 1 }}>Same engine.<br />Different fuel.</h1>
          <p className="g-sub">The process never changes; the offer, creative, channels and metrics do. Here's how we approach each industry we serve — and what “good” looks like when we're doing it right.</p>
          <p className="g-note">Demonstration builds (where shown) are capability demos, not client case studies — ask for references in your industry on the discovery call.</p>
        </div>
      </section>
      <section className="g-sec">
        <div className="container-wide">
          <div className="g-ind">
            {INDUSTRIES.map((ind) => (
              <article className="g-ind-card" key={ind.id} id={ind.id}>
                <h3>{ind.name}</h3>
                <p className="who">{ind.who}</p>
                <dl>
                  <div><dt>Primary channels</dt><dd>{ind.channels.join(" · ")}</dd></div>
                  <div><dt>What “good” looks like</dt><dd>{ind.good}</dd></div>
                  <div><dt>Typical engagement</dt><dd>{ind.services}</dd></div>
                </dl>
                {ind.demo
                  ? <a className="demo-link" href={ind.demo}>See demonstration build ↗</a>
                  : <a className="demo-link" href={`/contact.html?industry=${encodeURIComponent(ind.name)}`}>Discuss this industry →</a>}
              </article>
            ))}
          </div>
          <p className="g-fineprint">Don't see your industry? We're selective, not exclusive — <a href="/contact.html">tell us what you do</a> and we'll say honestly whether we can move the needle.</p>
        </div>
      </section>
    </SiteChrome>
  );
}
