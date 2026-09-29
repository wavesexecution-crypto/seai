/* ============================================================
   SEAI Public Site Configuration
   Runtime configuration for payment integration
   ============================================================ */

(function () {
  "use strict";

  // Payment API Configuration - public values only
  window.SEAI_PAYMENT_API_BASE = window.SEAI_PAYMENT_API_BASE || "https://payments.seai.store/api/v1";

  // Razorpay public key (key_id) - safe to expose in frontend
  // Set via build: __RAZORPAY_KEY_ID__
  window.RAZORPAY_KEY_ID = window.RAZORPAY_KEY_ID || "";

  // Feature flags
  window.SEAI_FEATURES = {
    paymentEnabled: window.SEAI_FEATURES?.paymentEnabled !== false,
    razorpayTestMode: window.SEAI_FEATURES?.razorpayTestMode === true,
  };

  console.log("[SEAI Config] Payment API:", window.SEAI_PAYMENT_API_BASE);
  console.log("[SEAI Config] Razorpay Test Mode:", window.SEAI_FEATURES.razorpayTestMode);
})();