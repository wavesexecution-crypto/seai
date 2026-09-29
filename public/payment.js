/* ============================================================
   SEAI Payment Integration

   Same-origin client for the payment flow:

     create order -> Razorpay Checkout -> verify -> confirm

   The last step matters. Razorpay's handler callback only tells us the
   customer finished a checkout; it is not proof of payment. The order is not
   marked `paid` until seai.payments has verified the Razorpay webhook, so this
   client polls /api/payment/status and renders success only once the server
   reports `paid`. If confirmation never arrives, the customer is told the
   payment is being confirmed and is not shown a receipt.

   Amounts are never computed here. `amountPaise`, `currency` and `keyId` all
   come from the server, which in turn reads them from seai.payments' own plan
   table. A tampered page cannot change the charge.
   ============================================================ */

(() => {
  "use strict";

  const API_BASE = ""; // same origin

  /** How long to wait for the webhook-confirmed `paid` state. */
  const CONFIRM_TIMEOUT_MS = 90_000;
  const CONFIRM_INTERVAL_MS = 1_500;

  /* ---------------------------------------------------------------------
     Session state
     The customer identity and idempotency key are generated once per browser
     session and reused across retries, so a double-click or a network retry
     cannot create a second customer or a second order.
     --------------------------------------------------------------------- */

  const STORAGE_KEY = "seai.intake.session";

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveSession(patch) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSession(), ...patch }));
    } catch (_) {
      /* sessionStorage unavailable (private mode); in-memory still works */
    }
  }

  /** RFC4122 v2 UUID. seai.payments types customerId as z.string().uuid(). */
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      const b = window.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    throw new Error("This browser cannot generate a secure session id.");
  }

  function getCustomerId() {
    const session = loadSession();
    if (session.customerId) return session.customerId;
    const customerId = uuid();
    saveSession({ customerId });
    return customerId;
  }

  function getIdempotencyKey() {
    const session = loadSession();
    if (session.idempotencyKey) return session.idempotencyKey;
    const idempotencyKey = "intake_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
    saveSession({ idempotencyKey });
    return idempotencyKey;
  }

  /* ---------------------------------------------------------------------
     API helpers
     --------------------------------------------------------------------- */

  async function postJson(path, payload) {
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (_) {
      throw new Error("Could not reach the payment service. Check your connection and try again.");
    }
    return unwrap(response);
  }

  async function getJson(path) {
    let response;
    try {
      response = await fetch(API_BASE + path, { headers: { Accept: "application/json" } });
    } catch (_) {
      throw new Error("Could not reach the payment service. Check your connection and try again.");
    }
    return unwrap(response);
  }

  async function unwrap(response) {
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    if (!response.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || "The payment service returned an unexpected response.");
    }
    return data;
  }

  /* ---------------------------------------------------------------------
     Flow steps
     --------------------------------------------------------------------- */

  async function createPaymentOrder(formData) {
    return postJson("/api/payment/order", {
      customerId: getCustomerId(),
      planId: formData.plan,
      idempotencyKey: getIdempotencyKey(),
      metadata: {
        source: "seai.public",
        // Storage adoption references (IDs only - bytes live in seai.storage
        // under a server-minted intake scope; see server/storage-proxy.js).
        intakeSessionId: formData.intakeSessionId || null,
        storageFileIds: formData.storageFileIds || [],
        intakeData: {
          businessName: formData.businessName,
          businessType: formData.businessType,
          email: formData.email,
          phone: formData.phone,
        },
      },
    });
  }

  async function verifyPayment(razorpayResponse) {
    return postJson("/api/payment/verify", {
      razorpayOrderId: razorpayResponse.razorpay_order_id,
      razorpayPaymentId: razorpayResponse.razorpay_payment_id,
      razorpaySignature: razorpayResponse.razorpay_signature,
    });
  }

  /** Poll the authoritative order state until it settles. */
  async function confirmOrder(orderId, options) {
    const timeoutMs = (options && options.timeoutMs) || CONFIRM_TIMEOUT_MS;
    const intervalMs = (options && options.intervalMs) || CONFIRM_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let order = null;
      try {
        const data = await getJson("/api/payment/status?orderId=" + encodeURIComponent(orderId));
        order = data.order;
      } catch (_) {
        order = null; // transient; keep polling until the deadline
      }

      if (order) {
        if (order.paid) return order;
        if (order.failed) {
          throw new Error("The payment was not completed. No money has been taken - please try again.");
        }
      }

      if (Date.now() >= deadline) {
        // Honest failure: we will not show a receipt we cannot substantiate.
        const err = new Error(
          "We could not confirm your payment yet. If you were charged, the receipt will arrive by email shortly."
        );
        err.unconfirmed = true;
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  function loadRazorpayScript() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load the secure payment window."));
      document.head.appendChild(script);
    });
  }

  function openRazorpayCheckout(order, formData) {
    return new Promise((resolve, reject) => {
      // key / amount / currency all come from the server response. The server
      // reads them from seai.payments; nothing here is derived from a price
      // shown in the page.
      const options = {
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "SEAI",
        description: "Website build - " + (order.planId || ""),
        order_id: order.razorpayOrderId,
        handler: (response) => resolve(response),
        prefill: {
          name: formData.businessName || "",
          email: formData.email || "",
          contact: formData.phone || "",
        },
        notes: {
          internal_order_id: order.orderId,
          plan_id: order.planId || "",
        },
        theme: { color: "#0a0a0b" },
        modal: {
          ondismiss: () => reject(new Error("Payment cancelled by user")),
        },
      };

      try {
        new window.Razorpay(options).open();
      } catch (err) {
        reject(new Error("Could not open the payment window. Please try again."));
      }
    });
  }

  /* ---------------------------------------------------------------------
     UI
     --------------------------------------------------------------------- */

  function showLoading(button, text) {
    if (!button) return;
    button.disabled = true;
    if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
    button.innerHTML = text;
  }

  function hideLoading(button) {
    if (!button) return;
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function showError(message) {
    const existing = document.querySelector(".payment-error");
    if (existing) existing.remove();

    const errorEl = document.createElement("div");
    errorEl.className = "payment-error";
    errorEl.setAttribute("role", "alert");
    errorEl.textContent = message;

    const formSection = document.querySelector(".intake-form-section");
    if (formSection) {
      formSection.insertBefore(errorEl, formSection.firstChild);
      errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (document.querySelector(".intake-hero")) {
      document.querySelector(".intake-hero").appendChild(errorEl);
    }
  }

  function formatInr(paise) {
    if (!Number.isFinite(paise)) return "";
    return "₹" + (paise / 100).toLocaleString("en-IN");
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /**
   * Render the confirmed state. Every value shown here comes from the server:
   * the plan name and amount from the confirmed order, the business and email
   * from what the customer actually typed.
   */
  function showPaymentSuccess({ order, payment, formData }) {
    const heroEl = document.querySelector(".intake-hero");
    const formSectionEl = document.querySelector(".intake-form-section");
    if (heroEl) heroEl.hidden = true;
    if (formSectionEl) formSectionEl.hidden = true;

    const successEl = document.getElementById("intake-success");
    if (!successEl) return;

    successEl.hidden = false;
    successEl.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));

    setText("success-business", formData.businessName || "—");
    setText("success-plan", (order.planName || order.planId || "Plan") + " — " + formatInr(order.amountPaise));
    setText("success-email", formData.email || "your email");

    const ref = [];
    if (order.orderId) ref.push("Order: " + order.orderId);
    if (payment && payment.id) ref.push("Payment: " + payment.id);
    setText("success-ref", ref.join("  |  "));

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Shown when the webhook has not confirmed yet. Deliberately not a receipt. */
  function showPendingConfirmation({ order, formData }) {
    const heroEl = document.querySelector(".intake-hero");
    const formSectionEl = document.querySelector(".intake-form-section");
    if (heroEl) heroEl.hidden = true;
    if (formSectionEl) formSectionEl.hidden = true;

    const successEl = document.getElementById("intake-success");
    if (!successEl) return;

    const title = document.getElementById("success-title");
    if (title) title.textContent = "Confirming your payment…";

    const message = successEl.querySelector(".success-message");
    if (message) {
      message.textContent =
        "Your payment is being confirmed by the bank. This page updates automatically once it clears - you will also get an email receipt.";
    }

    successEl.hidden = false;
    successEl.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));

    setText("success-business", formData.businessName || "—");
    setText("success-plan", (order.planName || order.planId || "Plan") + " — " + formatInr(order.amountPaise));
    setText("success-email", formData.email || "your email");
    setText("success-ref", order.orderId ? "Order: " + order.orderId : "");

    window.scrollTo({ top: 0, behavior: "smooth" });

    // Keep polling in the background so the page settles into a receipt if the
    // webhook lands late.
    const tick = async () => {
      try {
        const data = await getJson("/api/payment/status?orderId=" + encodeURIComponent(order.orderId));
        if (data.order && data.order.paid) {
          window.location.reload();
        }
      } catch (_) {
        /* keep trying */
      }
      window.setTimeout(tick, 5000);
    };
    window.setTimeout(tick, 5000);
  }

  /* ---------------------------------------------------------------------
     Entry point
     --------------------------------------------------------------------- */

  async function initiatePayment(formData) {
    const submitBtn = document.getElementById("submit-btn");

    let order;
    showLoading(submitBtn, "Creating order…");
    try {
      const data = await createPaymentOrder(formData);
      order = data.order;
      if (!order || !order.razorpayOrderId || !order.keyId || !Number.isFinite(order.amountPaise)) {
        throw new Error("The payment service returned an incomplete order. Please try again.");
      }
    } catch (err) {
      hideLoading(submitBtn);
      showError(err.message || "Could not start the payment. Please try again.");
      return;
    }

    try {
      showLoading(submitBtn, "Opening secure payment…");
      await loadRazorpayScript();
      const razorpayResponse = await openRazorpayCheckout(order, formData);

      showLoading(submitBtn, "Verifying payment…");
      const verification = await verifyPayment(razorpayResponse);

      // Verification succeeded but the order is not `paid` until the webhook
      // lands. Confirm before showing a receipt.
      showLoading(submitBtn, "Confirming with your bank…");
      const confirmed = await confirmOrder(order.orderId);

      hideLoading(submitBtn);
      showPaymentSuccess({ order: confirmed, payment: verification.payment, formData });
    } catch (err) {
      hideLoading(submitBtn);
      if (err && err.unconfirmed) {
        // Never fake success: tell the truth and keep watching.
        showPendingConfirmation({ order, formData });
        return;
      }
      if (err && err.message === "Payment cancelled by user") {
        showError("Payment was cancelled. Nothing was charged.");
        return;
      }
      showError(err.message || "Payment failed. Please try again or contact support.");
    }
  }

  window.SEAIPayment = {
    initiatePayment,
    createPaymentOrder,
    verifyPayment,
    confirmOrder,
    loadRazorpayScript,
  };
})();
