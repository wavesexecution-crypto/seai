/* ============================================================
   SEAI — Public Intake Form
   4-step state machine with validation, persistence, plan selection
   ============================================================ */

(() => {
  "use strict";

  const STEPS = 4;
  const STEP_LABELS = ["Basics", "Details", "Style", "Review"];
  // Display-only. The amount actually charged is always resolved server-side by
  // seai.payments from its own plan table; these strings are never sent as a
  // price. Keep in sync with the plan cards in intake.html.
  const PLAN_PRICES = {
    starter: "₹2,999",
    business: "₹4,999",
    complete: "₹7,999"
  };
  const PLAN_NAMES = {
    starter: "STARTER",
    business: "BUSINESS",
    complete: "COMPLETE"
  };
  const PLAN_LABELS = {
    starter: "One-page website · 2 revisions",
    business: "Multi-section · 4 revisions · Blog · Maps",
    complete: "Custom copy · Full SEO · Integrations · Domain · 90 days support"
  };

  let currentStep = 1;
  let formData = {
    // Step 1: Basics
    businessName: "",
    businessType: "",
    whatYouDo: "",
    location: "",
    // Step 2: Details
    phone: "",
    whatsapp: "",
    email: "",
    instagram: "",
    existingSite: "",
    primaryGoal: "",
    // Step 3: Style
    logo: null,
    photos: [],
    preferredStyle: "modern",
    pages: ["home", "contact"],
    anythingElse: "",
    // Step 4: Plan (selected in review)
    plan: "business",
    // Storage integration (seai.storage via same-origin intake proxy).
    // File IDs only — bytes travel through signed upload URLs, and the
    // intake session scope is minted server-side, never in this file.
    storageFileIds: [],
    intakeSessionId: null,
    // True when attachments could not be uploaded. Recorded on the order so
    // the downstream record is honest rather than implying files were sent.
    attachmentsSkipped: false
  };

  const elements = {
    form: null,
    steps: [],
    progressFill: null,
    progressSteps: [],
    progressLabel: null,
    navPrev: null,
    navNext: null,
    prevBtn: null,
    submitBtn: null,
    planCards: null,
    reviewSummary: null,
    fileInputs: {},
    fileNames: {}
  };

  function init() {
    elements.form = document.getElementById("intake-form");
    if (!elements.form) return;

    elements.steps = Array.from(elements.form.querySelectorAll(".form-step"));
    elements.progressFill = document.querySelector(".progress-fill");
    elements.progressSteps = Array.from(document.querySelectorAll(".progress-steps .step"));
    elements.progressLabel = document.querySelector(".progress-label");
    elements.navPrev = document.getElementById("nav-prev");
    elements.navNext = document.getElementById("nav-next");
    elements.submitBtn = document.getElementById("submit-btn");
    elements.planCards = document.getElementById("plan-cards");
    elements.reviewSummary = document.getElementById("review-summary");
    elements.fileInputs.logo = document.getElementById("logo");
    elements.fileInputs.photos = document.getElementById("photos");
    elements.fileNames.logo = document.querySelector("#logo-upload .file-name");
    elements.fileNames.photos = document.querySelector("#photos-upload .file-name");

    setupPlanSelection();
    setupFileUploads();
    setupStyleOptions();
    setupPageCheckboxes();
    setupNavigation();
    loadPlanFromUrl();
    updateProgress();
    showStep(currentStep);
  }

  function setupPlanSelection() {
    if (!elements.planCards) return;
    elements.planCards.querySelectorAll(".plan-card").forEach(card => {
      card.addEventListener("click", () => {
        const plan = card.dataset.plan;
        selectPlan(plan);
      });
      const input = card.querySelector('input[type="radio"]');
      if (input) {
        input.addEventListener("change", () => {
          selectPlan(input.value);
        });
      }
    });
  }

  function selectPlan(plan) {
    formData.plan = plan;
    elements.planCards.querySelectorAll(".plan-card").forEach(card => {
      card.classList.toggle("selected", card.dataset.plan === plan);
      const input = card.querySelector('input[type="radio"]');
      if (input) input.checked = card.dataset.plan === plan;
    });
    updateReviewSummary();
  }

  function loadPlanFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    if (plan && PLAN_PRICES[plan]) {
      selectPlan(plan);
    }
  }

  function setupFileUploads() {
    ["logo", "photos"].forEach(type => {
      const input = elements.fileInputs[type];
      const nameEl = elements.fileNames[type];
      const btn = input?.closest(".file-upload")?.querySelector(".file-btn");

      if (input && btn) {
        btn.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
          const files = Array.from(input.files);
          if (type === "logo") {
            formData.logo = files[0] || null;
            nameEl.textContent = files[0] ? files[0].name : "No file chosen";
          } else {
            formData.photos = files;
            nameEl.textContent = files.length ? `${files.length} file(s) selected` : "No files chosen";
          }
        });
      }
    });
  }

  function setupStyleOptions() {
    document.querySelectorAll('.style-option input[type="radio"]').forEach(input => {
      input.addEventListener("change", () => {
        formData.preferredStyle = input.value;
      });
    });
  }

  function setupPageCheckboxes() {
    const boxes = Array.from(
      document.querySelectorAll('.checkbox-group input[type="checkbox"]')
    );
    const counter = document.querySelector("[data-pages-count]");

    const sync = () => {
      if (!counter) return;
      const n = boxes.filter((b) => b.checked).length;
      counter.textContent = `${n} of ${boxes.length} selected`;
    };

    boxes.forEach((input) => {
      input.addEventListener("change", () => {
        const value = input.value;
        if (input.checked) {
          if (!formData.pages.includes(value)) formData.pages.push(value);
        } else {
          formData.pages = formData.pages.filter((p) => p !== value);
        }
        sync();
      });
    });
    sync();
  }

  function setupNavigation() {
    elements.navNext.addEventListener("click", () => goNext());
    elements.navPrev.addEventListener("click", () => goPrev());
    elements.form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSubmit();
    });

    // clicking a completed step jumps back to it
    elements.progressSteps.forEach((el, i) => {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.addEventListener("click", () => {
        const target = i + 1;
        if (target < currentStep) {
          currentStep = target;
          showStep(currentStep);
          updateProgress();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });
    });
  }

  function showFieldError(field, message) {
    const fieldId = field.id || field.name;
    let err = field.parentNode.querySelector(`.field-error[data-for="${fieldId}"]`);
    if (!err) {
      err = document.createElement("p");
      err.className = "field-error";
      err.dataset.for = fieldId;
      field.parentNode.appendChild(err);
    }
    err.textContent = message;
    field.setAttribute("aria-invalid", "true");
  }

  function clearFieldError(field) {
    const fieldId = field.id || field.name;
    const err = field.parentNode.querySelector(`.field-error[data-for="${fieldId}"]`);
    if (err) err.remove();
    field.removeAttribute("aria-invalid");
  }

  function validateStep(step) {
    const stepEl = elements.steps[step - 1];
    if (!stepEl) return true;

    const requiredFields = stepEl.querySelectorAll("[required]");
    let isValid = true;
    let firstInvalid = null;

    requiredFields.forEach(field => {
      if (!field.value.trim()) {
        isValid = false;
        showFieldError(field, "This field is required");
        if (!firstInvalid) firstInvalid = field;
      } else {
        clearFieldError(field);
      }
    });

    // email format check (step 2)
    const email = stepEl.querySelector("#email");
    if (email && email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      isValid = false;
      showFieldError(email, "Enter a valid email address");
      if (!firstInvalid) firstInvalid = email;
    }

    // primary goal select (step 3)
    const goal = stepEl.querySelector("#primary-goal");
    if (goal && !goal.value) {
      isValid = false;
      showFieldError(goal, "Select a primary goal");
      if (!firstInvalid) firstInvalid = goal;
    }

    if (!isValid && firstInvalid) {
      firstInvalid.focus({ preventScroll: true });
    }

    return isValid;
  }

  function collectStepData(step) {
    const stepEl = elements.steps[step - 1];
    if (!stepEl) return;

    const inputs = stepEl.querySelectorAll("input, select, textarea");
    inputs.forEach(input => {
      if (input.type === "radio" && input.name) {
        if (input.checked) formData[input.name] = input.value;
      } else if (input.type === "checkbox" && input.name) {
        if (input.checked) {
          if (!Array.isArray(formData[input.name])) formData[input.name] = [];
          if (!formData[input.name].includes(input.value)) formData[input.name].push(input.value);
        } else {
          if (Array.isArray(formData[input.name])) {
            formData[input.name] = formData[input.name].filter(v => v !== input.value);
          }
        }
      } else if (input.type !== "file") {
        formData[input.name] = input.value;
      }
    });
  }

  function goNext() {
    if (!validateStep(currentStep)) return;
    collectStepData(currentStep);

    if (currentStep < STEPS) {
      currentStep++;
      showStep(currentStep);
      updateProgress();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goPrev() {
    if (currentStep > 1) {
      currentStep--;
      showStep(currentStep);
      updateProgress();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function showStep(step) {
    elements.steps.forEach((el, i) => {
      const isActive = i + 1 === step;
      el.hidden = !isActive;
      if (isActive) {
        el.style.animation = "none";
        el.offsetHeight;
        el.style.animation = "stepFade 200ms var(--ease)";
      }
    });

    elements.navPrev.hidden = step === 1;
    elements.navNext.hidden = step === STEPS;
    if (elements.submitBtn) elements.submitBtn.hidden = step !== STEPS;

    if (step === STEPS) {
      updateReviewSummary();
    }

    const progressRegion = document.querySelector(".intake-progress");
    if (progressRegion) {
      progressRegion.setAttribute("aria-label", `Progress: Step ${step} of ${STEPS}`);
    }

    const progressBar = document.querySelector(".progress-bar");
    if (progressBar) {
      progressBar.setAttribute("aria-valuenow", String(Math.round((step / STEPS) * 100)));
    }

    if (elements.progressLabel) {
      elements.progressLabel.textContent = `STEP ${step} OF ${STEPS} — ${STEP_LABELS[step - 1].toUpperCase()}`;
    }
  }

  function updateProgress() {
    const pct = (currentStep / STEPS) * 100;
    if (elements.progressFill) elements.progressFill.style.width = `${pct}%`;

    elements.progressSteps.forEach((el, i) => {
      const n = i + 1;
      el.classList.toggle("active", n === currentStep);
      el.classList.toggle("done", n < currentStep);
      if (n === currentStep) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
  }

  function updateReviewSummary() {
    if (!elements.reviewSummary) return;

    const businessTypeLabels = {
      restaurant: "Restaurant / Cafe / Bar",
      gym: "Gym / Fitness Studio / Yoga",
      salon: "Salon / Spa / Beauty / Barber",
      clinic: "Clinic / Medical / Dental / Wellness",
      consultant: "Consultant / Coach / Professional Services",
      agency: "Agency / Creative / Marketing / Design",
      realestate: "Real Estate / Property",
      localservice: "Local Service (Plumbing, Electrical, HVAC, etc.)",
      other: "Other"
    };

    const goalLabels = {
      leads: "Get more leads / inquiries",
      bookings: "Get bookings / appointments",
      phone: "Get phone calls / WhatsApp messages",
      credibility: "Establish credibility / professional presence",
      sales: "Sell products / services online",
      other: "Other"
    };

    const styleLabels = {
      modern: "Modern — Clean, minimal, lots of whitespace",
      classic: "Classic — Timeless, editorial, serif headlines",
      bold: "Bold — High contrast, strong typography",
      warm: "Warm — Inviting, organic, earth tones"
    };

    const pageLabels = {
      home: "Home / Hero",
      about: "About Us",
      services: "Services / Menu",
      gallery: "Gallery / Portfolio",
      team: "Team / Providers",
      testimonials: "Testimonials / Reviews",
      blog: "Blog / News",
      contact: "Contact / Book"
    };

    const sections = [
      {
        title: "BUSINESS",
        editStep: 1,
        items: [
          { label: "Business name", value: formData.businessName },
          { label: "Business type", value: businessTypeLabels[formData.businessType] || formData.businessType },
          { label: "Description", value: formData.whatYouDo },
          { label: "Location", value: formData.location }
        ]
      },
      {
        title: "CONTACT",
        editStep: 2,
        items: [
          { label: "Phone", value: formData.phone },
          { label: "Email", value: formData.email },
          { label: "WhatsApp", value: formData.whatsapp },
          { label: "Instagram", value: formData.instagram ? `@${formData.instagram.replace(/^@/, "")}` : "" },
          { label: "Website", value: formData.existingSite }
        ]
      },
      {
        title: "STYLE",
        editStep: 3,
        items: [
          { label: "Preferred style", value: styleLabels[formData.preferredStyle] || formData.preferredStyle },
          { label: "Primary goal", value: goalLabels[formData.primaryGoal] || "—" },
          { label: "Required pages", value: formData.pages.map(p => pageLabels[p] || p).join(", ") || "—" },
          { label: "Logo", value: formData.logo ? formData.logo.name : "Not uploaded" },
          { label: "Photos", value: formData.photos.length ? `${formData.photos.length} file(s)` : "None" },
          { label: "Additional notes", value: formData.anythingElse || "—" }
        ]
      },
      {
        title: "PLAN",
        items: [
          { label: "Selected plan", value: `${PLAN_NAMES[formData.plan]} — ${PLAN_PRICES[formData.plan]}` },
          { label: "Includes", value: PLAN_LABELS[formData.plan] }
        ]
      }
    ];

    const esc = (v) => String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    elements.reviewSummary.innerHTML = `
      <p class="review-note">Review your information below. Use the edit links to jump back to any section.</p>
      ${sections.map(section => `
        <div class="review-block">
          <div class="review-block-head">
            <h4 class="review-block-title">${section.title}</h4>
            ${section.editStep ? `<button type="button" class="review-edit" data-goto="${section.editStep}">Edit</button>` : ""}
          </div>
          ${section.items.map(item => `
            <div class="review-item">
              <span class="review-label">${item.label}</span>
              <span class="review-value">${esc(item.value) || "—"}</span>
            </div>
          `).join("")}
        </div>
      `).join("")}
    `;

    elements.reviewSummary.querySelectorAll(".review-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = parseInt(btn.dataset.goto, 10);
        if (target) {
          currentStep = target;
          showStep(currentStep);
          updateProgress();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });
  }

  function showError(message) {
    let el = document.querySelector(".intake-error");
    if (!el) {
      el = document.createElement("div");
      el.className = "intake-error";
      el.setAttribute("role", "alert");
      const section = document.querySelector(".intake-form-section");
      if (section) section.insertBefore(el, section.firstChild);
    }
    el.textContent = message;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Non-blocking notice. Used when something optional could not be carried
  // through: the purchase must still proceed, but the customer is told rather
  // than left believing their files were sent.
  function showNotice(message) {
    let el = document.querySelector(".intake-notice");
    if (!el) {
      el = document.createElement("div");
      el.className = "intake-notice";
      // "status" rather than "alert": not an error, but must be announced.
      el.setAttribute("role", "status");
      const anchor = document.getElementById("photos-upload");
      const section = anchor ? anchor.closest(".step-panel, .form-step, section, div") : null;
      (section || document.querySelector(".intake-form-section"))?.appendChild(el);
    }
    el.textContent = message;
  }

  function clearNotice() {
    const el = document.querySelector(".intake-notice");
    if (el) el.remove();
  }

  // Upload intake files to seai.storage through the same-origin intake
  // proxy. The browser only ever sees short-lived signed upload URLs and
  // storage file IDs; tenant scope is minted server-side per intake session.
  const MAX_INTAKE_FILE_BYTES = 5 * 1024 * 1024;

  function categoryFor(kind, file) {
    if (kind === "logo") return "logo";
    if (file && /^image\//.test(file.type || "")) return "image";
    if (file && file.type === "application/pdf") return "document";
    return "intake_attachment";
  }

  async function uploadOneFile(kind, file) {
    const initRes = await fetch("/api/storage/intake/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        category: categoryFor(kind, file)
      })
    });
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      throw new Error(err.error || ("Could not upload " + file.name));
    }
    const init = await initRes.json();
    if (init.intakeSessionId) formData.intakeSessionId = init.intakeSessionId;

    // Bytes: try the signed URL directly (S3 presigned PUT), then fall back
    // to the proxy relay (memory/local providers).
    let put = await fetch(init.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    if (!put.ok && init.bytesEndpoint) {
      put = await fetch(init.bytesEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file
      });
    }
    if (!put.ok) throw new Error("Could not upload " + file.name);

    const doneRes = await fetch(
      "/api/storage/intake/uploads/" + encodeURIComponent(init.fileId) + "/complete",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    );
    if (!doneRes.ok) {
      const err = await doneRes.json().catch(() => ({}));
      throw new Error(err.error || ("Could not finish upload of " + file.name));
    }
    return init.fileId;
  }

  const ATTACHMENT_SKIPPED_MESSAGE =
    "We could not upload your files right now, so they are not attached to this order. " +
    "Please continue to payment, then email your logo and photos to hello@seai.store and we will add them.";

  async function uploadIntakeFiles() {
    const queue = [];
    if (formData.logo) queue.push(["logo", formData.logo]);
    (formData.photos || []).forEach((f) => queue.push(["photos", f]));
    if (!queue.length) return;

    // Probe for storage availability.
    //
    // The probe body is deliberately invalid, so a *correctly functioning*
    // endpoint always answers 4xx (it rejects a request with no filename).
    // Only an absent endpoint answers 404. An earlier version checked for
    // exactly 404, which happened to work solely because these functions were
    // not deployed yet; once they were, the probe returned 400, the guard was
    // bypassed, and every customer who attached a file was blocked from paying
    // by the validation error. Treat any non-2xx as "attachments unavailable".
    //
    // Attachments are optional. The purchase must never be blocked by storage.
    let probe;
    try {
      probe = await fetch("/api/storage/intake/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probe: true })
      });
    } catch (err) {
      console.warn("[intake] storage unreachable; continuing without file attachments");
      formData.attachmentsSkipped = true;
      showNotice(ATTACHMENT_SKIPPED_MESSAGE);
      return;
    }
    if (!probe.ok) {
      console.warn("[intake] storage unavailable (" + probe.status + "); continuing without file attachments");
      formData.attachmentsSkipped = true;
      showNotice(ATTACHMENT_SKIPPED_MESSAGE);
      return;
    }

    clearNotice();
    formData.attachmentsSkipped = false;
    formData.storageFileIds = formData.storageFileIds || [];
    for (const [kind, file] of queue) {
      if (file.size > MAX_INTAKE_FILE_BYTES) {
        throw new Error(file.name + " exceeds the 5MB limit");
      }
      const id = await uploadOneFile(kind, file);
      if (formData.storageFileIds.indexOf(id) === -1) formData.storageFileIds.push(id);
    }
  }

async function handleSubmit() {
    collectStepData(currentStep);
    if (!validateStep(currentStep)) return;

    // Storage first: file IDs travel with the payment metadata for adoption.
    try {
      await uploadIntakeFiles();
    } catch (err) {
      showError(err && err.message ? err.message : "Could not upload files. Please try again.");
      return;
    }

    // Payment integration is REQUIRED for production purchases
    if (!window.SEAIPayment || !window.SEAIPayment.initiatePayment) {
      showError("Payment service unavailable. Please try again later or contact support.");
      return;
    }

    await window.SEAIPayment.initiatePayment(formData);
  }

  function showSuccess(result) {
    const heroEl = document.querySelector(".intake-hero");
    const formSectionEl = document.querySelector(".intake-form-section");
    if (heroEl) heroEl.hidden = true;
    if (formSectionEl) formSectionEl.hidden = true;

    const successEl = document.getElementById("intake-success");
    if (successEl) {
      successEl.hidden = false;
      successEl.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
      document.getElementById("success-business").textContent = formData.businessName || "—";
      document.getElementById("success-plan").textContent = `${PLAN_NAMES[formData.plan]} — ${PLAN_PRICES[formData.plan]}`;
      document.getElementById("success-email").textContent = formData.email || "your email";

      const refEl = document.getElementById("success-ref");
      if (refEl && result?.projectId) {
        refEl.textContent = `Reference: ${result.projectId}`;
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();