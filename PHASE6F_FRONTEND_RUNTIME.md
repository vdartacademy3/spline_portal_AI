# PHASE 6F: FRONTEND RUNTIME VERIFICATION REPORT

**Project:** `D:\HR\pixel-perfect-clone` (Spine AI HR platform)
**Date:** 2026-10-05
**Phase:** 6F — Real-browser runtime verification of the shipped React/Vite frontend against the Django + PostgreSQL backend
**Verdict:** **PHASE 6F: FAIL**

---

## 1. Executive Summary

The frontend was exercised in a real Chrome browser (154.0.8037.59) against the live Vite dev server, the running Django backend, and native PostgreSQL, as all five seeded roles.

**What passed:** authentication, logout, re-login, session persistence, anonymous boundary enforcement, all 27 routes rendering, RBAC and row-level data scoping across 5 roles, direct-URL authorization, a complete CREATE → link → UPDATE mutation lifecycle with PostgreSQL persistence and audit logging, zero Supabase runtime traffic, and clean `manage.py check` / `tsc --noEmit` / `npm run build`.

**What failed:** the two primary Recruitment write actions — **"New requisition"** and **"Add candidate"** — return **HTTP 500** whenever the operator leaves an apparently-optional field blank. This is the default path through both forms and blocks the core recruiting workflow. Three separate `NOT NULL` columns receive an explicit JSON `null` from the frontend. Additionally, a rejected access token triggers an un-deduplicated **token-refresh storm** (21 `POST /auth/refresh/` for a single page load) followed by heavy duplicate read amplification (120 reads of 3 endpoints in 13.6 s).

**Bottom line:** read paths and authorization are sound and well-verified. The write path in Recruitment is broken for default input. Phase 6F cannot be signed off.

---

## 2. Scope and Objectives

| # | Objective | Status |
|---|---|---|
| 1 | Verify real-browser runtime behavior of the React/Vite frontend | Complete |
| 2 | Verify Django + PostgreSQL as the only backend data path | Complete |
| 3 | Prove no Supabase runtime dependency exists | Complete |
| 4 | Verify authentication and full session lifecycle | Complete |
| 5 | Verify RBAC and row-level data scoping for all 5 roles | Complete |
| 6 | Verify every route renders | Complete |
| 7 | Verify CREATE / UPDATE mutations persist and are audited | Complete |
| 8 | Verify no seeded or business data was mutated | Complete |
| 9 | Verify static checks and production build | Complete |
| 10 | Produce an evidence-backed verdict | Complete |

**Explicitly out of scope:** redesign, refactoring, schema changes, Phase 6G, Phase 7, deployment. **No source file was modified during this phase** — this is a verification pass only.

---

## 3. Environment and Toolchain

| Component | Detail |
|---|---|
| Browser | Chrome 154.0.8037.59, driven over raw CDP |
| Frontend | Vite dev server, `http://localhost:8080` |
| Backend | Django, `http://127.0.0.1:8000` |
| Database | Native PostgreSQL (no SQLite, no Docker, no Supabase) |
| Session store | `localStorage["spine-session"]` |
| Static checks | `manage.py check`, `makemigrations --check`, `tsc --noEmit`, `npm run build` |

Cold hydration of the Vite dev server took approximately 30 seconds; the harness therefore waits explicitly for hydration and app readiness before asserting. This is a dev-server startup characteristic, not a runtime defect.

---

## 4. Architecture Under Test

The shipped data path is:

```
React SPA  →  src/integrations/supabase/*  (SpineClient compat shim)
           →  Django /api/v1/public/*  +  /api/v1/auth/*
           →  PostgreSQL
```

`src/integrations/supabase/client.ts` exports a variable named `supabase` for source compatibility, but it is a `Proxy` over `SpineClient` (`core.ts`), which targets Django. The `@supabase/supabase-js` package is **not** imported by any source file.

---

## 5. Methodology and Evidence Harness

A CDP driver (`cdp.mjs`) was hardened for React-aware interaction: `waitHydrated()`, `waitAppReady()`, value-verified retrying `type()`, `clickWhenEnabled()`, `clickButtonWithText()`, and request `postData` capture with a 60 s network timeout.

Every assertion was corroborated three ways: **browser network log**, **on-screen rendered DOM**, and **direct PostgreSQL query**.

**Harness artifacts that were corrected during the phase** (test-side only, not product defects):

