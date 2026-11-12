import { useEffect, useRef } from "react";
import SiteChrome from "@/components/site/SiteChrome";
import { SERVICES, SERVICE_NAV } from "../services-data";

const BADGE: Record<string, string> = { available: "Available", proposed: "Proposed — on enquiry", one_time: "One-time + care plan" };

export default function ServicesPage() {
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef<string>("");
  const lastSwitchRef = useRef<number>(0);

  useEffect(() => {
    const nav = navRef.current;
    const links = nav ? Array.from(nav.querySelectorAll<HTMLAnchorElement>("a")) : [];
    const sections = links
      .map((a) => document.getElementById(a.getAttribute("href")?.slice(1) ?? ""))
      .filter(Boolean) as HTMLElement[];
    if (!sections.length || !nav) return;

    const headerOffset = 72;
    const tabbarOffset = 56;
    const topThreshold = headerOffset + tabbarOffset;
    const HYSTERESIS_MS = 180;

    const updateIndicator = () => {
      const ind = indicatorRef.current;
      if (!ind) return;
      const active = nav.querySelector<HTMLAnchorElement>("a.is-active");
      if (!active) { ind.style.opacity = "0"; return; }
      const navRect = nav.getBoundingClientRect();
      const aRect = active.getBoundingClientRect();
      const x = aRect.left - navRect.left + nav.scrollLeft;
      ind.style.transform = `translate3d(${x}px, 0, 0)`;
      ind.style.width = `${aRect.width}px`;
      ind.style.opacity = "1";
    };

    const rafUpdate = () => requestAnimationFrame(updateIndicator);

    const setActive = (id: string) => {
      if (id === currentIdRef.current) return;
      const now = performance.now();
      if (now - lastSwitchRef.current < HYSTERESIS_MS) return;
      lastSwitchRef.current = now;
      currentIdRef.current = id;
      links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${id}`));
      const activeLink = links.find((a) => a.getAttribute("href") === `#${id}`);
      activeLink?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      rafUpdate();
    };

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
      // force switch (bypass hysteresis) on click
      lastSwitchRef.current = 0;
      setActive(href.slice(1));
    };
    nav.addEventListener("click", onClick);

    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        let best: string | null = null;
        let bestTop = Infinity;
        for (const id of visible) {
          const el = document.getElementById(id);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          if (top < bestTop) { bestTop = top; best = id; }
        }
        if (best) { setActive(best); return; }
        // nothing visible: closest section
        let closest: string | null = null;
        let closestDist = Infinity;
        for (const s of sections) {
          const dist = Math.abs(s.getBoundingClientRect().top - topThreshold);
          if (dist < closestDist) { closestDist = dist; closest = s.id; }
        }
        if (closest) setActive(closest);
      },
      { rootMargin: `-${topThreshold}px 0px -45% 0px`, threshold: [0, 0.1, 0.25] },
    );
    sections.forEach((s) => io.observe(s));

    // initial
    currentIdRef.current = "";
    lastSwitchRef.current = 0;
    setActive(sections[0].id);
    rafUpdate();

    const onResize = () => rafUpdate();
    window.addEventListener("resize", onResize);

    return () => {
      io.disconnect();
      nav.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
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

      <nav className="g-svc-nav" aria-label="Jump to a service" ref={navRef}>
        <div className="g-svc-indicator" ref={indicatorRef} aria-hidden="true" />
        {SERVICE_NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
      </nav>

      <div className="container-wide">
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
