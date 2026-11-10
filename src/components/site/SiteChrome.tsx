import { useEffect, useState, type ReactNode } from "react";

/**
 * Shared site chrome for the repositioned SEAI marketing pages.
 * Links resolve to real pages only — no placeholders, no dead ends.
 */
export default function SiteChrome({ active, children }: { active?: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("menu-open"); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  useEffect(() => {
    document.querySelectorAll(".year").forEach((el) => { el.textContent = String(new Date().getFullYear()); });
  }, []);

  const nav = [
    { id: "services", label: "Services", href: "/services.html" },
    { id: "industries", label: "Industries", href: "/industries.html" },
    { id: "pricing", label: "Pricing", href: "/pricing.html" },
    { id: "contact", label: "Contact", href: "/contact.html" },
  ];

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
            {nav.map((n) => (
              <a key={n.id} href={n.href} aria-current={active === n.id ? "page" : undefined} style={active === n.id ? { color: "#fff", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 6 } : undefined}>{n.label}</a>
            ))}
          </nav>
          <div className="header-actions">
            <a className="btn btn-primary nav-cta" href="/contact.html">Let's Grow Your Business <span className="arr" aria-hidden="true">→</span></a>
          </div>
          <button className="menu-btn" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen(!menuOpen)}>
            <span></span><span></span>
          </button>
        </div>
      </header>

      <nav className="mobile-nav" id="mobile-nav" aria-label="Mobile">
        {nav.map((n) => (
          <a key={n.id} href={n.href} onClick={() => setMenuOpen(false)}>{n.label}</a>
        ))}
        <a className="btn-primary m-cta" href="/contact.html" onClick={() => setMenuOpen(false)}>Let's Grow Your Business <span className="arr" aria-hidden="true">→</span></a>
      </nav>

      <main id="main">{children}</main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="foot-left">
              <p className="footer-brand"><img src="/logo.svg" width="22" height="22" alt="" /><span>SEAI</span></p>
              <p className="footer-tag">Get Exposed. But in a Good Way.<br />Marketing, advertising and growth for businesses of every size.</p>
            </div>
            <nav className="footer-col" aria-label="Services">
              <h4 className="footer-heading">Services</h4>
              <ul className="footer-links">
                <li><a href="/services.html#branding">Branding &amp; Identity</a></li>
                <li><a href="/services.html#advertising">Advertising</a></li>
                <li><a href="/services.html#social">Digital Marketing</a></li>
                <li><a href="/services.html#website">Website Development</a></li>
                <li><a href="/services.html#lead-generation">Lead Generation</a></li>
                <li><a href="/services.html#sales-automation">Sales &amp; Automation</a></li>
                <li><a href="/services.html#growth-strategy">Growth Strategy</a></li>
              </ul>
            </nav>
            <nav className="footer-col" aria-label="Company">
              <h4 className="footer-heading">Company</h4>
              <ul className="footer-links">
                <li><a href="/industries.html">Industries</a></li>
                <li><a href="/pricing.html">Pricing</a></li>
                <li><a href="/contact.html">Contact</a></li>
                <li><a href="mailto:workwithseai@gmail.com">workwithseai@gmail.com</a></li>
              </ul>
            </nav>
            <nav className="footer-col" aria-label="Legal">
              <h4 className="footer-heading">Legal</h4>
              <ul className="footer-links">
                <li><a href="/terms.html">Terms</a></li>
                <li><a href="/privacy.html">Privacy</a></li>
              </ul>
            </nav>
          </div>
        </div>
        <div className="container fit-bottom">
          <p className="copyright">© <span className="year">2026</span> SEAI. All rights reserved. · Advertising spend is always client-funded and billed separately from service fees. No guaranteed leads, ever.</p>
        </div>
      </footer>
    </>
  );
}
