# PHASE 6F — CHECKPOINT REPORT

**Date:** 2026-10-05
**Scope:** Phase 6F frontend runtime remediation (D1–D8)
**Verdict:** **PHASE 6F: FAIL / INCOMPLETE**

This report records only work that was actually completed **and** verified. Items
D3–D8 are **OPEN / NOT FIXED** and are **not** claimed as resolved anywhere in this
document.

---

## 1. Authoritative Status

| ID | Defect | Status |
|----|--------|--------|
| D1 | NOT NULL default violation in Recruitment / Careers forms | **PASS / FIXED / VERIFIED** |
| D2 | Raw database error leakage on integrity violations | **PASS / FIXED / VERIFIED** |
| D3 | Concurrent 401s each trigger a separate token refresh (refresh storm) | **OPEN / NOT FIXED** |
| D4 | Refresh cycle causes read amplification | **OPEN / NOT FIXED** |
| D5 | Candidate can be created with no application — invisible in the pipeline | **OPEN / NOT FIXED** |
| D6 | Sidebar exposes Super-Admin-only pages to roles the route denies | **OPEN / NOT FIXED** |
| D7 | `job.created` audit row written with `entity_id = null` | **OPEN / NOT FIXED** |
| D8 | Obsolete Supabase SDK dependency and Supabase environment variables | **OPEN / NOT FIXED** |

---

## 2. VERIFIED / PASS

### D1 — NOT NULL default violation (Recruitment + Careers)

**Files changed (2):**

1. `src/routes/_app/recruitment.tsx`
2. `src/lib/careers.functions.ts`

**Root cause:** blank optional form fields were sent as explicit `null` for columns
that are `NOT NULL` with model defaults (`experience_min` default `0`, `skills`
default `[]`, `experience_years` default `0`). An explicit `null` bypasses the
database default and violates the column constraint.

**Fix:** omit the key entirely when blank so the database default applies.

**Evidence recorded during verification:**

- Recruitment: `experience_min` blank → persisted `0`; `skills` blank → persisted `[]`;
  candidate `experience_years` blank → persisted `0`.
- Careers: blank `experience_years` → `0`, blank `skills` → `[]`; `experience_years=5`
  with `skills=["python","django"]`; full application persisted correctly.
- Verified through the real browser UI against the live Django backend and native
  PostgreSQL, including page reload and pipeline visibility.
- Audit rows written for the verified flows.
- All test rows removed; pre-existing row counts restored to baseline.
- Static checks passed: `manage.py check`, `makemigrations --check`,
  `npx tsc --noEmit`.

### D2 — Raw database error leakage on integrity violations

**File changed (1):**

1. `backend/hr/exceptions.py`

**Root cause:** `django.db.utils.IntegrityError` was not handled centrally, so the
exception message was passed through the generic `str(exc)` fallback. Responses
exposed PostgreSQL internals, including constraint names, column names, and the
values of the failing row.

**Fix:** centralized `IntegrityError` handling in `api_exception_handler`. The full
traceback is logged server-side (with request method and path); the client receives a
generic HTTP 400:

```json
{
  "message": "The request conflicts with existing data.",
  "code": "400",
  "details": null,
  "hint": null
}
```

**Evidence recorded during verification:**

- Before fix — HTTP 500 response body contained `DETAIL: Failing row contains (...)`
  plus constraint name, column names, and canary values.
- After fix — HTTP 400; response contained no `DETAIL:`, no constraint names, no
  column names, and none of the canary values.
- Live server log retained the diagnostic detail: `psycopg.errors.NotNullViolation`,
  constraint details, the failing row, and the traceback.
- Normal INSERT / UPDATE / DELETE paths unaffected.
- D1 Recruitment and Careers paths re-tested after the D2 change and still passed.
- All test rows removed; pre-existing row counts restored to baseline.
- Static checks passed: `manage.py check`, `makemigrations --check`,
  `npx tsc --noEmit`.

### Previously verified Phase 6 foundation

Phase 6 gates 6A–6I and the Phase 6E API integration work were verified before
Phase 6F and are recorded in the existing artifacts listed in section 6. Phase 6F is
a frontend-runtime verification pass layered on that foundation; it has **not**
regressed the D1/D2 behaviour above, but the Phase 6F gate as a whole is not closed.

