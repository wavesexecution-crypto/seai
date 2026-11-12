import { useEffect, useMemo, useState, type FormEvent } from "react";
import SiteChrome from "@/components/site/SiteChrome";
import CalComScheduler from "@/components/ui/calcom";
import CustomSelect from "@/components/ui/select";

const isLocal = /(^|\.)localhost$|^127\.0\.0\.1$/.test(window.location.hostname);
const API = isLocal ? "http://localhost:3000/api/growth/inquiry" : "https://dash.seai.store/api/growth/inquiry";

const SERVICE_OPTIONS = [
  { key: "branding", label: "Branding & Identity" },
  { key: "advertising", label: "Advertising (Meta / Google / YouTube)" },
  { key: "social", label: "Digital Marketing / Social" },
  { key: "website", label: "Website Development" },
  { key: "lead_gen", label: "Lead Generation" },
  { key: "automation", label: "Sales & Automation" },
  { key: "growth", label: "Growth Strategy & Audits" },
];
const BUDGETS = ["Under ₹10,000", "₹10,000 – ₹25,000", "₹25,000 – ₹50,000", "₹50,000 – ₹1,00,000", "Over ₹1,00,000", "Not sure yet"];
const AD_BUDGETS = ["₹0 — not running ads", "Under ₹10,000", "₹10,000 – ₹25,000", "₹25,000 – ₹50,000", "₹50,000 – ₹1,00,000", "Over ₹1,00,000"];
const OBJECTIVES = ["More footfall / calls", "More leads & enquiries", "More online sales", "Brand awareness", "Launch a new offering", "Fix what's not working", "Other"];
const INDUSTRIES = ["Restaurants & Cafés", "Gyms & Fitness", "Salons & Beauty", "Clinics & Healthcare", "Real Estate", "Retail", "E-commerce", "Education", "Professional Services", "Startups", "Other"];

const inputCls = "g-field";

