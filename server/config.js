/**
 * SEAI Public Payment Proxy Configuration
 * Server-side only - never exposed to browser
 */

const config = {
  // Payment API base URL
  paymentApiBase: process.env.SEAI_PAYMENT_API_BASE || 'https://payments.seai.store/api/v1',

  // Service key for authenticating with seai.payments
  // Must be kept secret - never exposed to browser
  serviceKey: process.env.SEAI_PUBLIC_SERVICE_KEY || '',

  // Allowed origin for CORS
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'https://seai.store',

  // seai.storage control plane for intake uploads (server-side only).
  // Browsers receive only signed upload URLs + file IDs, never these values.
  storageApiBase: process.env.SEAI_STORAGE_API_BASE || 'http://localhost:4100',
  storageServiceName: process.env.SEAI_STORAGE_SERVICE_NAME || 'seai-public',
  storageServiceKey: process.env.SEAI_STORAGE_SERVICE_KEY || '',
};

export { config };