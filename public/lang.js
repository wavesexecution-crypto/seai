/* SEAI VX presentation language.
 * The ONLY place internal identifiers map to customer-facing words.
 * Backend tool names are never renamed — this file translates at render time. */
'use strict';
window.SEAI_LANG = {
  tools: {
    'store.get': { label: 'Store Overview', blurb: "See your store's identity, plan, and currency" },
    'themes.get': { label: 'Inspect Store Theme', blurb: 'Look at the active storefront theme' },
    'products.list': { label: 'View Products', blurb: 'Browse everything in your catalog' },
    'products.get': { label: 'View Product', blurb: "Open a single product's details" },
    'products.create': { label: 'Create Product', blurb: 'Create a new product in your store' },
    'products.update': { label: 'Edit Product', blurb: 'Update product information' },
    'products.archive': { label: 'Archive Product', blurb: 'Remove a product from active merchandising' },
    'inventory.get': { label: 'View Inventory', blurb: 'See stock levels across locations' },
    'inventory.ensure': { label: 'Set Opening Stock', blurb: 'Declare starting stock for a new product' },
    'inventory.update': { label: 'Adjust Inventory', blurb: 'Correct stock quantities' },
    'orders.list': { label: 'View Orders', blurb: 'Browse recent orders' },
    'orders.get': { label: 'View Order', blurb: 'Open a single order' },
    'customers.list': { label: 'View Customers', blurb: 'Browse your customers' },
    'customers.get': { label: 'View Customer', blurb: 'Open a single customer profile' },
    'discounts.list': { label: 'View Discounts', blurb: 'See your discount codes' },
    'discounts.create': { label: 'Create Discount', blurb: 'Create a percentage discount code' },
    'discounts.disable': { label: 'Disable Discount', blurb: 'Turn off a discount code' },
    'collections.list': { label: 'View Collections', blurb: 'See how products are grouped' },
    'collections.create': { label: 'Create Collection', blurb: 'Group products into a new collection' },
    'collections.addProducts': { label: 'Fill Collection', blurb: 'Place products into a collection' },
    'collections.update': { label: 'Edit Collection', blurb: 'Rename or re-describe a collection' },
    'content.list': { label: 'View Store Content', blurb: "See your store's pages" },
    'content.create': { label: 'Create Store Page', blurb: 'Publish a new information page' },
    'content.update': { label: 'Edit Store Content', blurb: 'Edit page content' },
    'analytics.get': { label: 'View Analytics', blurb: 'See revenue, orders, and average order value' },
    'experiments.create': { label: 'Create Experiment', blurb: 'Start a controlled test of one change' },
    'experiments.evaluate': { label: 'Evaluate Experiment', blurb: 'Check whether a test worked' },
    'experiments.rollback': { label: 'Roll Back Experiment', blurb: 'Undo a test and restore what was there before' },
    'strategy.propose': { label: 'Write Store Strategy', blurb: "Define what this store should become and why" },
    'themes.upload': { label: 'Upload Theme File', blurb: 'Add one reviewed file to the storefront theme' },
    'policies.update': { label: 'Publish Store Policy', blurb: 'Publish a refund, shipping, or terms policy' },
    'strategy.get': { label: 'View Store Strategy', blurb: "Read this store's current strategy" },
    'portfolio.get': { label: 'Compare Stores', blurb: 'Compare all six stores side by side' },
  },
  risk: { low: 'Low risk', medium: 'Medium risk', high: 'High risk', critical: 'Critical risk' },
  kind: {
    command: 'Command', test: 'Test',
    'schedule:daily': 'Daily review', 'schedule:inventory': 'Inventory check', 'schedule:experiments': 'Experiment review',
  },
  autonomy: { OBSERVE: 'Observe', ASSIST: 'Assist', EXECUTE_SAFE: 'Execute safe', AUTONOMOUS: 'Autonomous' },
  status: { completed: 'Completed', running: 'Running', failed: 'Failed' },
  strategy: { unformed: 'No strategy yet', proposed: 'Proposed', active: 'Active', retired: 'Retired' },
  policy: { allow: 'Allowed', require_confirmation: 'Waiting for approval', deny: 'Blocked' },
  caps: { tools: 'Tool use', reasoning: 'Reasoning', vision: 'Vision', 'structured-output': 'Structured answers', 'long-context': 'Long context' },
  groupWord: {
    store: 'store', themes: 'theme', products: 'products', inventory: 'inventory', orders: 'orders',
    customers: 'customers', discounts: 'discounts', collections: 'collections', content: 'pages',
    analytics: 'analytics', experiments: 'experiments', strategy: 'strategy', portfolio: 'portfolio',
  },
};

window.SEAI_TXT = {
  tool(id) {
    const t = window.SEAI_LANG.tools[id];
    if (t) return t.label;
    return String(id).replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  },
  blurb(id, fallback) {
    const t = window.SEAI_LANG.tools[id];
    return t ? t.blurb : (fallback || 'A store capability');
  },
  risk(r) { return window.SEAI_LANG.risk[r] || 'Unknown risk'; },
  access(confirm, reversible) {
    let s = confirm ? 'Confirmation required' : 'Automatic';
    if (reversible === false) s += ' · Irreversible';
    return s;
  },
  kind(k) { return window.SEAI_LANG.kind[k] || String(k || '').replace(/^schedule:/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Run'; },
  autonomy(a) { return window.SEAI_LANG.autonomy[a] || String(a || '').toLowerCase().replace(/_/g, ' '); },
  status(s) { return window.SEAI_LANG.status[s] || String(s || ''); },
  strategy(s) { return window.SEAI_LANG.strategy[s] || String(s || ''); },
  policy(p) { return window.SEAI_LANG.policy[p] || String(p || ''); },
  cap(c) { return window.SEAI_LANG.caps[c] || c; },
  groupWord(prefix) { return window.SEAI_LANG.groupWord[prefix] || prefix; },
};
