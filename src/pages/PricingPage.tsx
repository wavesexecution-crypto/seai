import SiteChrome from "@/components/site/SiteChrome";
import { RETAINER_PLANS, NOT_INCLUDED, NO_GUARANTEES } from "../pricing-plans";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function PricingPage() {
  return (
    <SiteChrome active="pricing">
      <section className="g-hero" style={{ paddingBottom: 64 }}>
        <div className="container-wide">
          <p className="g-kicker">Pricing — Monthly Retainers</p>
          <h1 className="g-wordmark" style={{ fontSize: "clamp(40px, 7vw, 84px)", lineHeight: 1.04 }}>Exposure,<br />on retainer.</h1>
          <p className="g-sub">Month-to-month service plans — pause or cancel with 15 days' written notice, earn it every month. Proposed starting prices below; your final scope and fee are always agreed in writing before work begins.</p>
          <p className="g-note">Advertising spend is never part of SEAI fees — you pay platforms directly and see every rupee. GST extra where applicable.</p>
        </div>
      </section>

      {/* Retainer plans */}
      <section className="g-sec" aria-labelledby="plans-title">
        <div className="container-wide">
          <p className="g-num">01 — Monthly plans (proposed)</p>
          <h2 id="plans-title" className="sec-title">Pick the pace, we'll run the race.</h2>
          <div className="g-price-grid" style={{ marginTop: 30 }}>
            {RETAINER_PLANS.map((p) => (
              <article key={p.key} className={`g-price ${p.featured ? "featured" : ""}`}>
                <h3>{p.name}</h3>
                <p className="amount">{inr(p.monthlyFeeInr)} <small>/ month</small></p>
                <p style={{ color: "#475569", fontStyle: "italic", margin: 0 }}>{p.tagline}</p>
                <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>{p.idealFor}</p>
                <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                <a className="btn btn-primary" href={`/contact.html?service=Retainer — ${p.name}`} style={{ marginTop: "auto", justifyContent: "center" }}>Talk about {p.name} <span className="arr" aria-hidden="true">→</span></a>
              </article>
            ))}
          </div>
          <p className="g-fineprint">Proposed starting prices — validated against your actual scope in the proposal. Custom agreements (multi-location, e-commerce, franchise) are quoted on enquiry. Website builds and branding projects are one-time, quoted per scope — they are not hidden in retainers.</p>
        </div>
      </section>

      {/* Separation of money */}
      <section className="g-sec g-sec--alt" aria-labelledby="money-title">
        <div className="container-wide">
          <p className="g-num">02 — Where your money goes</p>
          <h2 id="money-title" className="sec-title">Four buckets. Zero mixing.</h2>
          <div className="g-grid" style={{ marginTop: 26 }}>
            <div className="g-card"><p className="g-num">Bucket A</p><h3>SEAI service fee</h3><p>Our monthly retainer (above) or one-time project quote. This is SEAI's revenue — GST extra where applicable.</p></div>
            <div className="g-card"><p className="g-num">Bucket B</p><h3>Advertising budget</h3><p>Paid by you directly to Meta / Google / YouTube. We recommend, allocate and optimise — we never mark it up or touch it.</p></div>
            <div className="g-card"><p className="g-num">Bucket C</p><h3>Third-party costs</h3><p>CRM, review tools, scheduling, premium plugins — at cost, with your approval, always on your accounts.</p></div>
            <div className="g-card"><p className="g-num">Bucket D</p><h3>Extras & one-time</h3><p>Websites, branding, extra campaigns — written change requests or separate quotes. Never silently absorbed.</p></div>
          </div>

          <div style={{ marginTop: 34 }}>
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Not included in any retainer</h3>
            <ul style={{ color: "#33415c", fontSize: 14, lineHeight: 1.8, paddingLeft: 20 }}>
              {NOT_INCLUDED.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* What you always get / never get */}
      <section className="g-sec" aria-labelledby="terms-title">
        <div className="container-wide">
          <p className="g-num">03 — The fine print (in plain words)</p>
          <h2 id="terms-title" className="sec-title">Honest terms.</h2>
          <div className="g-grid" style={{ marginTop: 24 }}>
            <div className="g-card"><h3>You always get</h3><ul style={{ paddingLeft: 18, margin: 0, color: "#33415c", fontSize: 14, lineHeight: 1.8 }}><li>Scope of Work with counts — posts, campaigns, pages, reports</li><li>Approval before launch — creatives, campaigns, calendars</li><li>Monthly delivered-vs-scope section in every report</li><li>15-day notice exit — work completes through the paid period</li><li>Your domain, ad accounts, data & assets — always yours</li></ul></div>
            <div className="g-card"><h3>You never get</h3><ul style={{ paddingLeft: 18, margin: 0, color: "#33415c", fontSize: 14, lineHeight: 1.8 }}><li>Guaranteed leads, sales or impressions — ever</li><li>Ad spend hidden inside "packages"</li><li>Lock-in contracts beyond the paid period</li><li>Reports you can't read</li><li>Surprise line items — everything is written</li></ul></div>
          </div>
          <p className="g-fineprint" style={{ marginTop: 16 }}>{NO_GUARANTEES}</p>
        </div>
      </section>

      {/* Custom proposal CTA */}
      <section className="g-sec g-sec--dark" aria-labelledby="custom-title">
        <div className="container-wide" style={{ textAlign: "center" }}>
          <p className="g-num">04 — Custom</p>
          <h2 id="custom-title" className="sec-title dark-title" style={{ marginInline: "auto" }}>Not a fit for the boxes?</h2>
          <p className="sec-lede" style={{ marginInline: "auto" }}>Multi-location, e-commerce launches, franchise roll-outs, one-time projects — tell us the goal; we'll send a written proposal with fee, ad budget and timelines separated, always.</p>
          <div className="g-actions" style={{ justifyContent: "center" }}>
            <a className="btn btn-invert btn-lg" href="/contact.html">Request a custom proposal <span className="arr" aria-hidden="true">→</span></a>
            <a className="btn btn-ghost-dark btn-lg" href="/services.html">Explore services</a>
          </div>
        </div>
      </section>
    </SiteChrome>
  );
}
