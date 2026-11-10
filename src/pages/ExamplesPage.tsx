import { useState, useMemo } from "react";
import SiteChrome from "@/components/site/SiteChrome";

// Demonstration builds — capability showcases, NOT client work or results.
const EXAMPLES_DATA = [
  { id: "restaurant", name: "Restaurant", category: "Food & Hospitality", description: "Menu, reservations, location, hours — everything a diner needs to book a table.", url: "/examples/restaurant.html", tags: ["Menu", "Reservations", "Location", "Hours"] },
  { id: "cafe", name: "Cafe", category: "Food & Hospitality", description: "Coffee menu, daily specials, loyalty program, and a cozy vibe that converts walk-ins to regulars.", url: "/examples/cafe.html", tags: ["Menu", "Loyalty", "Daily Specials", "Atmosphere"] },
  { id: "gym", name: "Gym & Studio", category: "Health & Fitness", description: "Class schedules, trainer bios, membership tiers, and online booking that fills classes.", url: "/examples/gym.html", tags: ["Schedules", "Trainers", "Memberships", "Booking"] },
  { id: "salon", name: "Salon & Spa", category: "Beauty & Wellness", description: "Service menu, team bios, gallery, online booking, and loyalty rewards that keep chairs full.", url: "/examples/salon.html", tags: ["Services", "Booking", "Gallery", "Team"] },
  { id: "clinic", name: "Clinic", category: "Healthcare", description: "Services, providers, patient information, and online appointment booking.", url: "/examples/clinic.html", tags: ["Services", "Providers", "Appointments", "Insurance"] },
  { id: "real-estate", name: "Real Estate", category: "Professional Services", description: "Property listings, agent profiles, mortgage calculator, area guides, and enquiry forms.", url: "/examples/real-estate.html", tags: ["Listings", "Agents", "Calculator", "Areas"] },
  { id: "business", name: "Business & Consulting", category: "Professional Services", description: "Case studies, insights, team bios, services, and enquiry forms.", url: "/examples/business.html", tags: ["Case Studies", "Team", "Services", "Enquiry"] },
];

const CATEGORIES = ["All", "Food & Hospitality", "Health & Fitness", "Beauty & Wellness", "Healthcare", "Professional Services"];

export default function ExamplesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const filteredExamples = useMemo(() => {
    return EXAMPLES_DATA.filter((ex) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || ex.name.toLowerCase().includes(q) || ex.description.toLowerCase().includes(q) || ex.tags.some((t) => t.toLowerCase().includes(q));
      const matchesCategory = selectedCategory === "All" || ex.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <SiteChrome>
      <section className="g-hero" style={{ paddingBottom: 56 }}>
        <div className="container-wide">
          <p className="g-kicker">Demonstrations</p>
          <h1 className="g-wordmark" style={{ fontSize: "clamp(36px, 6vw, 72px)", lineHeight: 1.04 }}>See the standard<br />we build to.</h1>
          <p className="g-sub">Demonstration builds across industries — capability showcases we designed ourselves, not client work and not borrowed results. Ask for references in your industry on your discovery call.</p>
        </div>
      </section>
      <section className="g-sec">
        <div className="container-wide">
          <div className="g-svc-nav" style={{ marginTop: 0 }}>
            {CATEGORIES.map((cat) => (
              <button key={cat} type="button" className={selectedCategory === cat ? "is-active" : undefined} onClick={() => setSelectedCategory(cat)} aria-pressed={selectedCategory === cat}>{cat}</button>
            ))}
          </div>
          <div className="g-field" style={{ maxWidth: 420, margin: "12px 0 18px" }}>
            <label htmlFor="search-examples">Search demonstrations</label>
            <input id="search-examples" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Restaurant, booking, gym…" autoComplete="off" />
          </div>
          <div className="g-grid">
            {filteredExamples.map((ex) => (
              <article className="g-card" key={ex.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p className="g-num">{ex.category}</p>
                <h3 style={{ fontSize: 20 }}>{ex.name}</h3>
                <p>{ex.description}</p>
                <p style={{ fontSize: 12, color: "#64748b" }}>{ex.tags.join(" · ")}</p>
                <a className="demo-link" href={ex.url} style={{ marginTop: "auto" }}>Open demonstration build ↗</a>
              </article>
            ))}
            {filteredExamples.length === 0 && <p className="muted">Nothing matches. Try another search or category.</p>}
          </div>
          <p className="g-fineprint">Want a build like this for your business? <a href="/contact.html">Talk to SEAI →</a></p>
        </div>
      </section>
    </SiteChrome>
  );
}