- `/settings` contains its own `#email` field, so a login-form detector falsely matched.
- `/admin/audit` initially hit a renderer stall; it rendered correctly on re-run with 15 rows.
- The account of "two `200`s on `/auth/token/`" was one CORS `OPTIONS` preflight plus one `POST` — not a double submission.
- A reused tab stops accepting synthetic input after in-app SPA navigation; a fresh tab per role resolved it.
- Off-screen elements were clicked at stale coordinates; `scrollIntoView` before measuring resolved it.

---

## 6. Authentication and Session Lifecycle

| Check | Result | Evidence |
|---|---|---|
| Login issues exactly one token POST | **PASS** | `posts=1`, responses `[200, 200]` (OPTIONS + POST) |
| Session persisted with access + refresh tokens | **PASS** | keys `access_token, refresh_token, token_type, expires_in, expires_at, user`; access token length 241 |
| Post-login landing route | **PASS** | `/dashboard` |
| Account menu → "Sign out" present and clickable | **PASS** | Radix `role=menuitem`, text "Sign out" |
| Logout calls Django | **PASS** | `OPTIONS auth/logout/`, `POST auth/logout/` → 200 |
| Logout clears persisted session | **PASS** | `localStorage["spine-session"]` → `null` |
| Logout redirects to `/auth` | **PASS** | `/auth` |
| Protected route blocked after logout | **PASS** | `/employees` → `/auth` |
| Re-login after logout | **PASS** | `posts=1`, fresh session stored |
| Session survives full page reload | **PASS** | roles/profile/employee/permissions reloaded |
| Garbage session rejected, no fatal crash | **PASS** | `spine-session = "this-is-not-json"` → `/auth`, 0 exceptions |
| Cleared session blocked | **PASS** | `/payroll` → `/auth` |
| No uncaught exceptions across lifecycle | **PASS** | exceptions=0, consoleErrors=0 |

`/auth/claims` is never requested. This is **correct**: `useAuth.tsx` restores the session via `getSession()`, which reads localStorage, then reloads `user_roles`, `profiles`, and the employee record through Django.

---

## 7. Anonymous / Unauthenticated Boundary

Anonymous browser, no session:

- `/employees` **redirects to `/auth`** — PASS
- **0** Supabase requests — PASS
- **0** Django requests across 364 total requests — PASS (no data endpoint was even attempted)
- Only Vite assets and Google Fonts were requested externally — PASS
- No session or data leakage in the DOM — PASS

---

## 8. Route and Page Render Sweep

All 27 routes were loaded as an authenticated HR Admin:

`/dashboard`, `/copilot`, `/employees`, `/recruitment`, `/onboarding`, `/attendance`, `/shifts`, `/leave`, `/performance`, `/documents`, `/helpdesk`, `/offboarding`, `/expenses`, `/letters`, `/assets`, `/training`, `/compliance`, `/payroll`, `/ai-actions`, `/analytics`, `/settings`, `/admin/users`, `/admin/roles`, `/admin/organization`, `/admin/knowledge`, `/admin/audit`, `/admin/ai`.

| Metric | Result |
|---|---|
| Routes visited | 27 / 27 |
| Supabase requests | **0** of 423 |
| Django 4xx/5xx | **0** |
| Console errors | **0** |
| Runtime exceptions | **0** |

---

## 9. Navigation and Routing Integrity

### DEFECT D6 — HR Admin sees admin links that are guaranteed to be denied (MEDIUM)

The sidebar filters purely on `canAccess()` (`src/components/hr/app-sidebar.tsx`), but individual admin routes add a further Super Admin requirement. Confirmed at `src/routes/_app/admin/users.tsx:173`:

```js
if (!canAccess(...) || !superAdmin) return <NoPermission />;
```

HR Admin holds the `manage_users` permission, so `canAccess()` passes and the link renders — but the route always denies.

| Role | Nav items rendered | Observed behavior |
|---|---|---|
| super_admin | 27 | all routes reachable |
| hr_admin | 27 | `/admin/users`, `/admin/roles`, `/admin/ai` visible but denied |
| hr_staff | 23 | admin items correctly hidden |
| manager | 17 | admin items correctly hidden |
| employee | 12 | admin items correctly hidden |

**No data leaks** — the route gate stops before any request is issued, so **0** HTTP 4xx/5xx were generated. This is a UX/consistency defect, not a security hole.

---

## 10. RBAC and Row-Level Data Scoping

Rows visible in the UI per role, verified against PostgreSQL:

