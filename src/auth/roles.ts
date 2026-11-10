/**
 * RBAC roles for SEAI staff. Customers carry 'customer' (the default).
 * Staff roles are granted out-of-band by an admin (SQL or the staff UI):
 *   UPDATE users SET role='admin' WHERE email='...';
 *
 * Roles
 *   admin            — full access, incl. role management + finances
 *   sales            — leads, pipeline, proposals, inquiries
 *   account_manager  — clients, onboarding, projects, approvals (no finances)
 *   marketing        — campaigns, content approvals, social/ads reporting
 *   designer         — creative deliverables, content approvals (no finances)
 *   developer        — website projects, technical deliverables
 *   finance          — invoices, payments, expenses, financial reports
 */

export const STAFF_ROLES = [
  'admin',
  'sales',
  'account_manager',
  'marketing',
  'designer',
  'developer',
  'finance',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const ALL_ROLES = ['customer', ...STAFF_ROLES] as const;

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export function normalizeRole(role: string | null | undefined): string {
  return isStaffRole(role) || role === 'customer' ? (role as string) : 'customer';
}

/** Role capability sets. Kept coarse on purpose — see /api/staff routes. */
export const CAN = {
  leads: ['admin', 'sales', 'account_manager'],
  clients: ['admin', 'account_manager', 'sales', 'finance'],
  projects: ['admin', 'account_manager', 'marketing', 'designer', 'developer'],
  approvals: ['admin', 'account_manager', 'marketing', 'designer', 'developer'],
  finance: ['admin', 'finance'],
  reports: ['admin', 'account_manager', 'marketing', 'finance'],
  settings: ['admin'],
} as const;

export function can(role: string | null | undefined, capability: keyof typeof CAN): boolean {
  const r = normalizeRole(role);
  if (r === 'admin') return true;
  return (CAN[capability] as readonly string[]).includes(r);
}
