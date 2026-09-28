/* ============================================================
   SEAI — Demo Websites Interactions
   Shared JS for all demo sites
   ============================================================ */

(() => {
  "use strict";

  /* ---------- Mobile Menu ----------
     The panel (.demo-mobile-nav) is a sibling of .demo-header and is
     position:fixed below it. This manages open/close state, the scroll lock,
     focus, and the backdrop.

     Scroll lock: toggling `overflow:hidden` on <body> is not enough - Chromium
     scrolls <html>, so the page drifts while the menu is open and snaps back to
     0 on close. Pinning the body with position:fixed at its current offset
     holds the exact scroll position and makes the document unscrollable. The
     padding-right compensates for the scrollbar that disappears. */
  const menuBtn = document.getElementById("menu-btn");
  const mobileNav = document.getElementById("mobile-nav");
  // must match the CSS breakpoint where the desktop nav takes over
  const DESKTOP_MQ = window.matchMedia("(min-width: 981px)");
  let lockedY = 0;

  const lockScroll = () => {
    const doc = document.documentElement;
    lockedY = window.scrollY;
    const gap = window.innerWidth - doc.clientWidth;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
  };

  const unlockScroll = () => {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.paddingRight = "";
    window.scrollTo(0, lockedY);
  };

  const focusables = () =>
    Array.from(
      mobileNav?.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') || []
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

  const setMenu = (open) => {
    if (!menuBtn || !mobileNav) return;
    const isOpen = document.body.classList.contains("menu-open");
    if (open === isOpen) return;
    document.body.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (open) {
      lockScroll();
      const first = focusables()[0];
      // preventScroll matters: a plain .focus() would scroll the page to reveal
      // the element, fighting the scroll lock we just applied.
      first?.focus({ preventScroll: true });
    } else {
      unlockScroll();
      // without preventScroll this re-scrolls the page to the button and the
      // restored position is lost
      menuBtn.focus({ preventScroll: true });
    }
  };

  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      setMenu(!document.body.classList.contains("menu-open"));
    });
    document.addEventListener("keydown", (e) => {
      if (!document.body.classList.contains("menu-open")) return;
      if (e.key === "Escape") {
        setMenu(false);
        return;
      }
      // keep Tab inside the open panel
      if (e.key === "Tab") {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    // tapping the overlay backdrop (outside the panel's own list) closes it
    mobileNav?.addEventListener("click", (e) => {
      if (e.target === mobileNav) setMenu(false);
    });
    mobileNav?.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setMenu(false));
    });
    // collapse when the layout becomes desktop, so the panel can never be left
    // stranded over the desktop nav
    const onBreakpoint = (e) => { if (e.matches) setMenu(false); };
    if (typeof DESKTOP_MQ.addEventListener === "function") {
      DESKTOP_MQ.addEventListener("change", onBreakpoint);
    } else if (typeof DESKTOP_MQ.addListener === "function") {
      DESKTOP_MQ.addListener(onBreakpoint);
    }
    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setMenu(false);
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