| Role | employees | attendance | user_roles | audit_logs |
|---|---|---|---|---|
| super_admin | 23 | 296 | 11 | 15 |
| hr_admin | 23 | 296 | 11 | 15 |
| hr_staff | 23 | 296 | 1 | 0 |
| manager | 7 | 61 | 1 | 0 |
| employee | 1 | 8 | 1 | 0 |

Row-level scoping is enforced correctly and consistently at the Django/RLS layer. `payroll_entries` is `0` for every role; that is the recorded permanent data gap, not an authorization signal, so it was not used as evidence.

---

## 11. Direct URL / Deep-link Authorization

Navigating directly to restricted URLs, bypassing the sidebar:

| Role | Route | Result |
|---|---|---|
| hr_staff | `/admin/users`, `/admin/roles` | Denied — NoPermission |
| hr_staff | `/payroll`, `/employees` | Allowed |
| manager | `/admin/*`, `/payroll` | Denied |
| manager | `/employees` | Allowed (scoped to 7) |
| employee | `/admin/*`, `/employees` | Denied |
| employee | `/payroll` | Allowed (self-service) |
| hr_admin | `/admin/users`, `/admin/roles` | Denied despite visible nav |

**No unauthorized data was returned and no 4xx/5xx was produced**, because the UI gate prevents the request. Server-side enforcement was independently confirmed in Phase 6E.

---

## 12. Mutation Verification — CREATE

### DEFECT D1 — Both Recruitment CREATE actions fail with HTTP 500 on default input (HIGH)

The frontend sends an explicit JSON `null` for columns PostgreSQL declares `NOT NULL`. Django does not coerce an explicit `null` to the column default, so the insert raises an unhandled `IntegrityError` surfaced as **HTTP 500**.

| Table | Column | Frontend source | Result |
|---|---|---|---|
| `job_requisitions` | `experience_min` | `recruitment.tsx:155` | **500** |
| `job_requisitions` | `skills` | `recruitment.tsx:162` | **500** |
| `candidates` | `experience_years` | `recruitment.tsx:227` | **500** |

Offending pattern, `recruitment.tsx:155`:
```js
experience_min: form["experience_min"] ? Number(form["experience_min"]) : null,
```

Reproduced through the real UI as HR Admin:

- **"New requisition"** with Min experience and Skills blank → toast *"The requisition could not be created."* → `HTTP 500`, **no row written**.
- **"Add candidate"** with Years of experience blank → toast *"The candidate could not be added."* → `HTTP 500`, **no row written**.
- Supplying `experience_min=3` + `skills="python, django"` → **HTTP 201**, row written.
- Supplying `experience_years=5` → **HTTP 201**, row written.

Server-side confirmation with the exact UI payload:
```
{"message": "null value in column \"experience_min\" of relation \"job_requisitions\"
             violates not-null constraint", "code": "500"}
{"message": "null value in column \"skills\" of relation \"job_requisitions\" ...",
 "code": "500"}
{"message": "null value in column \"experience_years\" of relation \"candidates\" ...",
 "code": "500"}
```

**Impact:** both primary recruiting write actions fail for the default, most common user path. Omitting the key entirely works; only the explicit `null` breaks.

### CREATE happy path — fully verified end-to-end

With the required fields supplied, the complete lifecycle passed:

1. **INSERT requisition** → `201`, `audit_logs: job.created`, toast *"Requisition created as a draft"*, row rendered.
2. **INSERT candidate** linked to that requisition → `201`.
3. **Follow-on INSERT `applications`** → confirmed in PostgreSQL:
   `stage='applied'`, `status='active'`, `source='hr_added'`, `consent=True`.
4. `audit_logs: candidate.created`.
5. Both mutations **survived a full page reload**.

Note: `201` + created row is returned because the real client sends `Prefer: return=representation`. A bare `POST` without that header returns PostgREST-compatible `204 No Content` while still writing the row. This is **correct, intended behavior**, not a defect.

---

## 13. Mutation Verification — UPDATE

Moving a candidate through the real kanban "Move to..." control:

| Step | Result |
|---|---|
| Stage control located on the candidate card | PASS |
| Stage options offered | PASS — Screening, Hr Review, Shortlisted, Assessment, Interview, Selected, Offer, Hired, Rejected, Withdrawn, On Hold |
| `PATCH applications/?select=id&id=eq.…` | **200** |
| `PATCH candidates/?id=eq.…` | **200** |
| `POST audit_logs/` → `application.stage_changed` | PASS |
| Toast | *"Stage updated"* |

PostgreSQL confirmed both rows advanced together:

