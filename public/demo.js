/* ============================================================
   SEAI — Demo Websites Interactions
   Shared JS for all demo sites
   ============================================================ */

(() => {
  "use strict";

  /* ---------- Mobile Menu ---------- */
  const menuBtn = document.getElementById("menu-btn");
  const mobileNav = document.getElementById("mobile-nav");
  const setMenu = (open) => {
    if (!menuBtn || !mobileNav) return;
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
    mobileNav?.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setMenu(false));
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 768) setMenu(false);
    });
  }

  /* ---------- Tab Navigation ----------
     Wire-up is data-driven so a rebuilt page can opt in from markup alone:
     <div role="tablist" data-tablist=".menu__panel"> … </div>  */
  function initTabs(tabList, panelSelector) {
    const list = typeof tabList === "string" ? document.querySelector(tabList) : tabList;
    if (!list) return;
    const tabs = list.querySelectorAll("[role=\"tab\"]");
    const panels = document.querySelectorAll(panelSelector);
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const targetId = tab.getAttribute("aria-controls");
        tabs.forEach((t) => {
          t.setAttribute("aria-selected", "false");
          t.classList.remove("active");
        });
        panels.forEach((p) => p.hidden = true);
        tab.setAttribute("aria-selected", "true");
        tab.classList.add("active");
        const targetPanel = document.getElementById(targetId);
        if (targetPanel) targetPanel.hidden = false;
      });
    });
  }

  document.querySelectorAll("[data-tablist]").forEach((list) => {
    initTabs(list, list.getAttribute("data-tablist"));
  });

  // legacy demos not yet rebuilt — remove each line as its page is rebuilt
  initTabs("#menu-tabs", ".menu-panel");
  initTabs("#service-tabs", ".service-panel");
  initTabs("#property-tabs", ".property-panel");
  initTabs("#schedule-tabs", ".schedule-panel");

  /* ---------- Form Handling (Generic Success State) ----------
     <form data-form data-success="res-success" data-reset="res-reset"> … </form>
     Validate, then swap to the success panel. No backend: this is a demo. */
  function initForm(formId, successId, resetId) {
    const form = document.getElementById(formId);
    const success = document.getElementById(successId);
    const resetBtn = document.getElementById(resetId);
    if (!form || !success) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      form.hidden = true;
      success.hidden = false;
      success.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
      window.scrollTo({ top: success.offsetTop - 100, behavior: "smooth" });
    });
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        form.reset();
        form.hidden = false;
        success.hidden = true;
        window.scrollTo({ top: form.offsetTop - 100, behavior: "smooth" });
      });
    }
  }

  document.querySelectorAll("form[data-form]").forEach((form) => {
    initForm(form.id, form.getAttribute("data-success"), form.getAttribute("data-reset"));
  });

  // legacy demos not yet rebuilt — remove each line as its page is rebuilt
  initForm("reservation-form", "res-success", "res-reset");
  initForm("booking-form", "booking-success", "booking-reset");
  initForm("appointment-form", "apt-success", "apt-reset");
  initForm("membership-form", "mem-success", "mem-reset");
  initForm("valuation-form", "val-success", "val-reset");
  initForm("contact-form", "con-success", "con-reset");

  /* ---------- Gallery Filters (Salon) ---------- */
  const filterBtns = document.querySelectorAll(".filter-btn");
  const galleryItems = document.querySelectorAll(".gallery-item");
  if (filterBtns.length && galleryItems.length) {
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filter = btn.dataset.filter;
        galleryItems.forEach((item) => {
          if (filter === "all" || item.dataset.category === filter) {
            item.style.display = "block";
          } else {
            item.style.display = "none";
          }
        });
      });
    });
  }

  /* ---------- Smooth Scroll for Anchor Links ---------- */
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

  /* ---------- Header Scroll State ---------- */
  const header = document.querySelector(".demo-header");
  const onScroll = () => {
    if (header) header.classList.toggle("scrolled", window.scrollY > 10);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Reveal on Scroll ---------- */
  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  const revealVisible = () => {
    const limit = window.scrollY + window.innerHeight + 80;
    for (const el of revealEls) {
      if (el.classList.contains("in")) continue;
      if (el.getBoundingClientRect().top <= limit) {
        el.classList.add("in");
      }
    }
  };
  revealVisible();
  window.addEventListener("scroll", revealVisible, { passive: true });
  window.addEventListener("resize", revealVisible, { passive: true });

  /* ---------- Year ---------- */
  document.querySelectorAll(".year").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
})();