# Spine AI — Final End-to-End Completion

Using the audit report as the source of truth. Nothing working gets rewritten; only verified gaps get built. Work is staged so security lands first and the public recruitment experience lands as one connected chain.

## Stage 1 — Security and data isolation (highest priority)

- Helpdesk comments are currently readable by every signed-in user — restrict to the ticket's participants and authorised HR.
- The "Organization" data scope currently grants access without checking the organisation — enforce a real organisation match everywhere it is used.
- Recruitment data (requisitions, candidates) currently ignores scope entirely — add organisation and scope filtering.
- Retire the one-time Super Admin setup endpoint so it can never run again.
- Tighten employee-record updates so a user cannot move an employee outside their own scope.
- Make audit records server-written and non-forgeable; add missing indexes on relationship columns.

## Stage 2 — Fix broken/incomplete existing workflows

- Leave: calculate days on the server, reject overlapping requests and insufficient balance, support cancel/withdraw with balance reversal, keep balance changes transaction-safe.
- Performance: allow authorised managers/HR to author reviews in the app.
- Knowledge base: add publish/unpublish so policies can actually reach the Copilot, and re-index automatically on publish.
- Documents: make document verification an actual action.
- Align the Copilot and AI Configuration pages so the menu and the page agree on who may enter.
- Add confirmation prompts to consequential actions (disable user, role change, leave decision, status changes).

## Stage 3 — Recruitment / ATS backend

New database structure (reusing existing organisation, department, location, employee tables):

- Requisition lifecycle fields: draft → pending approval → approved → published → closed, plus public slug, employment type, work mode, experience, skills, salary range, openings, responsibilities.
- `applications` table linking candidate + requisition (candidate and application stay separate from employee/user).
- `interviews` with panel, schedule, type, status, and `interview_feedback` scorecards.
- `offers` with compensation, start date, approval, send, accept/reject/expire.
- Resume storage in a private bucket; candidate-facing uploads go through a server function, never direct public write.
- Stage pipeline: applied → screening → HR review → shortlisted → assessment → interview → selected → offer → hired, plus rejected/withdrawn/on-hold. Stage changes permission-checked, audited, and notified.

## Stage 4 — Public website and candidate experience

- `/` becomes a real public landing page (brand, hero, capabilities, AI section, security section, careers CTA, footer) with a public header and no internal navigation. Signed-in users keep landing in the app.
- `/careers` — published, open jobs only, with search and filters.
- `/careers/:slug` — public-safe job details + Apply.
- `/careers/:slug/apply` — public application form with resume upload, no account required.
- `/application-success` — confirmation.
- All public reads/writes go through dedicated public endpoints that only ever expose published jobs and never touch internal data.

## Stage 5 — Candidate 360, hiring, and conversion

- Candidate detail view for HR: profile, resume, application, screening, pipeline, interviews, feedback, notes, activity.
- "Convert to Employee" action available only after an accepted offer: creates the employee record linked to organisation/department/location/manager, without granting app access automatically and without duplicating records.

## Stage 6 — AI recruitment

- Resume parsing and skill/experience/qualification extraction through the existing AI gateway.
- Requirement-match screening with written evidence; advisory only, HR decides. No protected characteristics used.
- AI actions become real: proposal → permission and scope check → confirmation → server execution → audit → notification.

## Stage 7 — Dashboards, notifications, audit, polish

- Role-specific dashboards from live scoped data (Super Admin / HR Admin / Manager / Employee).
- Recruitment and attendance notification events added to the existing notification system.
- Audit filtering and export; server-side pagination on large lists.
- Remove dead buttons and misleading "AI" labels; consistent loading/error/empty states.

## Stage 8 — Verification

Real end-to-end checks with the existing five test accounts plus an anonymous visitor: RBAC per role, organisation isolation, leave lifecycle, the full requisition → publish → public apply → screen → interview → offer → hire → employee chain, candidate cannot reach internal data, AI respects role and scope.

## Notes

- Payroll and shifts are large separate domains that do not exist yet in the database. They are not in this plan; I will say plainly what is missing rather than fake them. Tell me if you want them added as a later stage.
- Each stage is verified before the next begins, and I report what was fixed, added, and what stays limited.
