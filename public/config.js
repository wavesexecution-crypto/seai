/* ============================================================
   SEAI Public Site Configuration
   Client-visible configuration for the payment integration.

   Everything here is public by definition: it is served to the browser.
   No service key, webhook secret, or Razorpay key secret may appear in this
   file. The Razorpay `key_id` is a publishable identifier and is supplied by
   the order response at runtime, so it does not need to be configured here.
   ============================================================ */

(function () {
  "use strict";

  // Same-origin by design. The browser never talks to seai.payments directly:
  // /api/payment/* is our own server-side proxy that holds the service key.
  window.SEAI_PAYMENT_API_BASE = window.SEAI_PAYMENT_API_BASE || "/api/payment";

  // Feature flags.
  window.SEAI_FEATURES = {
    paymentEnabled: window.SEAI_FEATURES?.paymentEnabled !== false,
    razorpayTestMode: window.SEAI_FEATURES?.razorpayTestMode === true,
  };
})();