**Recorded database baseline** (business data preserved, restored after testing):

employees 23, attendance 296, employee_documents 7, payroll_entries 0,
notifications 40, leave_requests 6, helpdesk_tickets 5, candidates 23,
applications 15, job_requisitions 10, audit_logs 15, shifts 3.

---

## 3. OPEN / NOT FIXED — D3 through D8

These defects are **not fixed**. No verification evidence is claimed for them.

### D3 — Refresh storm on concurrent 401 responses (OPEN)

Multiple concurrent requests that each receive `401` can each independently trigger a
token refresh, producing a storm of `POST /api/v1/auth/refresh/` calls. Required
behaviour: one refresh per expiry event, no recursive refresh, session cleared safely
when a refresh genuinely fails.

**Status: OPEN.** No verified fix. See section 5 for unverified in-progress edits.

### D4 — Read amplification during refresh (OPEN)

The refresh cycle causes duplicate/fanned-out reads of the same endpoints.

**Status: OPEN.** No verified fix.

### D5 — Candidate created with no application (OPEN)

`addCandidate` inserts a candidate with `job_id: form["job_id"] || null` and only
creates an application when a requisition is selected. A candidate with no requisition
and no application is invisible in the recruitment pipeline, yet the UI shows the
success toast "Candidate added to the pipeline" — a false success. Required: frontend
validation prevents submission, and the backend rejects invalid pipeline creation with
a safe, user-readable 4xx error.

**Status: OPEN.** No verified fix.

### D6 — Sidebar advertises pages the route denies (OPEN)

`/admin/users`, `/admin/roles`, and `/admin/ai` are guarded as Super-Admin-only, but
the sidebar entries are filtered only by module access, so lower roles see links that
lead to access-denied. Required: hide those links for non-Super-Admins without
weakening route or API authorization.

**Status: OPEN.** No verified fix.

### D7 — `job.created` audit row has `entity_id = null` (OPEN)

`createJob` inserts into `job_requisitions` without `.select()`, so the created id is
never returned; `logAudit()` is then called with no `entityId`. `logAudit()` already
supports `entityId` and defaults to `null`. Required: the audit row references the
created requisition.

**Status: OPEN.** No verified fix.

### D8 — Obsolete Supabase SDK and environment (OPEN)

`package.json` declares `@supabase/supabase-js` (`^2.116.0`) which has no runtime
import, and `.env` contains Supabase variables that are not required by the
React/Vite → Django → PostgreSQL runtime. Required: remove obsolete dependency and
variables while preserving the Django compatibility client and the active service-role
configuration, and prove zero `*.supabase.co` requests in the built app.

**Status: OPEN.** Not started.

---

## 4. Relevant Existing Verification Reports

All paths relative to `D:\HR\pixel-perfect-clone`.

| Report | Size | Last modified |
|--------|------|---------------|
| `PHASE6F_FRONTEND_RUNTIME.md` | 21782 B | 2026-10-05 15:16 |
| `PHASE6E_API_INTEGRATION.md` | 39521 B | 2026-10-01 15:47 |
| `PHASE6E_INCIDENT_DATA_LOSS.md` | 6949 B | 2026-10-01 12:06 |
| `PHASE6_FINAL_GATE_REPORT.md` | 4906 B | 2026-09-23 14:39 |
| `PHASE6_GATES_6A_6I.md` | 6788 B | 2026-09-23 14:35 |
| `PHASE7_FINAL_VERIFICATION.md` | 12040 B | 2026-09-23 17:51 |
| `PHASE7_PRODUCTION_READINESS_AUDIT.md` | 16558 B | 2026-09-23 14:56 |
| `PHASE7_PRODUCTION_READINESS_REMEDIATION.md` | 9661 B | 2026-09-23 17:25 |
| `PHASE8_1_ASSET_TRIGGER_FIX.md` | 8705 B | 2026-09-24 11:39 |
| `PHASE9_SHORTLIST_AI.md` | 6205 B | 2026-09-24 12:23 |

`PHASE6F_FRONTEND_RUNTIME.md` is the audit that opened D3–D8. It still reflects the
pre-remediation state; D1 and D2 were subsequently fixed and verified as recorded in
section 2.

