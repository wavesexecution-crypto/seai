import { useEffect } from "react";
import SiteChrome from "@/components/site/SiteChrome";
import { SERVICES, SERVICE_NAV } from "../services-data";

const BADGE: Record<string, string> = { available: "Available", proposed: "Proposed — on enquiry", one_time: "One-time + care plan" };

export default function ServicesPage() {
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".g-svc-nav a"));
    const sections = links
      .map((a) => document.getElementById(a.getAttribute("href")?.slice(1) ?? ""))
      .filter(Boolean) as HTMLElement[];
    if (!sections.length) return;

    const headerOffset = 72; // navbar height
    const tabbarOffset = 64; // sticky service nav height
    const topThreshold = headerOffset + tabbarOffset;

    const setActive = (id: string) => {
      links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`));
      // Keep active tab visible horizontally on mobile
      const activeLink = links.find((a) => a.getAttribute("href") === `#${id}`);
      activeLink?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    };

    // Smooth scroll on tab click
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("#")) return;
      e.preventDefault();
      const target = document.getElementById(href.slice(1));
      if (!target) return;
      const y = target.getBoundingClientRect().top + window.scrollY - (topThreshold + 8);
      window.scrollTo({ top: y, behavior: "smooth" });
      setActive(href.slice(1));
    };
    const nav = document.querySelector<HTMLElement>(".g-svc-nav");
    nav?.addEventListener("click", onClick);

    // IntersectionObserver scroll-spy
    let currentId = sections[0].id;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        // Pick the topmost visible section
        let best: string | null = null;
        let bestTop = Infinity;
        for (const id of visible.keys()) {
          const el = document.getElementById(id);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          if (top < bestTop) { bestTop = top; best = id; }
        }
        if (best && best !== currentId) { currentId = best; setActive(best); }
        // Fallback: if nothing visible, use closest section above threshold
        if (!best) {
          let closest: string | null = null;
          let closestDist = Infinity;
          for (const s of sections) {
            const top = s.getBoundingClientRect().top - topThreshold;
            const dist = Math.abs(top);
            if (dist < closestDist) { closestDist = dist; closest = s.id; }
          }
          if (closest && closest !== currentId) { currentId = closest; setActive(closest); }
        }
      },
      { rootMargin: `-${topThreshold}px 0px -40% 0px`, threshold: [0, 0.25, 0.5] },
    );
    sections.forEach((s) => io.observe(s));

    // Initial active
    setActive(sections[0].id);

    return () => {
      io.disconnect();
      nav?.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <SiteChrome active="services">
      <section className="g-hero" style={{ paddingBottom: 64 }}>
        <div className="container-wide">
          <p className="g-kicker">Services</p>
          <h1 className="g-wordmark" style={{ fontSize: "clamp(44px, 8vw, 96px)", lineHeight: 1 }}>What we<br />fix & build.</h1>
          <p className="g-sub">Seven services, one integrated growth engine. Each section below tells you exactly what it is, who it's for, what you get, what we need from you, and how we measure it — no vague packages, no surprises.</p>
          <p className="g-note">Advertising budgets are always separate from our fees and paid by you directly to the platforms. No guaranteed leads — ever.</p>
        </div>
      </section>

      <div className="container-wide">
        <nav className="g-svc-nav" aria-label="Jump to a service">
          {SERVICE_NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
        </nav>

        {SERVICES.map((s) => (
          <article className="g-service" id={s.id} key={s.id}>
            <div className="g-svc-head">
              <div>
                <p className="g-num">Service</p>
                <h2>{s.name}</h2>
                <p className="sec-lede" style={{ marginTop: 8 }}>{s.summary}</p>
              </div>
              <span className="g-tag">{BADGE[s.available]}</span>
            </div>

            <div className="g-cols">
              <div className="g-block">
                <h4>What it does</h4>
                <p>{s.what}</p>
              </div>
              <div className="g-block">
                <h4>Who needs it</h4>
                <p>{s.who}</p>
              </div>
              <div className="g-block">
                <h4>What SEAI delivers</h4>
                <ul>{s.delivers.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
              <div className="g-block">
                <h4>How execution works</h4>
                <ol style={{ margin: 0, paddingLeft: 18 }}>{s.execution.map((d) => <li key={d}>{d}</li>)}</ol>
              </div>
              <div className="g-block">
                <h4>What we require from you</h4>
                <ul>{s.requires.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
              <div className="g-block">
                <h4>What you receive</h4>
                <ul>{s.receives.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            </div>

            <div className="g-cols" style={{ marginTop: 14 }}>
              <div className="g-block">
                <h4>How performance is measured</h4>
                <p>{s.measured}</p>
              </div>
              <div className="g-block">
                <h4>Request this service</h4>
                <p>Tell us where you are and what you want — we'll scope it honestly, including whether this is the right service for you right now.</p>
                <div className="g-cta-row">
                  <a className="btn btn-primary" href={`/contact.html?service=${encodeURIComponent(s.ctaSubject)}`}>Request {s.name.split("—")[0].trim()} <span className="arr" aria-hidden="true">→</span></a>
                </div>
                <p className="g-fineprint">Proposals within 3 working days · ad budget separate · approval required before launch.</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <section className="g-sec g-sec--dark" aria-labelledby="custom-title">
        <div className="container-wide" style={{ textAlign: "center" }}>
          <h2 id="custom-title" className="sec-title dark-title" style={{ marginInline: "auto" }}>Need a mix of services?</h2>
          <p className="sec-lede" style={{ marginInline: "auto" }}>Most engagements blend services — e.g. social + advertising + a landing page. We scope from your goal, not from a menu, and always quote the fee (and ad budget) separately, in writing.</p>
          <div className="g-actions" style={{ justifyContent: "center" }}>
            <a className="btn btn-invert btn-lg" href="/contact.html">Request a custom proposal <span className="arr" aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>
    </SiteChrome>
  );
}
