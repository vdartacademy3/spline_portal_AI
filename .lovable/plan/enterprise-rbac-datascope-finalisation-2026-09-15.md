# Enterprise RBAC + DataScope finalisation

Keep every existing module and the current design. Change only the access-control layer, add the Super Admin portal pages, and make the AI obey the same rules.

## What exists today

- The five roles already exist, and each user's role row already carries a data scope (SELF … GLOBAL).
- Access rules in the database are coarse: "is HR", "is admin", "my manager". The stored data scope is never actually used, and there is no permission list.
- Navigation hides items by role, but a Super Admin has no dedicated portal and there is no real user-access administration screen.

## 1. Real DataScope enforcement (database)

Add scope resolution in the database so every read is limited by the signed-in person's scope, not just their role:

- A function returning a person's highest scope, and a function answering "is this employee inside my scope?" covering SELF, DIRECT_REPORTS (including indirect reports down the reporting tree), DEPARTMENT, LOCATION, LEGAL_ENTITY, ORGANIZATION and GLOBAL.
- Replace the existing employee-visibility rule with the scope-aware one; every table that references an employee (attendance, leave, goals, reviews, documents, onboarding, tickets) inherits it automatically.
- Recruitment, knowledge base and analytics reads become permission-checked instead of blanket "any HR person".

## 2. Permissions

Add a permission catalogue and a role-to-permission table (view/manage employee, attendance, leave, performance, recruitment, onboarding, documents, helpdesk, analytics, knowledge, users, organization, audit, AI, plus a separate sensitive-data permission for compensation-type fields).

- Seed sensible defaults per role; HR Staff gets only what is explicitly granted.
- A database check function is used inside access rules, so revoking a permission actually blocks the data, not just the menu item.
- Super Admin protection: nobody can grant, remove or self-assign the Super Admin role except an existing Super Admin, enforced by a database trigger, and lower roles can never edit permissions.

## 3. Initial Super Admin (VdartAcademy)

- The account is created server-side from a one-time secure setup endpoint using an admin-only password secret you provide. No password anywhere in the app code, and the endpoint refuses to run once the account exists.
- The account gets role Super Admin with GLOBAL scope and is linked to a profile so sign-in lands on the Super Admin portal, never the employee dashboard.

## 4. Super Admin portal

A dedicated portal shell for Super Admin with: Dashboard, Organization, User Access, Roles & Permissions, AI Configuration, Knowledge Base, Audit Logs, Settings. Existing organization, knowledge and audit pages are reused inside it rather than rebuilt.

## 5. User Access page

A full administration table: full name, work email, role, employee ID, department, location, manager, data scope, status, last login, created date — with filters for role, department, location and status, and actions to view, edit, change role, change scope, disable and reactivate. Every action goes through an authorised server call, not a direct browser write.

## 6. Role-specific dashboards

Split the dashboard by role: Super Admin sees system/organisation health, HR Admin sees HR operations, HR Staff sees only permitted modules, Manager sees team-only figures, Employee sees self-service. Organisation-wide totals are removed from restricted roles.

## 7. AI follows the same rules

The Copilot's data gathering is already run as the signed-in user, so it inherits scope. On top of that: it checks permissions before fetching each data area, omits areas the person cannot see, and returns an explicit refusal line for restricted requests such as salary. Sensitive fields are stripped unless the sensitive-data permission is held.

## 8. Audit

Record actor, action, target, before value, after value, result and timestamp for user created, role changed, scope changed, user disabled/reactivated, permission changed, employee updated, and each AI query, proposal, approval, rejection and execution.

## 9. Verification

Browser-test the twelve security checks in your list — including direct URL access to forbidden pages, one manager trying to read another manager's team, HR Staff without a permission, and an AI request for salary data — and confirm the Super Admin always lands on the Super Admin portal.

## Technical notes

- New migration adds `permissions`, `role_permissions`, scope/permission SQL functions, a Super Admin protection trigger, and replaces the coarse RLS policies; grants included for every new table.
- Privileged operations (create user, change role/scope, disable) move into authenticated TanStack server functions using the admin client after verifying the caller is Super Admin.
- One-time bootstrap route under `src/routes/api/public/` guarded by a setup secret; it self-disables after the account exists.
