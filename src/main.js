/* ============================================================
   SEAI — public website · interactions
   Lightweight, dependency-free, progressive.
   ============================================================ */
/* stylesheet order is load order: tokens/base → sections → responsive */
/* NOTE: demo pages load /demo.css from public/ directly and do not use this bundle */
import "./css/base.css";
import "./css/home.css";
import "./css/responsive.css";
import "./css/pages.css";

(() => {
  "use strict";

  /* gate reveal styles on JS availability */
  document.documentElement.classList.add("js");

  /* ---------- header scrolled state ---------- */
  const header = document.querySelector(".site-header");
  const scrollTop = () => (document.scrollingElement || document.documentElement).scrollTop;
  const onScroll = () => {
    if (header) header.classList.toggle("scrolled", scrollTop() > 10);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- mobile menu ---------- */
  const menuBtn = document.getElementById("menu-btn");
  const setMenu = (open) => {
    if (!menuBtn) return;
    document.body.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.style.overflow = open ? "hidden" : "";
  };
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      setMenu(!document.body.classList.contains("menu-open"));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenu(false);
    });
    document.querySelectorAll(".mobile-nav a").forEach((a) => {
      a.addEventListener("click", () => setMenu(false));
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setMenu(false);
    });
  }

  /* ---------- reveal on scroll ---------- */
  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  const revealVisible = () => {
    const limit = scrollTop() + window.innerHeight + 80;
    let pending = false;
    for (const el of revealEls) {
      if (el.classList.contains("in")) continue;
      if (el.getBoundingClientRect().top <= limit) {
        el.classList.add("in");
      } else {
        pending = true;
      }
    }
    return pending;
  };
  revealVisible();
  window.addEventListener("scroll", revealVisible, { passive: true });
  window.addEventListener("resize", revealVisible, { passive: true });

  /* ---------- faq accordion ---------- */
  document.querySelectorAll(".faq-item").forEach((item) => {
    const btn = item.querySelector(".faq-q button");
    const panel = item.querySelector(".faq-a");
    if (!btn || !panel) return;
    btn.addEventListener("click", () => {
      const open = item.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* ---------- footer year ---------- */
  document.querySelectorAll(".year").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- hero preview grid ---------- */
  const previewGrid = document.getElementById("preview-grid");
  if (previewGrid) {
    const previews = [
      { type: "Restaurant" },
      { type: "Gym" },
      { type: "Salon" },
      { type: "Clinic" },
      { type: "Real Estate" },
      { type: "Business" }
    ];
    previewGrid.innerHTML = previews.map(() => `
      <div class="preview-item">
        <div class="preview-thumb"></div>
      </div>
    `).join("");
  }

  /* ---------- examples / proof grid ---------- */
  const examplesGrid = document.getElementById("examples-grid");
  if (examplesGrid) {
    const examples = [
      { type: "Restaurant", desc: "Menu, reservations, location. Warm, inviting single-page site. Earth tones, serif headlines.", url: "/examples/restaurant.html" },
      { type: "Gym", desc: "Classes, trainers, membership. Bold, high-contrast layout with schedules. Industrial typography.", url: "/examples/gym.html" },
      { type: "Salon", desc: "Services, booking, gallery. Soft, editorial aesthetic. Refined serif, generous whitespace.", url: "/examples/salon.html" },
      { type: "Clinic", desc: "Doctors, services, patient portal. Clean, trustworthy multi-page site. Clinical blue, accessible contrast.", url: "/examples/clinic.html" },
      { type: "Real Estate", desc: "Listings, agents, valuation. Property cards, search filters, enquiry forms. Trustworthy navy.", url: "/examples/real-estate.html" },
      { type: "Business", desc: "Services, insights, contact. Authority-building one-pager. Sharp sans-serif, data-driven.", url: "/examples/business.html" }
    ];
    examplesGrid.innerHTML = examples.map((ex, i) => `
      <article class="example-card reveal" style="transition-delay: ${i * 60}ms">
        <div class="example-thumb"></div>
        <div class="example-info">
          <p class="example-type">${ex.type}</p>
          <h3 class="example-name">${ex.type}</h3>
          <p class="example-desc">${ex.desc}</p>
        </div>
        <a class="example-cta" href="${ex.url}">Explore Website <span class="arr" aria-hidden="true">→</span></a>
      </article>
    `).join("");
  }

  /* ---------- business types grid ---------- */
  const btGrid = document.getElementById("bt-grid");
  if (btGrid) {
    const businessTypes = [
      { name: "Restaurants", desc: "Menu, reservations, location, hours", icon: "🍽️", url: "/examples/restaurant.html" },
      { name: "Gyms & Studios", desc: "Schedules, trainers, memberships", icon: "💪", url: "/examples/gym.html" },
      { name: "Salons & Spas", desc: "Services, booking, gallery, team", icon: "✨", url: "/examples/salon.html" },
      { name: "Clinics", desc: "Services, providers, patient portal, insurance", icon: "🏥", url: "/examples/clinic.html" },
      { name: "Consultants", desc: "Case studies, insights, contact, authority", icon: "📊", url: "/examples/business.html" },
      { name: "Agencies", desc: "Portfolio, team, services, inquiry", icon: "🎨", url: "/examples/business.html" },
      { name: "Real Estate", desc: "Listings, agents, calculator, areas", icon: "🏠", url: "/examples/real-estate.html" },
      { name: "Local Services", desc: "Emergency CTA, areas, reviews, call now", icon: "🔧", url: "/examples/clinic.html" }
    ];
    btGrid.innerHTML = businessTypes.map((bt, i) => `
      <li class="bt-card reveal" style="transition-delay: ${i * 40}ms">
        <a href="${bt.url}" class="bt-link">
          <div class="bt-icon" aria-hidden="true">${bt.icon}</div>
          <h3 class="bt-name">${bt.name}</h3>
          <p class="bt-desc">${bt.desc}</p>
        </a>
      </li>
    `).join("");
  }

  /* ---------- FAQ data ---------- */
  const faqList = document.getElementById("faq-list");
  if (faqList) {
    const faqs = [
      {
        q: "How long does it take?",
        a: "Most websites are delivered within 5–7 business days after the intake form is submitted. Complex projects may take up to 14 days. You'll see a preview before anything goes live."
      },
      {
        q: "Can I request changes?",
        a: "Yes. Every plan includes revision rounds (2 for STARTER, 4 for BUSINESS, unlimited for 30 days on COMPLETE). You review the full site before launch and request changes on design, copy, or structure."
      },
      {
        q: "Can I use my own domain?",
        a: "Absolutely. Connect an existing domain (we guide you through DNS) or purchase one through us with the COMPLETE plan. SSL and deployment are handled automatically."
      },
      {
        q: "Do you provide the copy?",
        a: "Yes. Professional copy is included in every tier — headlines, descriptions, service text, and CTAs written for your business. COMPLETE adds custom copywriting for all pages."
      },
      {
        q: "Will it work on mobile?",
        a: "Mobile-first is our default. Every SEAI website is fully responsive, touch-friendly, and optimized for thumb-zone navigation. More than half your visitors use phones — we design for them first."
      },
      {
        q: "Can I connect WhatsApp?",
        a: "Yes. Click-to-WhatsApp, click-to-call, and contact forms are built into every site. They're styled to match your brand and placed for maximum conversion."
      },
      {
        q: "What happens after I pay?",
        a: "You'll receive a confirmation and your project enters our build queue. We'll send the first preview within the delivery window. You review, request changes if needed, approve, and we deploy. Simple."
      },
      {
        q: "Is there a monthly fee?",
        a: "No. SEAI is a one-time payment. No subscriptions, no recurring charges. Revision support periods are included as noted per tier (30 days for STARTER/BUSINESS, 90 days for COMPLETE)."
      },
      {
        q: "What if I need changes later?",
        a: "Revision support is included. After the included period, you can request changes at a per-update rate. We don't disappear once the site is live — your business evolves, your website should too."
      }
    ];
    faqList.innerHTML = faqs.map((faq, i) => `
      <article class="faq-item reveal" style="transition-delay: ${i * 40}ms">
        <h3 class="faq-q"><button type="button" aria-expanded="false"><span>${faq.q}</span><span class="faq-x" aria-hidden="true"></span></button></h3>
        <div class="faq-a"><p>${faq.a}</p></div>
      </article>
    `).join("");
  }

  /* ---------- smooth scroll for anchor links ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const targetId = this.getAttribute("href");
      if (targetId === "#") return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top + window.scrollY;
        const offsetPosition = elementPosition - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: "smooth" });
      }
    });
  });
})();