---

## 5. Working Tree State at Checkpoint

**D1 and D2 changes are present, complete, and verified** (section 2).

During the remediation session that produced this checkpoint, **additional
unverified source edits were made for D3, D5, D6, and D7.** They are listed here for
full transparency because they are **not** covered by any verification, are **not**
claimed as fixes, and were left in the working tree when work was stopped:

| File | Unverified edit | Defect |
|------|-----------------|--------|
| `src/integrations/supabase/core.ts` | `AuthApi.refreshInFlight` field, `refreshSession()`, `performRefresh()`, `discardSession()`; removed dead `SpineClient.refreshInFlight`; `rawCall` "already refreshed" check; `performRefresh` try/catch | D3 |
| `src/components/hr/app-sidebar.tsx` | `NavItem.superAdminOnly`; marked `/admin/users`, `/admin/roles`, `/admin/ai`; filtered admin nav list | D6 |
| `src/routes/_app/recruitment.tsx` | requisition `.select("id").single()` + `entityId: created.id` (D7); requisition guard in `addCandidate` + readable `onError` + form submit check (D5) | D5, D7 |
| `backend/hr/api/rest.py` | `candidates` insert guard in `_pre_write_triggers` requiring `job_id`, returning a 4xx | D5 |

Observations about these edits, stated without claiming a pass:

- `npx tsc --noEmit` exits `0` after the `core.ts`, `app-sidebar.tsx`, and
  `recruitment.tsx` edits (static check only; not runtime verification).
- The Django backend was last started with `--noreload` **before** the `rest.py` edit,
  so the `rest.py` guard has **not** been exercised at all.
- A diagnostic request-timeline capture was taken during the session and is stored at
  `C:\Users\kiran.r\AppData\Local\Temp\opencode\diag.out`. It is an **unvalidated
  diagnostic**, not verification evidence, and it must not be treated as a D3/D4 pass.
- Earlier measurement harnesses were found to be themselves faulty (they counted CORS
  preflight `OPTIONS` requests as refresh calls, and compared per-URL read counts
  against a baseline that itself contains pre-existing duplicate reads). Those harnesses
  produced false failures and their results are **not** accepted as evidence.
- No D3/D4 harness run has produced a trustworthy pass result.

Temporary test tooling lives outside the repository and is not product code:
`C:\Users\kiran.r\AppData\Local\Temp\opencode\` (`cdp.mjs`, `f_d3d4.mjs`,
`diag_timeline.mjs`, `diag.out`, `d3d4.out`).

A Vite dev server was started on port 8081 for verification and may still be running.

---

## 6. Changes NOT Made

Confirmed for this checkpoint:

- **No migrations** were created or applied (`makemigrations --check` clean at last run).
- **No business data** was deleted or modified; all test rows were tagged and removed,
  restoring the recorded baseline in section 2.
- **No schema changes** were made. The D5 work deliberately avoided a model change.
- **No dependencies** were added or removed. `@supabase/supabase-js` is still declared.
- **No configuration files** were changed. No `.env` edits were made.
- **No Supabase SDK, Auth, REST, Storage, or OAuth** was introduced. The runtime
  architecture remains React/Vite → Django → native PostgreSQL.
- **No Docker, SQLite, or Vercel** configuration was touched.
- **No route or API authorization was weakened.** The D6 work targeted sidebar
  visibility only.

---

## 7. What Is Required to Close Phase 6F

1. Complete and verify D3 (single-flight refresh, no recursion, safe session clearing).
2. Complete and verify D4 (no read amplification; trustworthy baseline comparison).
3. Complete and verify D5 (frontend validation + backend rejection, no orphan candidate).
4. Complete and verify D6 (five-role sidebar visibility, direct-URL and API checks).
5. Complete and verify D7 (audit `entity_id` populated).
6. Then and only then perform D8 (dependency and environment cleanup, build, and
   zero-Supabase-request proof).
7. Re-run D1 and D2 regressions, the full auth/RBAC/tenant-isolation matrix, cleanup and
   baseline comparison, and static checks.
8. Write `PHASE6F_FINAL_VERIFICATION.md` and declare PASS only if all eight defects pass.

---

**PHASE 6F: FAIL / INCOMPLETE**