export default function ContactPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const presetService = params.get("service") ?? "";
  const presetIndustry = params.get("industry") ?? "";

  const [services, setServices] = useState<string[]>(() => {
    if (!presetService) return [];
    const match = SERVICE_OPTIONS.find((s) => presetService.toLowerCase().includes(s.label.split(" ")[0].toLowerCase()));
    return match ? [match.key] : [];
  });
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => { document.title = "Contact SEAI — Let's Grow Your Business"; }, []);

  const toggleService = (key: string) =>
    setServices((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = e.currentTarget;
    const data = Object.fromEntries(new FormData(f).entries()) as Record<string, string>;
    if (services.length === 0) { setError("Select at least one service — or tell us what you need in the details box."); return; }
    setStatus("sending");
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name, businessName: data.businessName, email: data.email, phone: data.phone,
          industry: data.industry, website: data.website, servicesRequired: services,
          monthlyMarketingBudget: data.monthlyMarketingBudget, advertisingBudget: data.advertisingBudget,
          objective: data.objective, details: data.details,
          _gotcha: data._gotcha,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || `Submission failed (${res.status})`);
      setStatus("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Something went wrong — please try again, or email workwithseai@gmail.com.");
    }
  }

  if (status === "done") {
    return (
      <SiteChrome active="contact">
        <section className="g-sec">
          <div className="container-wide" style={{ maxWidth: 720 }}>
            <div className="g-form g-success">
              <div style={{ fontSize: 44 }}>✓</div>
              <h3>Got it. We're on it.</h3>
              <p className="sec-lede" style={{ marginInline: "auto" }}>Your inquiry is in our pipeline — a real human will reach out within one working day. If it's urgent, mention your timeline in your first mail back.</p>
              <p className="g-fineprint">A confirmation has been logged on our side. Expect a discovery call invite, not a sales script.</p>
              <a className="btn btn-primary" href="/">Back to home</a>
            </div>
          </div>
        </section>
      </SiteChrome>
    );
  }

  return (
    <SiteChrome active="contact">
      <section className="g-hero" style={{ paddingBottom: 56 }}>
        <div className="container-wide">
          <p className="g-kicker">Contact / Consultation</p>
          <h1 className="g-wordmark" style={{ fontSize: "clamp(36px, 6.5vw, 76px)", lineHeight: 1.05 }}>Let's grow<br />your business.</h1>
          <p className="g-sub">Tell us where you are and where you're headed. We'll come back within one working day with next steps — or a straight answer that SEAI isn't the right fit.</p>
        </div>
      </section>

      <section className="g-sec">
        <div className="container-wide g-contact">
          <aside className="g-side">
            <p className="g-num">What happens next</p>
            <ol style={{ paddingLeft: 20, marginTop: 10 }}>
              <li><b>Within one working day</b> — we review your details and reply with a short set of questions (or a call invite).</li>
              <li><b>Discovery call (30–45 min)</b> — goals, current marketing, budget comfort, decision-makers. We listen more than we pitch.</li>
              <li><b>Proposal within 3 working days</b> — scope, deliverables, fee, ad budget (separate), timelines.</li>
              <li><b>Agreement → onboarding → execution</b> — only if it's a fit for both of us.</li>
            </ol>
            <p className="g-num" style={{ marginTop: 26 }}>Fair notes</p>
            <ul>
              <li>Advertising budgets are always separate from SEAI fees — you pay platforms directly.</li>
              <li>No guaranteed leads or sales — anyone promising that is guessing loudly.</li>
              <li>We don't work with everyone — if we're not right for you, we'll say so.</li>
              <li>Prefer email? <a href="mailto:workwithseai@gmail.com">workwithseai@gmail.com</a></li>
            </ul>
          </aside>

          <form className="g-form" onSubmit={onSubmit} noValidate={false}>
            {error && <div className="g-error" style={{ display: "block" }} role="alert">{error}</div>}
            <div className="row2">
              <div className={inputCls}><label htmlFor="name">Your name *</label><input id="name" name="name" required maxLength={120} autoComplete="name" /></div>
              <div className={inputCls}><label htmlFor="businessName">Business name *</label><input id="businessName" name="businessName" required maxLength={160} autoComplete="organization" /></div>
            </div>
            <div className="row2">
              <div className={inputCls}><label htmlFor="email">Email *</label><input id="email" name="email" type="email" required maxLength={200} autoComplete="email" /></div>
              <div className={inputCls}><label htmlFor="phone">Phone / WhatsApp *</label><input id="phone" name="phone" type="tel" required maxLength={32} pattern="[0-9\u0028\u0029\u002b\u002d\s]{6,32}" placeholder="+91 …" autoComplete="tel" /></div>
            </div>
            <div className="row2">
              <div className={inputCls}><label htmlFor="industry">Industry</label>
                <CustomSelect id="industry" name="industry" defaultValue={presetIndustry} options={INDUSTRIES.map((i) => ({ value: i, label: i }))} />
              </div>
              <div className={inputCls}><label htmlFor="website">Website <small>(if any)</small></label><input id="website" name="website" type="text" maxLength={300} placeholder="https://" inputMode="url" /></div>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: "4px 0 16px" }}>
              <legend style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>Services you need *</legend>
              <div className="g-checks">
                {SERVICE_OPTIONS.map((s) => (
                  <label key={s.key}><input type="checkbox" checked={services.includes(s.key)} onChange={() => toggleService(s.key)} />{s.label}</label>
                ))}
              </div>
            </fieldset>

            <div className="row2">
              <div className={inputCls}><label htmlFor="monthlyMarketingBudget">Approx. monthly marketing budget</label>
                <CustomSelect id="monthlyMarketingBudget" name="monthlyMarketingBudget" defaultValue="" options={BUDGETS.map((b) => ({ value: b, label: b }))} />
              </div>
              <div className={inputCls}><label htmlFor="advertisingBudget">Approx. advertising budget <small>(paid to platforms)</small></label>
                <CustomSelect id="advertisingBudget" name="advertisingBudget" defaultValue="" options={AD_BUDGETS.map((b) => ({ value: b, label: b }))} />
              </div>
            </div>

            <div className={inputCls}><label htmlFor="objective">Main business objective</label>
              <CustomSelect id="objective" name="objective" defaultValue="" options={OBJECTIVES.map((o) => ({ value: o, label: o }))} />
            </div>
            <div className={inputCls}><label htmlFor="details">Anything else we should know? <small>(current situation, timeline, past attempts…)</small></label>
              <textarea id="details" name="details" rows={4} maxLength={4000} placeholder="e.g. We're a 6-month-old dental clinic in Adyar. Boosted posts brought walk-ins but no tracking…" />
            </div>

            <div className="hp" aria-hidden="true"><label>Leave this empty<input name="_gotcha" tabIndex={-1} autoComplete="off" /></label></div>
            <button className="btn btn-primary btn-lg" type="submit" disabled={status === "sending"} style={{ width: "100%", justifyContent: "center" }}>
              {status === "sending" ? "Sending…" : "Let's Grow Your Business →"}
            </button>
            <p className="g-fineprint">No spam, no cold calls from random lists — your details go to the SEAI team and nowhere else. We reply within one working day.</p>
          </form>
        </div>
      </section>

      <section className="g-sec" aria-labelledby="book-title">
        <div className="container-wide" style={{ maxWidth: 900 }}>
          <p className="g-num">Book a meeting</p>
          <h2 id="book-title" className="sec-title" style={{ fontSize: "clamp(28px, 4vw, 48px)" }}>Pick a time that works for you.</h2>
          <p className="sec-lede">Choose an available slot below — Cal.com will send the invite and a confirmation.</p>
          <div style={{ marginTop: 24 }}>
            <CalComScheduler />
          </div>
        </div>
      </section>
    </SiteChrome>
  );
}
