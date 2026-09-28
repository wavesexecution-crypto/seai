/* ============================================================
   SEAI Payment Integration
   Client-side integration with local payment proxy for Razorpay Checkout
   ============================================================ */

(() => {
  "use strict";

  // Configuration - proxy endpoints on same origin
  const PROXY_API_BASE = ""; // Same origin

  /**
   * Generate a unique idempotency key for the current session
   */
  function generateIdempotencyKey() {
    return "intake_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Generate a customer ID from intake data
   */
  function generateCustomerId(formData) {
    // Use email + timestamp for uniqueness
    const base = formData.email.toLowerCase().replace(/[^a-z0-9]/g, "");
    return "cust_" + base + "_" + Date.now().toString(36);
  }

  /**
   * Create payment order via local proxy
   */
  async function createPaymentOrder(formData) {
    const customerId = generateCustomerId(formData);
    const idempotencyKey = generateIdempotencyKey();

    const payload = {
      customerId,
      planId: formData.plan,
      idempotencyKey,
      metadata: {
        source: "seai.public",
        // Storage adoption references (IDs only — bytes live in seai.storage
        // under a server-minted intake scope; see server/storage-proxy.js).
        intakeSessionId: formData.intakeSessionId || null,
        storageFileIds: formData.storageFileIds || [],
        intakeData: {
          businessName: formData.businessName,
          businessType: formData.businessType,
          email: formData.email,
          phone: formData.phone,
        }
      }
    };

    const response = await fetch(PROXY_API_BASE + "/api/payment/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to create order" }));
      throw new Error(error.error || "Failed to create payment order");
    }

    const result = await response.json();
    return {
      ...result,
      customerId
    };
  }

  /**
   * Verify payment with local proxy
   */
  async function verifyPayment(razorpayResponse) {
    const payload = {
      razorpayOrderId: razorpayResponse.razorpay_order_id,
      razorpayPaymentId: razorpayResponse.razorpay_payment_id,
      razorpaySignature: razorpayResponse.razorpay_signature
    };

    const response = await fetch(PROXY_API_BASE + "/api/payment/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Verification failed" }));
      throw new Error(error.error || "Payment verification failed");
    }

    return response.json();
  }

  /**
   * Load Razorpay Checkout script
   */
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
      script.onerror = () => reject(new Error("Failed to load Razorpay Checkout script"));
      document.head.appendChild(script);
    });
  }

  /**
   * Open Razorpay Checkout
   */
  function openRazorpayCheckout(orderData, formData) {
    return new Promise((resolve, reject) => {
      const options = {
        key: window.RAZORPAY_KEY_ID || orderData.keyId,
        amount: orderData.amountPaise,
        currency: orderData.currency,
        name: "SEAI",
        description: "Website - " + orderData.order.planName,
        order_id: orderData.razorpayOrderId,
        handler: function (response) {
          resolve(response);
        },
        prefill: {
          name: formData.businessName,
          email: formData.email,
          contact: formData.phone,
        },
        notes: {
          internal_order_id: orderData.order.id,
          plan_id: formData.plan
        },
        theme: {
          color: "#0a0a0b"
        },
        modal: {
          ondismiss: function () {
            reject(new Error("Payment cancelled by user"));
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    });
  }

  /**
   * Show loading state
   */
  function showLoading(button, text) {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = text;
  }

  /**
   * Hide loading state
   */
  function hideLoading(button) {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  /**
   * Show error message
   */
  function showError(message) {
    // Remove existing error
    const existing = document.querySelector(".payment-error");
    if (existing) existing.remove();

    const errorEl = document.createElement("div");
    errorEl.className = "payment-error";
    errorEl.setAttribute("role", "alert");
    errorEl.innerHTML = 
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<line x1="12" y1="8" x2="12" y2="12"/>' +
        '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
      '</svg>' +
      '<span>' + message + '</span>';

    const formSection = document.querySelector(".intake-form-section");
    if (formSection) {
      formSection.insertBefore(errorEl, formSection.firstChild);
      errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /**
   * Main payment flow
   */
  async function initiatePayment(formData) {
    const submitBtn = document.getElementById("submit-btn");
    if (!submitBtn) return;

    showLoading(submitBtn, "Creating order...");

    try {
      // Step 1: Create order via local proxy
      const orderData = await createPaymentOrder(formData);

      showLoading(submitBtn, "Opening payment...");

      // Step 2: Load Razorpay script
      await loadRazorpayScript();

      // Step 3: Open Razorpay Checkout
      const razorpayResponse = await openRazorpayCheckout(orderData, formData);

      showLoading(submitBtn, "Verifying payment...");

      // Step 4: Verify payment server-side via proxy
      const verificationResult = await verifyPayment(razorpayResponse);

      // Step 5: Show success
      showPaymentSuccess(verificationResult, orderData);

    } catch (err) {
      hideLoading(submitBtn);
      
      if (err.message === "Payment cancelled by user") {
        showError("Payment was cancelled. You can try again when ready.");
      } else {
        showError(err.message || "Payment failed. Please try again or contact support.");
      }
    }
  }

  /**
   * Show loading state
   */
  function showLoading(button, text) {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = text;
  }

  /**
   * Hide loading state
   */
  function hideLoading(button) {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  /**
   * Show error message
   */
  function showError(message) {
    // Remove existing error
    const existing = document.querySelector(".payment-error");
    if (existing) existing.remove();

    const errorEl = document.createElement("div");
    errorEl.className = "payment-error";
    errorEl.setAttribute("role", "alert");
    errorEl.innerHTML = 
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<line x1="12" y1="8" x2="12" y2="12"/>' +
        '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
      '</svg>' +
      '<span>' + message + '</span>';

    const formSection = document.querySelector(".intake-form-section");
    if (formSection) {
      formSection.insertBefore(errorEl, formSection.firstChild);
      errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /**
   * Show payment success state
   */
  function showPaymentSuccess(verificationResult, orderData) {
    const heroEl = document.querySelector(".intake-hero");
    const formSectionEl = document.querySelector(".intake-form-section");
    if (heroEl) heroEl.hidden = true;
    if (formSectionEl) formSectionEl.hidden = true;

    const successEl = document.getElementById("intake-success");
    if (successEl) {
      successEl.hidden = false;
      successEl.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
      
      // Update success message with payment details
      const businessEl = document.getElementById("success-business");
      const planEl = document.getElementById("success-plan");
      const emailEl = document.getElementById("success-email");
      const refEl = document.getElementById("success-ref");

      if (businessEl) businessEl.textContent = "Your Business";
      if (planEl) planEl.textContent = orderData.order.planName + " - \\u20B9" + (orderData.amountPaise / 100).toLocaleString();
      if (emailEl) emailEl.textContent = "your email";
      if (refEl) refEl.textContent = "Order: " + orderData.order.id + " | Payment: " + (verificationResult.payment?.id || "pending");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Export for use in intake.js
  window.SEAIPayment = {
    initiatePayment,
    createPaymentOrder,
    verifyPayment,
    loadRazorpayScript
  };
})();