# PHASE 6F — FINAL VERIFICATION

**Verdict: D1–D8 = PASS. Recorded database baseline = RESTORED.**

Qualifications (reported honestly, they do not change the D1–D8 verdict):

- `npx eslint .` (whole repo) = **TIMEOUT** — reported as TIMEOUT, not PASS.
- `npx eslint src` = **17 errors / 9 warnings**, all in files outside the Phase 6F
  D1–D8 scope. Phase 6F files lint clean (0 errors).
- Two harness assertions were corrected during this run; both are disclosed in §7.

Run date: 2026-10-06. Repository: `D:\HR\pixel-perfect-clone`.

---

## 1. Environment actually exercised

| Component | Address | Process | State |
|---|---|---|---|
| PostgreSQL | `127.0.0.1:5432` (`spine_ai`) | PID 34252 | UP |
| Django (runserver, `--noreload`) | `127.0.0.1:8000` | PID 28060 | UP |
| Vite dev server | `127.0.0.1:8081` | PID 23560 | UP, `GET /dashboard` → 200 |

All frontend evidence was produced in real Chrome (`Chrome/154.0.8037.93`) driven
over CDP against the live Vite + Django + PostgreSQL stack. No mocks, no fixtures
substituted for the backend.

Login used for privileged flows: `admin@northwind.io` / `admin12345`
(**hr_admin**, not super_admin — the checkpoint harness label "login as
super_admin" is misnamed for this account).

---

## 2. Gate results

### D1 — NOT NULL default violation (Recruitment + Careers) — **PASS**

Root cause (per checkpoint): blank optional form fields were serialized as
explicit `null`, bypassing the `NOT NULL` column defaults
(`experience_min = 0`, `skills = []`, `experience_years = 0`).

Re-run through the real browser UI after all later edits (including the
formatting pass), harness `d1a.mjs` + `d1b.mjs`, **19/19 assertions PASS**:

| Evidence | Result |
|---|---|
| Requisition form submitted with `experience_min`, `experience_max`, `skills` left blank | `{"experience_min":"","experience_max":"","skills":"","openings":"1"}` |
| Insert payload **omits** `experience_min` and `skills` | keys present: `title, slug, organization_id, department_id, location_id, openings, employment_type, work_mode, experience_max, description, responsibilities, requirements, status` |
| Persisted row | `experience_min = 0`, `experience_max = NULL`, `skills = []`, `openings = 1` |
| Candidate form submitted with `experience_years` left blank (no `skills` field exists on that form) | `{"experience_years":"","has_skills_field":false}` |
| Candidate payload **omits** `experience_years` | payload has `organization_id, full_name, email, phone, job_id, source, stage` only |
| Persisted candidate (direct) | `experience_years = 0.00`, `skills = []` |
| Careers apply form submitted with `experienceYears` and `skills` blank | `{"experienceYears":"","skills":""}` |
| Careers server-fn wire payload carries both as **null** | `experienceYears={"t":2,"s":0} skills={"t":2,"s":0}` (node-graph encoding; decoded in-harness) |
| Careers application accepted end-to-end | navigated to `/application-success` |
| Persisted careers candidate | `experience_years = 0.00`, `skills = []`, `source = careers_site` |
| No `IntegrityError` on any of the three paths | all writes 2xx, all rows created |

Files: `src/routes/_app/recruitment.tsx`, `src/lib/careers.functions.ts`.

### D2 — Raw database error leakage on integrity violations — **PASS**

Re-run (`d2.mjs`, **8/8 PASS**) with a live session token against the live
backend, driving two *real* `UNIQUE` violations that create no rows:

| Probe | Constraint hit | Status | Body |
|---|---|---|---|
| `POST /api/v1/public/job_requisitions/` with an existing `slug` | `job_requisitions_slug_key` | **400** | `{"message": "The request conflicts with existing data.", "code": "400", "details": null, "hint": null}` |
| `POST /api/v1/public/candidates/` with an existing `(organization_id, email)` | `candidate_email_org_key` | **400** | same fixed shape |

Checked-and-absent from both responses: constraint name, `duplicate key value`,
`DETAIL:`, `Failing row`, any column name, `unique constraint`, the canary
title/name values, `traceback`, `.py`, `state/`.

Server side, `backend/dj6f.err` recorded exactly two entries —
`Database integrity error handling POST /api/v1/public/job_requisitions/` and
`.../api/v1/public/candidates/` — i.e. the traceback is logged for operators and
only the traceback is withheld from the client.

Row counts unchanged by both probes.

File: `backend/hr/exceptions.py`.

### D3 — Refresh storm on concurrent 401 responses — **PASS**

`f_d3d4.mjs`, **19/19 PASS**, run twice (before and after the formatting pass).
Real 401 storm produced (4 distinct URLs 401'd):

- **Exactly 1** `POST /api/v1/auth/refresh/` for the whole expiry event (plus
  1 counted `OPTIONS` preflight).
- Refresh endpoint never retried or recursed; no infinite refresh loop.
- Every unauthorized request recovered to a 2xx on retry after the refresh.
- A later expiry refreshes again (single-flight is not latched).
- Failed refresh is itself single-flight (`refreshPOSTs = 1`) and clears the
  session safely → app lands on `/auth`.
- **Zero `*.supabase.co` requests.**

### D4 — Read amplification during refresh — **PASS**

Product change: `src/hooks/useAuth.tsx` now single-flights `loadContext`.

```
const loadInFlight = useRef(new Map<string, Promise<void>>());   // useAuth.tsx:57
const running = loadInFlight.current.get(userId);                // :60
loadInFlight.current.set(userId, task);                          // :95
if (loadInFlight.current.get(userId) === task)
  loadInFlight.current.delete(userId);                           // :99
```

Concurrent callers share one in-flight promise; the entry is removed in `finally`.
No caching layer, no query-key changes.

| Metric | Before fix | After fix |
|---|---|---|
| Reads during one expiry event vs baseline | 39 vs 14 = **2.75×** | 18 vs 14 = **1.29×** |
| `loadContext` quartet (`user_roles`, `profiles`, `role_permissions`) per cold navigation | 4× each | **1× each** (`maxPerKey = 1`, measured in `reg.mjs`) |

Guardrails still hold: all unauthorized requests recovered to 2xx, no infinite
loop, session/token handover correct.

### D5 — Candidate created with no application — **PASS**

Re-run after the formatting pass:

- **Backend** `d5_be.py` **9/9 PASS** — `job_id` omitted / `null` / `""` each
  return HTTP **400** with
  `"A requisition is required to add a candidate to the recruitment pipeline."`,
  never a 500, no `IntegrityError`/traceback in the body, and
  `candidates` count unchanged (23 → 23).
- **Frontend** `d5_fe.mjs` **10/10 PASS** — form is natively valid (so the guard,
  not native validation, did the work), submit issues **0 writes of any kind**,
  toast reads *"Select a requisition. Candidates are added to a requisition
  pipeline."*, and the dialog stays open.

### D6 — Sidebar advertises pages the route denies — **PASS**

`d6.mjs`, **19/19 PASS** (re-run after the formatting pass):

- hr_admin and hr_staff: all three `superAdminOnly` links
  (`User Access` `/admin/users`, `Roles & Permissions` `/admin/roles`,
  `AI Configuration` `/admin/ai`) absent from the sidebar, and direct navigation
  lands on `NoPermissionState` ("Access restricted").
- Sanity control: hr_staff still reaches normal sidebar entries (so the check is
  not a broken-sidebar false positive).
- super_admin: all three links visible and all three routes open normally.
- Route guards and API authorization were **not** weakened.
- Zero uncaught exceptions.

### D7 — `job.created` audit row has `entity_id = null` — **PASS**

Checkpoint target is the **requisition** path (`createJob`), not `candidate.created`.

| Evidence | Result |
|---|---|
| Insert payload reaches `POST .../job_requisitions/?select=id` (`.select("id").single()`) | yes |
| Audit payload for `job.created` | `{"user_id":"2a537309-…","action":"job.created","entity":"job_requisitions","entity_id":"4981f305-0e44-4e3c-b662-554e571e9150","previous_value":null,"new_value":{"title":"D1D7 Probe Requisition"}}` |
| `entity_id` is a non-null UUID | yes |
| `entity_id` equals the requisition id the app actually used afterwards | `audit.entity_id = 4981f305-…` = `requisition id = 4981f305-…` |
| Database row | `audit_logs.action='job.created'`, `entity='job_requisitions'`, `entity_id='bbcedeb0-…'` = the inserted `job_requisitions.id` (independent earlier run) |
| `candidate.created` (secondary) | `entity_id` resolves to the created candidate |

### D8 — Obsolete Supabase SDK and environment — **PASS**

| Requirement | Result |
|---|---|
| Remove unused env vars, keep the Django compat client + active service-role config | `.env` now holds exactly 3 keys: `API_URL`, `VITE_API_URL`, `SERVICE_ROLE_KEY`. 6 Supabase project vars removed with an explanatory comment. `src/integrations/supabase/**` and `client.server.ts`'s `SUPABASE_SERVICE_ROLE_KEY` fallback **retained**. |
| Remove obsolete dependency | `"@supabase/supabase-js": "^2.116.0"` removed from `package.json` and `package-lock.json` (`npm uninstall` → 8 packages pruned). `package.json` now contains **zero** `supabase` references. |
| Zero runtime imports | `from "@supabase/supabase-js"` in `src/` = **0**. Exactly **3 comment mentions** (`client.ts:2`, `core.ts:8`, `session-types.ts:1`). |
| Build succeeds after removal | `npm run build` → `✓ built in 11.12s`, 255 files emitted to `.output`. |
| Zero `*.supabase.co` in the built app | `.output` scanned: **`supabase.co` = 0**, `@supabase/supabase-js` = 0 (255 files). |
| Zero `*.supabase.co` requests at runtime | **0** across D3/D4, D5, D6, D7 and the full regression. |

---

## 3. Full runtime regression — **11/11 PASS**

`reg.mjs`, after every change:

- **26/26** major routes render for hr_admin (`/dashboard`, `/employees`,
  `/attendance`, `/payroll`, `/leave`, `/recruitment`, `/training`,
  `/performance`, `/helpdesk`, `/documents`, `/expenses`, `/shifts`,
  `/onboarding`, `/offboarding`, `/letters`, `/compliance`, `/assets`,
  `/analytics`, `/settings`, `/admin/users`, `/admin/roles`, `/admin/ai`,
  `/admin/audit`, `/admin/organization`, `/admin/knowledge`, `/copilot`) — no
  error boundaries, no `Internal Server Error`, no stuck splash.
- D4 still single-flights: `total=3 distinct=3 maxPerKey=1`.
- hr_admin, super_admin and hr_staff all log in and reach the dashboard.
- RBAC spot-check on `/admin/users`: hr_admin **denied**, hr_staff **denied**,
  super_admin **allowed** (each confirmed after the page was fully ready).
- **0** `*.supabase.co` requests, **0** uncaught exceptions, **0** failed network
  requests across the entire run.

---

## 4. Static checks

| Command (exact) | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit 0, no output (run twice: before and after the formatting pass) |
| `python.exe manage.py check` | **PASS** — `System check identified no issues (0 silenced).` exit 0 |
| `python.exe manage.py makemigrations --check --dry-run` | **PASS** — `No changes detected` exit 0 |
| `npx eslint .` | **TIMEOUT** — the shell tool killed the command after **900000 ms** with empty output (`eslint.log` size 0). Reported as TIMEOUT, **not** PASS. `npx eslint --version` responds instantly (`v9.39.5`) and single-file lint completes in seconds, so this is whole-tree traversal cost (`backend/.pgdata` ≈1712 files and `backend/.venv` are not in `eslint.config.js`'s `ignores`, which only lists `dist`, `.output`, `.vinxi`). |
| `npx eslint src` | **17 errors / 9 warnings**, exit 1 |

`npx eslint src` breakdown after the fix:

- **Phase 6F files (`useAuth.tsx`, `app-sidebar.tsx`, `recruitment.tsx`,
  `careers.functions.ts`): 0 errors** — the remaining output for
  `useAuth.tsx` is a single pre-existing `react-refresh/only-export-components`
  warning inherent to a file that exports both a provider and a hook.
- Remaining 17 errors are `prettier/prettier` formatting only, in
  `src/lib/employees.functions.ts`, `src/lib/payslip.ts`,
  `src/routes/_app/attendance.tsx`, `src/routes/_app/employees/index.tsx`,
  `src/routes/_app/payroll.tsx`. The last two are the **out-of-scope Phase 6E
  edits that must be preserved untouched**; the others are pre-existing and were
  deliberately not rewritten.
- The 9 warnings are `react-refresh`/`react-hooks` advisories in
  `src/components/ui/*` and the two Phase 6E routes.

---

## 5. Data integrity

Recorded baseline (twice at the start of the session, restored at the end):

`employees 23, attendance_records 296, employee_documents 7, payroll_entries 0,
notifications 40, leave_requests 6, helpdesk_tickets 5, candidates 23,
applications 15, job_requisitions 10, audit_logs 15, shifts 3`

Final state: **identical — `MATCH: True`**, verified by a single 12-column query.

Cleanup performed and verified:

- All probe rows deleted: requisitions titled `D1D7 Probe Requisition` (2),
  candidates `D1 Probe Candidate` / `D1 Careers Probe` (3), their applications
  (3), and every `audit_logs` row whose `entity_id` referenced them
  (`job.created`, `candidate.created`, `job.status_changed`,
  `application.submitted`).
- Both temporary RBAC accounts deleted from `auth_users` **and** their
  `user_roles` + `profiles` rows: `d6test-superadmin@northwind.io`
  (`fd5af5fb-c7c5-418c-a40a-64c1588fbccc`),
  `d6test-hrstaff@northwind.io` (`9a7b2c15-cbf7-42df-a007-d881263f661d`).
  Remaining `d6test-*` rows: **0**. Existing account passwords were never modified.
- D5 probes inserted nothing (`23 → 23`); D2 probes inserted nothing.

No unexpected mutation of business data occurred at any point.

---

## 6. Files changed in Phase 6F

**Product changes (the D1–D8 fixes):**

| File | Defect |
|---|---|
| `src/routes/_app/recruitment.tsx` | D1 (blank keys omitted), D5 (frontend guard), D7 (`.select("id").single()` + `logAudit({entityId})`) |
| `src/lib/careers.functions.ts` | D1 (blank keys omitted on the public intake) |
| `backend/hr/exceptions.py` | D2 (centralized `IntegrityError` → safe 400) |
| `backend/hr/api/rest.py` | D5 (backend `job_id` guard) |
| `src/components/hr/app-sidebar.tsx` | D6 (`superAdminOnly` link filtering) |
| `src/hooks/useAuth.tsx` | D4 (single-flight `loadContext`) |
| `src/integrations/supabase/core.ts` | D3 (single-flight refresh) |
| `.env`, `package.json`, `package-lock.json` | D8 |

**Formatting-only pass:** `npx eslint --fix` was run on the four Phase 6F
frontend files (`useAuth.tsx`, `app-sidebar.tsx`, `recruitment.tsx`,
`careers.functions.ts`) to clear 27 `prettier/prettier` errors. This changed
whitespace only; `tsc` still exits 0 and D3/D4/D5/D6/D7 were all re-verified
afterwards.

**Explicitly not modified:** the out-of-scope Phase 6E edits
(`attendance.functions.ts`, `attendance.tsx`, `payroll.tsx`,
`global-search.tsx`, `backend/hr/policies.py`, `backend/hr/api/storage_views.py`,
`backend/hr/models/attendance.py`, `src/integrations/supabase/types.ts`,
`src/lib/rbac.ts`) — left exactly as found, including their lint errors.

Scratch logs created in the repo (`tsc*.log`, `eslint*.log`, `es1.log`,
`fix*.log`, `backend/check.log`, `backend/mig.log`) were deleted. Build output
`.output/` remains (git-ignored) and is the artifact the D8 zero-`supabase.co`
scan ran against.

---

## 7. Disclosures

1. **Harness assertion fixed — `f_d3d4.mjs`.** The original `unrecovered` map
   recorded *every* URL that returned 401, so the assertion
   `unrecovered.size === 0` was unsatisfiable precisely when the required 401
   storm occurred. It now records only keys with no later 2xx. The fix is
   additive to the harness only; no product code was touched to make D3/D4 pass.
   Every other D3/D4 assertion (single refresh POST, no retry/recursion, no
   infinite loop, later expiry refreshes again, failed-refresh single-flight,
   session cleared, zero `supabase.co`) is independent of that fix.
2. **Harness addition — `cdp.mjs`.** Added an additive `postDataFull` field
   (8000-char capture alongside the existing 300-char `postData`) so request
   bodies could be inspected for the D1/D7 payload evidence. Existing fields and
   behaviour are unchanged.
3. **D4 is a product change, not a harness change.** The single-flight wrapper in
   `src/hooks/useAuth.tsx` is the fix under test; the harness only measures it.
4. **`npx eslint .` = TIMEOUT**, not PASS (§4). Exact command and the 900000 ms
   kill are reported above.
5. **D8 changed `package.json`/`package-lock.json`.** This prunes 8 packages.
   The repo-level script `pg_wm_verify.mts` still imports
   `@supabase/supabase-js`; it was already non-functional (it reads Supabase env
   vars that no longer exist) and is not part of the application build.
6. **One harness run exceeded the tool timeout.** The first post-format `d6.mjs`
   attempt was killed by the shell tool at 900000 ms while at record 13/19
   (mid `super_admin` login); leftover Chrome processes were cleared and the
   identical command re-run to completion: **19/19 PASS**. This was a harness
   scheduling issue, not a product failure.
7. **Temporary test accounts were created and are now deleted** (§5).
8. **Recruitment `candidate` form has no `skills` field**, so D1's candidate
   assertion covers `experience_years` only; `skills` blank-handling is proven on
   the requisition form and the careers form (both persisted `[]`).

---

## 8. Reproduction

Harness scripts live in `C:\Users\kiran.r\AppData\Local\Temp\opencode\`
(`cdp.mjs`, `f_d3d4.mjs`, `d5_be.py`, `d5_fe.mjs`, `d6.mjs`, `d1a.mjs`,
`d1b.mjs`, `d2.mjs`, `reg.mjs`), run with that directory as the working
directory against the three services in §1.

```
npx tsc --noEmit                                             # exit 0
python.exe manage.py check                                   # 0 issues
python.exe manage.py makemigrations --check --dry-run        # No changes detected
npx eslint src                                               # 0 errors in Phase 6F files
npx eslint .                                                 # TIMEOUT (reported as such)
npm run build                                                # ok, 0 supabase.co in .output
```

**Final state:** D1 ✅ D2 ✅ D3 ✅ D4 ✅ D5 ✅ D6 ✅ D7 ✅ D8 ✅ ·
runtime regression 11/11 ✅ · baseline restored ✅ · services still up.
