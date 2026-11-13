/**
 * RBAC roles for SEAI staff. Customers carry 'customer' (the default).
 * Staff roles are granted out-of-band by an admin (SQL or the staff UI):
 *   UPDATE users SET role='admin' WHERE email='...';
 *
 * Roles
 *   owner              — full business visibility (super-role, like admin)
 *   administrator      — full system access (super-role, like admin)
 *   admin              — full access, incl. role management + finances (legacy)
 *   sales              — leads, pipeline, proposals, inquiries
 *   account_manager    — clients, onboarding, projects, approvals (no finances)
 *   project_manager    — projects, tasks, delivery, milestones (no finances)
 *   marketing          — campaigns, content approvals, social/ads reporting
 *   designer           — creative deliverables, content approvals (no finances)
 *   developer          — website projects, technical deliverables
 *   finance            — invoices, payments, expenses, financial reports
 *   support            — support tickets, client communication (no finances)
 */

export const STAFF_ROLES = [
  'owner',
  'administrator',
  'admin',
  'sales',
  'account_manager',
  'project_manager',
  'marketing',
  'designer',
  'developer',
  'finance',
  'support',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const ALL_ROLES = ['customer', ...STAFF_ROLES] as const;

export const SUPER_ROLES = ['owner', 'administrator', 'admin'];

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export function isSuperRole(role: string | null | undefined): boolean {
  return !!role && SUPER_ROLES.includes(role);
}

export function normalizeRole(role: string | null | undefined): string {
  return isStaffRole(role) || role === 'customer' ? (role as string) : 'customer';
}

/** Role capability sets. Kept coarse on purpose — see /api/staff routes. */
export const CAN = {
  leads: ['owner', 'administrator', 'admin', 'sales', 'account_manager'],
  clients: ['owner', 'administrator', 'admin', 'account_manager', 'sales', 'finance'],
  projects: ['owner', 'administrator', 'admin', 'account_manager', 'project_manager', 'marketing', 'designer', 'developer'],
  approvals: ['owner', 'administrator', 'admin', 'account_manager', 'project_manager', 'marketing', 'designer', 'developer'],
  finance: ['owner', 'administrator', 'admin', 'finance'],
  reports: ['owner', 'administrator', 'admin', 'account_manager', 'project_manager', 'marketing', 'finance'],
  settings: ['owner', 'administrator', 'admin'],
  proposals: ['owner', 'administrator', 'admin', 'sales', 'account_manager'],
  services: ['owner', 'administrator', 'admin', 'marketing'],
  social: ['owner', 'administrator', 'admin', 'marketing'],
  campaigns: ['owner', 'administrator', 'admin', 'marketing'],
  support: ['owner', 'administrator', 'admin', 'account_manager', 'support'],
} as const;

export function can(role: string | null | undefined, capability: keyof typeof CAN): boolean {
  const r = normalizeRole(role);
  if (isSuperRole(r)) return true;
  return (CAN[capability] as readonly string[]).includes(r);
}
