export type AppRole = "super_admin" | "hr_admin" | "hr_staff" | "manager" | "employee";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  hr_staff: "HR Staff",
  manager: "Manager",
  employee: "Employee",
};

export const ROLE_RANK: Record<AppRole, number> = {
  super_admin: 5,
  hr_admin: 4,
  hr_staff: 3,
  manager: 2,
  employee: 1,
};

export function primaryRole(roles: AppRole[]): AppRole {
  if (!roles.length) return "employee";
  return [...roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0]!;
}

export const HR_ROLES: AppRole[] = ["super_admin", "hr_admin", "hr_staff"];
export const ADMIN_ROLES: AppRole[] = ["super_admin", "hr_admin"];

export function isHr(roles: AppRole[]) {
  return roles.some((r) => HR_ROLES.includes(r));
}
export function isAdmin(roles: AppRole[]) {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}
export function isManager(roles: AppRole[]) {
  return roles.includes("manager") || isHr(roles);
}

/** Every navigable module and the roles allowed to open it. */
export const MODULE_ACCESS = {
  dashboard: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  copilot: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  employees: ["super_admin", "hr_admin", "hr_staff", "manager"],
  recruitment: ["super_admin", "hr_admin", "hr_staff"],
  onboarding: ["super_admin", "hr_admin", "hr_staff"],
  attendance: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  shifts: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  leave: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  performance: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  documents: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  helpdesk: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  expenses: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  offboarding: ["super_admin", "hr_admin", "hr_staff", "manager"],
  "ai-actions": ["super_admin", "hr_admin", "hr_staff", "manager"],
  analytics: ["super_admin", "hr_admin", "hr_staff", "manager"],
  letters: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  assets: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  training: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  compliance: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
  payroll: ["super_admin", "hr_admin", "hr_staff", "employee"],
  organization: ["super_admin", "hr_admin"],
  users: ["super_admin", "hr_admin"],
  knowledge: ["super_admin", "hr_admin", "hr_staff"],
  audit: ["super_admin", "hr_admin"],
  settings: ["super_admin", "hr_admin", "hr_staff", "manager", "employee"],
} as const satisfies Record<string, readonly AppRole[]>;

export type ModuleKey = keyof typeof MODULE_ACCESS;

/** Data scopes, ordered from narrowest to widest. */
export type DataScope =
  | "SELF"
  | "DIRECT_REPORTS"
  | "DEPARTMENT"
  | "LOCATION"
  | "LEGAL_ENTITY"
  | "ORGANIZATION"
  | "GLOBAL";

export const SCOPE_LABEL: Record<DataScope, string> = {
  SELF: "Self only",
  DIRECT_REPORTS: "Direct reports",
  DEPARTMENT: "Department",
  LOCATION: "Location",
  LEGAL_ENTITY: "Legal entity",
  ORGANIZATION: "Organization",
  GLOBAL: "Global",
};

export const SCOPE_RANK: Record<DataScope, number> = {
  SELF: 1,
  DIRECT_REPORTS: 2,
  DEPARTMENT: 3,
  LOCATION: 4,
  LEGAL_ENTITY: 5,
  ORGANIZATION: 6,
  GLOBAL: 7,
};

export const ALL_SCOPES: DataScope[] = [
  "SELF",
  "DIRECT_REPORTS",
  "DEPARTMENT",
  "LOCATION",
  "LEGAL_ENTITY",
  "ORGANIZATION",
  "GLOBAL",
];

export function widestScope(scopes: DataScope[]): DataScope {
  if (!scopes.length) return "SELF";
  return [...scopes].sort((a, b) => SCOPE_RANK[b] - SCOPE_RANK[a])[0]!;
}

/** Permission required to open each module. Null = available to every signed-in user. */
export const MODULE_PERMISSION: Record<ModuleKey, string | null> = {
  dashboard: null,
  copilot: "use_ai",
  employees: "view_employee",
  recruitment: "view_recruitment",
  onboarding: "view_onboarding",
  attendance: null,
  shifts: "view_attendance",
  leave: null,
  performance: null,
  documents: null,
  helpdesk: "view_helpdesk",
  expenses: null,
  offboarding: "view_offboarding",
  "ai-actions": "manage_ai",
  analytics: "view_analytics",
  letters: "view_letters",
  assets: "view_assets",
  training: "view_training",
  compliance: "view_compliance",
  payroll: "view_payroll",
  organization: "manage_organization",
  users: "manage_users",
  knowledge: "view_knowledge",
  audit: "view_audit",
  settings: null,
};

export function hasPermission(roles: AppRole[], permissions: string[], code: string) {
  return roles.includes("super_admin") || permissions.includes(code);
}

/**
 * Modules a role may open for its *own* self-service data without holding the
 * module-wide permission. `payroll` already lists `employee` in
 * `MODULE_ACCESS` because an employee is entitled to their own salary and
 * payslips; every other role there still needs `view_payroll`. This only
 * unlocks the screen — which rows are returned is enforced server-side by
 * `hr.policies`.
 */
const SELF_SERVICE_ROLES: Partial<Record<ModuleKey, readonly AppRole[]>> = {
  payroll: ["employee"],
};

export function canAccess(module: ModuleKey, roles: AppRole[], permissions?: string[]) {
  if (roles.includes("super_admin")) return true;
  const allowed = MODULE_ACCESS[module] as readonly AppRole[];
  if (!roles.some((r) => allowed.includes(r))) return false;
  const required = MODULE_PERMISSION[module];
  if (!required || !permissions) return true;
  if (permissions.includes(required)) return true;
  const selfService = SELF_SERVICE_ROLES[module];
  return !!selfService && roles.some((r) => selfService.includes(r));
}
