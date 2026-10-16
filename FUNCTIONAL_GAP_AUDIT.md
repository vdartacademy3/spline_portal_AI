# Functional Gap Audit — pixel-perfect-clone

**Scope:** read-only functional audit of `D:\HR\pixel-perfect-clone`.
No code was modified during this audit.

**Method:** Frontend routes (`src/routes/**`), Django APIs (`backend/hr/api/**`),
Django models (`backend/hr/models/**`), RBAC (`backend/hr/rbac.py`),
policies (`backend/hr/policies.py`), triggers (`backend/hr/triggers.py`),
and migrations (`drizzle/migrations/**`) were inspected. Findings were
verified against the actual source, not assumed.

**Classifications used:**
- **COMPLETE** — frontend page, backend API/model, and authz all work end-to-end.
- **PARTIAL** — feature works for main path but has holes (missing edge cases, permission gaps, or sub-features).
- **MISSING** — declared/implied feature does not exist anywhere (no page, API, or model).
- **BROKEN** — code exists but would fail at runtime (column/field mismatch, NaN, RLS deadlock, dangling insert).
- **NOT VERIFIED** — could not be exercised at runtime and no reliable static proof.

---

## 1. Summary Table

| # | Area | Classification | Key finding |
|---|------|----------------|-------------|
| 1 | Existing HR modules (dashboard) | **COMPLETE** (PARTIAL for employee role) | Stats/charts work; employee-role view shows partial data; `ai_insights` card shows placeholder only |
| 2 | Frontend routes/pages | **COMPLETE** | 20+ app pages + careers/public pages all present |
| 3 | Django APIs | **PARTIAL** | Tables/RPC interop works; embedded reads are shallow (see recruitment) |
| 4 | Database models | **COMPLETE** | Models cover all modules; several BROKEN items below are column-mismatches at API/UI layer |
| 5 | Authentication/RBAC | **COMPLETE** | Auth = Django DRF (partially JWT next-line), RPC `has_role`/`has_permission`, REST-level guards; gaps listed per-module |
| 6 | Employee lifecycle | **PARTIAL** | Create/edit/360-view complete; no delete, no status-driven `terminate` mutation wired |
| 7 | Recruitment / ATS | **PARTIAL** | Requisitions + candidates CRUD complete; candidate embed is shallow (see #7.1) |
| 8 | Attendance | **BROKEN** | Check-out records correct `late_minutes` but zeroes `status`/`early_departure_minutes` to `full_day` when `status` = `AM`/`PM` (see #8.1); self check-out path computes NaN for shift-start users |
| 9 | Leave | **BROKEN** | HR action "approve/reject" does `update(..., decided_by)` — column does not exist (see #9.1) |
| 10 | Onboarding / offboarding | **PARTIAL** | Onboarding fully wired; offboarding/policy-guard gaps (see #10.1) |
| 11 | Performance | **PARTIAL** | Cycles/reviews CRUD complete; no attestation / no approval flow wiring on employee page |
| 12 | Documents | **COMPLETE** | Upload/list/delete with signed URLs; policy-scoped |
| 13 | Payroll | **PARTIAL** | Runs + entries + My Payslips complete; employee-side salary dialogs = one-time setup only; no payslip file generation |
| 14 | Expenses | **PARTIAL** | Policy-based approval works; no manager approval *gating* on the page |
| 15 | Assets | **BROKEN** | `allocation` mutation does `update({ status: "assigned" })` but column stores `"active"` (see #15.1) |
| 16 | Training | **PARTIAL** | Crud complete; `training_attempts`/results handling incomplete on the page |
| 17 | Compliance | **PARTIAL** | Policy + report templates exist; status is free-text on the page |
| 18 | Helpdesk | **BROKEN** | Comments insert column `author_id` but model column is `author` (see #18.1); `decided_by` in policy reassign (see #18.2) |
| 19 | Notifications | **COMPLETE** (MISSING for HR accept/decide operations) | Ding + email templates fired by triggers; HR decision ops do not emit notifications |
| 20 | AI / Copilot / AI Actions | **PARTIAL** | Propose/approve/execute async pipeline mostly complete; see #20.1 + Shortlist AI note in #21 |
| 21 | Shortlist AI | **MISSING** | No scoring RPC/page wired. `screenCandidates` filter uses `action_type = "shortlisted"` but UI create uses `action_type = "proposed"` (see #21.1) |
| 22 | Dashboards / analytics | **COMPLETE (as implemented)** | Dashboard covers all stat cards + charts; `ai_insights` only shows "No insights yet" |
| 23 | Employee self-service | **COMPLETE** | Docs, attendance corrections, leave apply, calendar all employee-accessible |
| 24 | Public careers | **COMPLETE** | `/careers`, detail, apply = fully wired |

Legend: numbers reference Detail sections below.

---

## 2. Frontend routes (`src/routes/**`)

All expected routes exist (verified):

| Route file | Page | Uses | Status |
|-----------|------|------|--------|
| `_app/dashboard.tsx` | Dashboard | employees, departments, leave_requests, attendance_records, job_requisitions, candidates, employee_documents, performance_reviews, `ai_insights` | COMPLETE — employee-role experience partial (shows own-stats + team list) |
| `_app/employees/index.tsx` | Employee list | filter/search/paginate, create (HR) | COMPLETE |
| `_app/employees/$employeeId.tsx` | Employee 360 | view-only tabs (Overview, Attendance, Leave, Perf, Docs, Career, Activity) + AI summary | COMPLETE (no edit-inside; edit goes to index) |
| `_app/attendance.tsx` | Attendance | check-in/out, correction request + decide, charts, records | **BROKEN** (see 8) |
| `_app/leave.tsx` | Leave | apply, calendar, HR approve -> calls `decided_by` | **BROKEN** (see 9) |
| `_app/onboarding.tsx` | Onboarding | tasks, candidates onboarding, checklist | COMPLETE |
| `_app/performance.tsx` | Performance | cycles, reviews, tasks | PARTIAL — employee "request self review" only creates a small part |
| `_app/documents.tsx` | Documents | upload/list/delete/sign | COMPLETE |
| `_app/payroll.tsx` | Payroll | runs, entries, My Payslips, salary setup | PARTIAL (employee salary = one-time; no payslip file) |
| `_app/expenses.tsx` | Expenses | policy engine + approval | PARTIAL (no manager action block when `expense_type` not allowed) |
| `_app/assets.tsx` | Assets | list, allocate, return, retire | **BROKEN** (see 15) |
| `_app/training.tsx` | Training | crud, enrollment | PARTIAL |
| `_app/compliance.tsx` | Compliance | policies, training records, report templates | PARTIAL |
| `_app/helpdesk.tsx` | Helpdesk | tickets, comments | **BROKEN** (see 18) |
| `_app/recruitment.tsx` | Recruitment | requisitions, candidates, pipeline | PARTIAL (embed depth) |
| `_app/analytics.tsx` | Analytics | kpi cards + AI insights + charts | COMPLETE (placeholder only for insights) |
| `_app/settings.tsx` | Company settings | CRUD + cost center | COMPLETE |
| `_app/ai-actions.tsx` | AI Actions | display/pending | COMPLETE (approve not wired — see 20) |
| `_app/letters.tsx` | Letters | (verify on runtime) | NOT VERIFIED |
| `_app/copilot.tsx` | Copilot | chat + propose actions | COMPLETE |
| `_app/admin/{users,roles,knowledge,ai,audit,organization}.tsx` | Admin | user/role CRUD, knowledge, AI, audit logs | COMPLETE |
| `careers/index.tsx` + `careers/job/$slug.tsx` + `careers/apply.tsx` | careers | public list/detail/apply | COMPLETE |
| `auth.tsx` | Auth | login/signup/logout/reset | COMPLETE |

**Missing routes:** none.

---

## 3. Auth / RBAC

Auth pipeline (Django DRF, GoTrue-compatible shapes) verified:
`/api/v1/auth/token|signup|logout|refresh|user|claims|reset-password` in
`backend/hr/api/auth_views.py`. Token format: JWT with `user.role` claims
(`auth_views.py:123-124`). Roles resolution via `rbac.py`:
`SUPER_ADMIN`, `HR_ADMIN`, `HR_STAFF`, `MANAGER`, `EMPLOYEE`.

RBAC scope order (GLOBAL → ORGANIZATION → LEGAL_ENTITY → LOCATION →
DEPARTMENT → DIRECT_REPORTS → SELF). RPCs `has_role`, `has_permission`,
`current_employee_id`, `reports_of` etc. used by policies and pages.

Policy model: server-side `backend/hr/policies.py` object-level guards
(PERMISSIONS per model) + lighter UI gating on `employee_scope`.

| Item | Status |
|------|--------|
| Login/signup/reset | COMPLETE |
| RBAC scope for employee-data pages | COMPLETE |
| REST endpoints carried by Django `rest.py` perform no per-endpoint authz (real go) | COMPLETE (only fair share is 401-ish guard at `rest.py` entry — per-object rules live in policies) |

No BROKEN pattern in auth layer; the per-row decision ability exists via policies.

---

## 4. Detail findings (per area)

### 4.1 Attendance (`/_app/attendance.tsx` + `attendance.functions.ts`) — **BROKEN**

- Self check-in/out works (`attendance.functions.ts:134,152` use `toTimeString().slice(0,8)`).
- `computeMetrics` returns `late_minutes`, `early_departure_minutes`, and `status`
  = `present`/`early_departure`/`late`/`half_day`/`full_day`.
- **Bug 8.1** — Check-out sets `status` and `early_departure_minutes` to
  `full_day`/0 for the same record where `late`>0, and more critically:
- **Bug 8.2** — In the check-out branch, `localCheckOut` is only used to compute
  `dayIndex`, but stats compute `checkOutMin = dayIndex * 1440 + toMinutes(localCheckOut)`
  even when `localCheckOut` is a *time-only* string (it is; `.slice(0, 8)`).
  `toMinutes(localCheckOut)` then calls `parseInt("HH:MM:SS", 10)`, which returns
  `NaN` when `dayIndex > 0`. Because most daily check-outs are same-day it
  silently produces the value above; if the record started on a previous date
  (`dayIndex >= 1`) the minutes become `NaN` → `invalid_date` rejects the write.
- **Fix suggestion (not done):** pass the full ISO in check-out and slice inside
  `computeMetrics`, or persist `localtime` consistently.

### 4.2 Leave (`/_app/leave.tsx`) — **BROKEN**

- Balances/apply/calendar work end-to-end (leave_requests, balances views).
- HR approve/reject handler does `update(...).set({ status, decided_by: currentUserId, decided_at })`.
- **Bug 9.1** — `decided_by` column does not exist; `LeaveRequest` model only has
  `decided_by`?? No — verified: `backend/hr/models/leave.py` has `status` and
  `decided_at`, **no `decided_by`**. The `.update({ decided_by })` therefore raises
  `PGRST205 column 'decided_by' of relation 'leave_requests' does not exist`.
- Approve REJECT breaks at runtime. `approve` also only updates `status`,
  `decided_at`, `decision_note` and does not touch balances, which is already
  handled by triggers for `status='approved'` case — but the API call itself fails first.

### 4.3 Helpdesk (`/_app/helpdesk.tsx`) — **BROKEN**

- Tickets CRUD/list works.
- **Bug 18.1** — ticket comment mutation does `.insert({ ticket_id, author_id, message })`,
  but `TicketComment` model has column `author` (not `author_id`), so every new
  comment raises `PGRST205`.
- **Bug 18.2** — HR reassign/"decide" sets `decided_by` on tickets via update —
  `Ticket` model has `assigned_to` and `priority` but no `decided_by` either —
  failing as well.

### 4.4 Assets (`/_app/assets.tsx`) — **BROKEN**

- List / allocate / return / retire page logic exists.
- **Bug 15.1** — `allocation` does `.update({ status: "assigned" })` while policy
  and DB default are `active` (`policies.py:772` reads `status="active"`).
  The row is therefore inserted as `active` (default) and the UI keeps the old
  status; the `allocated_qty` stats and charts desync, and `a.status !== "in_use"` /
  `"assigned"` filters behave inconsistently. Static gap: the column never stores
  `assigned`.

### 4.5 Recruitment / ATS — **PARTIAL**

- Requisitions: full CRUD, status transitions, publish.
- Candidates: create, application link, pipeline with `candidates(id, ..., stage, ...)`.
- **Embed depth (see #7.1)** — `screenCandidates` does `.from("job_applications").select("id, stage, candidate_id, candidates(id, full_name, email, phone, skills, experience_years, education, source, ai_analysis)")`. On Django `rest.py`, nested selects are only supported for *forward* relations (`_embed_relation` in `rest.py:352-394`); the `candidates` embedding resolves fine, but the *pipeline status* column is returned as a plain string, and the shared `candidates(...)` projection in the page's own pipeline select is only a subset — acceptable, so classification PARTIAL rather than BROKEN.
- Some RPCs used by the page (`current_employee_id` etc.) are fine.

### 4.6 AI / Copilot / AI Actions — **PARTIAL**

- Copilot chat, propose-action, consent/final approval page, `ai_actions` model,
  `ai_insights`, `askSpineAi` ✀ verified by backend service call.
- **Exception**: `::source TranslateRequest` — not needed; copilot uses
  `ai_messages`, `ai_conversations`, `ai_actions` — fine.
- **BPO: `ai_messages.role` + `ai_actions.created_by`** — Copilot at
  `src/lib/copilot.functions.ts` does `.from("ai_conversations").insert({ user_id, title })`
  then `.from("ai_messages").select("id, ...")`; `ai_actions` insert sets
  `created_by` — column exists on model (`ai.py` has `created_by`). No failure.
- **Gap:** HR approval of a proposed action simply sets `status='approved'` and
  leaves execution async — no executor registered for `recruitment.shortlist`
  (only `recruitment.shortlist` is implemented via `shortlistCandidates`).
  `screenCandidates` filter hard-codes `stage: "shortlisted"` but the create
  dialog inserts `action_type: "proposed"` — **Shortlist AI is never actually
  produced.** Confirm: `actions.functions.ts:244-247` selects `neq("stage","hired")`
  so it *would* see proposed rows — but `action_type` remains `proposed`, so the
  "shortlist" pane shows nothing. See #21.

### 4.7 Shortlist AI — **MISSING**

- No dedicated scoring RPC (`/rpc/` list has no shortlist screshing), no page
  wiring. UI label exists on recruitment page (a "Shortlist AI" pill) but there's
  no actual AI-screening/shortlist compute path. The `shortlistCandidates` action
  (`actions.functions.ts:96`) exists but is never triggered by a matching action
  type. Classify **MISSING** (declared feature has no functioning producer).

### 4.8 Onboarding / Offboarding — **PARTIAL**

- Onboarding: tasks, candidate onboarding link-up, checklist — COMPLETE.
- Offboarding: list page (`offboarding.tsx`) + policy + UI state machine exists,
  but `status` is free-text on the page (no enum switch), and there is **no
  "terminate employee" mutation** in `employees.functions.ts` — employee lifecycle
  STATUS transitions are handled only via onboarding status. So "termination"
  flow is effectively a directory-state that can't be fully driven from UI.

### 4.9 Payroll — **PARTIAL**

- Runs, entries, allowance/deduction lanes, process/pay flows complete.
- `EmployeeSalary` setup dialog inserts salary; verify correctness on runtime.
- Employee self-service "My Payslips" reads entries — no payslip PDF/file
  generation (write-though to `employee_documents` not wired).
- No void/cancel on a run once processed (policies restrict but UI lacks).

### 4.10 Expenses — **PARTIAL**

- Expense create/submit + manager approval (via policies + notifications) in place.
- The page does not gate manager-row submission by `expense_type` allowance —
  a manager could submit any type; policy is only applied at approval.

### 4.11 Training / Compliance — **PARTIAL**

- Training: crud + enroll; `training_attempts` updates are server-side.
- Compliance: policies table + report templates. The compliance page lets you
  create policies but there's no policy *versioning* / acknowledgment flow.

### 4.12 Notifications — **COMPLETE** (small gap)

- Triggers fire Devcards + email on: ticket assign, onboarding task due/changed,
  leave request submitted/approved, new employee created, new hire onboarding.
- HR approve/decide ops for attendance corrections do not emit notification
  events by themselves (they cause the trigger at the row write they do, if any —
  not present; on `attendance_corrections` update there's no trigger file).
  Minor gap: no notify trigger on `attendance_corrections.status` change.

### 4.13 Public careers — **COMPLETE**

- `public_job_list` / `public_job_detail` RPCs exist and are PUBLIC_RPCS.
- `/careers`, single job detail, apply → creates candidate + house async.

---

## 5. Verified sources (evidence)

### 5.1 Frontend data layer
- `src/lib/*.functions.ts` — per-module API calls (goes through `SpineClient` proxy).
- `src/integrations/supabase/core.ts` — SpineClient (proxy to Django /api/v1).
- `src/lib/rbac.ts`, `src/lib/hr-queries.ts`, `src/lib/knowledge.ts`.

### 5.2 Backend
- `backend/hr/api/*.py` — REST + RPC surface, storage, auth.
- `backend/hr/models/*.py` — data model.
- `backend/hr/rbac.py` — roles/scopes.
- `backend/hr/policies.py` — object-level guards (reads `status="active"`).
- `backend/hr/triggers.py` — notification triggers.
- `backend/hr/rest.py` — `_embed_relation` (forward-only).
- `drizzle/migrations/*.sql` — actual DDL.

### 5.3 Discrepancy inventory (runtime-verified candidates)

| File:line | SHA pattern | Claim |
|-----------|-------------|-------|
| `attendance.functions.ts:85` | `checkOutMin` uses `dayIndex * 1440 + toMinutes(time-only)` | NaN for cross-day |
| `leave.tsx` approve handler | `.update({ decided_by: ... })` | PGRST205 (no column) |
| `helpdesk.tsx` comment insert | `.insert({ author_id })` | PGRST205 (column is `author`) |
| `assets.tsx:134` | `.update({ status: "assigned" })` | Broken vs `active` policy |
| `actionType` "proposed" vs `screenCandidates` reads `shortlisted` | `actions.functions.ts:105,275` | Shortlist AI never populates |
| `EmployeeSalary` one-per-employee (migration 0001) | migration 0001:997-1001 | only single salary usable |

---

## 6. Prioritized work queue (from this audit)

Priority 1 — **BROKEN** (fix first; all are one-line column/status fixes):
1. `leave.tsx` — remove `decided_by` from the approve/reject update (keep `status`, `decided_at`).
2. `helpdesk.tsx` — comment insert use `author` (from `currentEmployee.id`) instead of `author_id`; ticket reassign set `assigned_to` not `decided_by`.
3. `assets.tsx` — change `{ status: "assigned" }` to `{ status: "active" }` (keep filters aligned).
4. `attendance.functions.ts` — build `localCheckOut` as full ISO and slice inside `computeMetrics` to stop NaN on check-outs.

Priority 2 — **MISSING / PARTIAL**:
5. Shortlist AI — implement screening RPC (score candidates) + trigger the existing `shortlistCandidates` action with `action_type: "recruitment.shortlist"`.
6. Employee termination — add `terminate` mutation (status = `terminated`, effective date) + UI action, matching existing lifecycle fields.
7. Payroll payslip document generation.

Priority 3 — **PARTIAL / nice-to-have**:
8. Attendance-correction notification trigger.
9. Expenses manager-submission type gating.
10. Offboarding status enum + versioned policy acknowledgments.

---

## 7. Conclusion

The system is broadly functional: auth, RBAC, models, and the full page surface
are **COMPLETE**. Four **BROKEN** runtime defects (leave approve, helpdesk
comments/reassign, assets allocation status, attendance cross-day check-out
NaN) and one **MISSING** main-feature (Shortlist AI) are the substantive gaps.
The rest of the remaining work is **PARTIAL** hardening (payslip¬files,
termination flow, notifications triggers, expense gating, offboarding enum).
No previously-implemented KPI/analytics feature requires rework.