```
candidate_stage = 'screening'   app_stage = 'screening'   status = 'active'
updated_at = 2026-10-05 09:11:00+00
```

**PASS** — UPDATE is correct, atomic across both tables, and audited.

---

## 14. Data Integrity and Persistence

- All CREATE/UPDATE operations were verified by direct SQL, not just by UI reflection.
- PostgreSQL remained the single source of truth; no client-side-only state was mistaken for persistence.
- `candidates` has **no `created_at` column**; it uses `applied_at`. Recency ordering on candidates must use `applied_at`.
- Candidate detail, pipeline, and dashboard queries all join through `applications`, consistent with the schema.

---

## 15. Error Handling and API Contract

### DEFECT D2 — Raw PostgreSQL error text is returned to the browser (MEDIUM)

The 500 response body includes the raw driver message **and the full `DETAIL` line listing every column value of the failing row**:

```
"DETAIL": "Failing row contains (1c6d757e-…, PHASE6F PROBE CAND C, probe-c@probe.invalid,
 null, null, [], null, null, phase6f_probe, applied, …)"
```

This exposes schema shape, column ordering, and submitted values to the client. `backend/hr/exceptions.py` should map `IntegrityError` to a generic 4xx and log the detail server-side only.

Additionally, the client maps every failure of `addCandidate`/`createJob` to a single generic toast, discarding the server's diagnostic entirely — so the operator gets no actionable message and support gets nothing.

---

## 16. Network and Third-Party Surface — Supabase Audit

| Location | Finding |
|---|---|
| `src/**/*.ts(x)` | **0** imports of `@supabase/supabase-js`. Every reference is `import { supabase } from "@/integrations/supabase/client"` — the local compat shim |
| `src/integrations/supabase/types.ts` | Type-only (`__InternalSupabase` marker); no runtime |
| `src/integrations/supabase/session-types.ts` | Structural type stand-ins, explicitly documented as replacing the real package |
| `src/integrations/supabase/core.ts` | Proxy over `SpineClient` → Django |
| `backend/**` | All hits are docstrings explaining the PostgREST/supabase-js-compatible surface |
| `package.json:46` | `@supabase/supabase-js: ^2.116.0` still declared — **vestigial, unused** |
| `.env` | `SUPABASE_*` and `VITE_SUPABASE_*` values present — **vestigial, and a secret-hygiene concern** |
| `.output/public/assets/index-*.js` | `GoTrueClient`=0, `PostgrestClient`=0, `SupabaseClient`=0, `supabase.co`=1 (dead config string only) |
| Runtime traffic, 27-route sweep | **0** Supabase requests of 423 |

**Conclusion:** no Supabase runtime exists in the shipped path. Two hygiene items remain: the unused dependency declaration and the committed `.env` containing Supabase credentials.

---

## 17. Console and Runtime Error Hygiene

- 27-route sweep: **0** console errors, **0** uncaught exceptions.
- Full session lifecycle (login → logout → re-login → tampered → garbage → cleared): **0** exceptions, **0** console errors.
- Mutation runs: **0** console errors; failures surfaced as designed toasts.
- The only server-side 5xx observed anywhere in this phase was the D1 `IntegrityError`.

---

## 18. Performance and Request Amplification

### DEFECT D3 — Token refresh is not single-flighted (MEDIUM)

`core.ts:503-520` attempts a refresh on any 401 but performs no de-duplication:

```js
if (res.status === 401 && this.client.persistAuth && getStoredSession()?.refresh_token) {
  const refreshed = await this.client.auth.refreshSession();
  ...
}
```

When the access token is rejected, N concurrent queries each fire their own refresh. Measured on a single `/employees` load: **13 `POST /auth/refresh/` within 96 ms**, rising to **21 total** over the following 3 seconds — all returning 200.

A healthy session costs **0** refresh calls, so this is purely an error-path amplification.

### DEFECT D4 — Duplicate read amplification after a 401 storm (MEDIUM)

Continuing past recovery, the same three endpoints were re-read **120 times in 13.6 s** for one page load:

```
200 public/employees/?select=…      (repeated ~40x)
200 public/user_roles/?select=…      (repeated ~40x)
200 public/profiles/?select=…        (repeated ~40x)
```

Total Django responses after the first 401: **101 × 200 + 13 × 401**. The app does recover and ultimately renders correct data, but the request volume is pathological and would hammer the backend on any expired-token event.

Refresh-token reuse was tested and is **not** a factor: replaying a consumed refresh token returns 200, so there is no rotation race. The defect is purely missing client-side de-duplication plus retry/refetch amplification.

---

## 19. Static Analysis, Type Check, and Build

| Check | Result |
|---|---|
| `python manage.py check` | **PASS** — "System check identified no issues (0 silenced)." |
| `python manage.py makemigrations --check --dry-run` | **PASS** — "No changes detected" |
| `npx tsc --noEmit` | **PASS** — exit 0, no diagnostics |
| `npm run build` | **PASS** — built in 19.25 s, Nitro output generated, exit 0 |

The freshly built bundle was re-audited: 0 Supabase runtime markers.

---

## 20. Data Cleanup and Baseline Integrity

All mutation testing used tagged disposable rows (`PHASE6F PROBE …`), which were removed afterwards. Deletion order respected foreign keys (applications → candidates; job_requisitions; audit rows including orphans).

Final verified state — **every baseline exactly restored**:

| Table | Expected | Actual | Status |
|---|---|---|---|
| employees | 23 | 23 | OK |
| attendance_records | 296 | 296 | OK |
| employee_documents | 7 | 7 | OK |
| payroll_entries | 0 | 0 | OK |
| notifications | 40 | 40 | OK |
| leave_requests | 6 | 6 | OK |
| helpdesk_tickets | 5 | 5 | OK |
| candidates | 23 | 23 | OK |
| applications | 15 | 15 | OK |
| job_requisitions | 10 | 10 | OK |
| audit_logs | 15 | 15 | OK |
| shifts | 3 | 3 | OK |

Residual probe rows: **0** across `candidates`, `job_requisitions`, `audit_logs`, `employees`. No seeded or business data was mutated.

---

## 21. Defect Register, Risk Assessment, and Recommendations

| ID | Severity | Defect | Location |
|---|---|---|---|
| **D1** | **HIGH** | Both Recruitment CREATE actions return **HTTP 500** when optional fields are blank; explicit `null` violates `NOT NULL` on `job_requisitions.experience_min`, `job_requisitions.skills`, `candidates.experience_years` | `recruitment.tsx:155,162,227` |
| **D2** | MEDIUM | Raw PostgreSQL `IntegrityError` text and full failing-row `DETAIL` returned to the browser | `backend/hr/exceptions.py` |
| **D3** | MEDIUM | Token refresh not single-flighted — 21 `POST /auth/refresh/` for one page load | `core.ts:503-520` |
| **D4** | MEDIUM | Duplicate read amplification — 120 reads of 3 endpoints in 13.6 s after a 401 storm | query retry/invalidation config |
| **D5** | LOW/MED | Candidate added without a requisition is invisible: toast says "Candidate added to the pipeline" but the pipeline is application-driven, so a candidate with no application row never renders | `recruitment.tsx:129,252-256` |
| **D6** | MEDIUM | HR Admin sidebar shows `/admin/users`, `/admin/roles`, `/admin/ai`, all of which always deny HR Admin | `admin/users.tsx:173`, `app-sidebar.tsx` |
| **D7** | LOW | `audit_logs` for `job.created` writes `entity_id: null`, breaking audit traceability for requisitions | `recruitment.tsx:169-174` |
| **D8** | LOW | `@supabase/supabase-js` declared but unused; `.env` retains Supabase credentials including a publishable key | `package.json:46`, `.env` |

### Recommended remediation order

1. **D1** — Either omit the key instead of sending `null`, or coerce to the column default (`experience_min → 0`, `skills → []`, `experience_years → 0`). Better still, make these fields `required` in the form so the failure mode is impossible. This is a release blocker.
2. **D2** — Map `IntegrityError` to a generic 400/422 in the DRF exception handler; log `DETAIL` server-side only.
3. **D3/D4** — Add a single-flight promise around `refreshSession()` keyed on the refresh token, and cap retry amplification.
4. **D6** — Filter the sidebar with the same predicate the routes enforce, so hidden and denied never diverge.
5. **D5** — Either create a default application row when no requisition is chosen, or state plainly that a requisition is required.
6. **D8** — Remove the unused dependency and purge Supabase values from `.env`; confirm `.env` is not tracked by git.

### Verdict

**PHASE 6F: FAIL.** Read paths, authorization, session handling, UPDATE semantics, audit logging, and the build are all verified sound. The Recruitment CREATE path is broken for default user input (D1), which alone blocks sign-off. Re-run 6F-4 after D1 is fixed.

*Phase 6F ends here. Phase 6G has not been started.*