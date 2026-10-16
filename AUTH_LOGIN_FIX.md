# AUTH_LOGIN_FIX — Account Creation + Login/Session Flow

**Status: PASS**

Date: 2026-09-24
Scope: account creation → login (token) → session persistence → session restoration →
authenticated app (dashboard + data reads) → logout.
No RBAC, no schema, no Supabase Auth, no Shortlist AI / Phase 10 changes were made.

---

## 1. Root causes (all confirmed in a real browser, not assumed)

Every root cause below was proven while driving the actual UI in headless Chrome
(auth origin `http://127.0.0.1:8080` → API `http://127.0.0.1:8000`).

1. **Browser 415 on every auth request (account creation + login broken in UI).**
   `rawFetch()` in `src/integrations/supabase/core.ts` set a string body but never a
   `Content-Type` header. When a `fetch` body has no Content-Type, the browser defaults it
   to `text/plain;charset=UTF-8`. Django REST Framework then rejects with
   `415 Unsupported media type` (`request.data` cannot parse text/plain as JSON).
   This reproduced in the UI as a toast
   `Unsupported media type "text/plain;charset=UTF-8" in request.` on signup.
   API-level probes passed because they explicitly set `application/json` — the defect was
   browser-side (matches the original report that the raw endpoint returned 200 while the UI
   could not create an account).
   Affected: `signUp`, `signInWithPassword`, `getClaims`, `resetPasswordForEmail`,
   `refreshSession`.

2. **CORS preflight rejects `Prefer` → all app data reads blocked in the browser.**
   The SPA's `QueryBuilder` sends `Prefer: count=exact / return=representation / resolution=...`
   on every read/write (PostgREST style). django-cors-headers' default
   `Access-Control-Allow-Headers` list does not include `prefer`, so Chrome refused the
   preflight and never sent the actual GET. Browser log (repeated):
   `Access to fetch at '…/api/v1/public/user_roles/…' from origin 'http://127.0.0.1:8080' has
   been blocked by CORS policy: Request header field prefer is not allowed by
   Access-Control-Allow-Headers in preflight response.`
   This broke `AuthProvider.loadContext` (user_roles/profiles/employees) and every dashboard
   tile (departments, leave_requests, attendance, job_requisitions, ai_insights,
   employee_documents, notifications, performance_reviews, role_permissions).
   Also, `CORS_EXPOSE_HEADERS` was unset, so the `Content-Range` count totals were not
   readable by `countExact` queries.

3. **Signup dropped the full name.**
   `handle_new_user` (`backend/hr/triggers.py`) read `getattr(user, "full_name", "")` which
   does not exist on `AppUser`, so `Profile.full_name` (and
   `user.user_metadata.full_name`) fell back to the email address.

4. **CORS origin (contributing).**
   The Lovable Vite dev server runs on port **8080**; the DEBUG `CORS_ALLOWED_ORIGINS` list
   only allowed 5173/8000. Without 8080, even properly-formed JSON preflights for the app's
   origin would have been rejected. Fixed alongside #2.

---

## 2. Files changed

| File | Change |
|---|---|
| `backend/spineai/settings.py` | DEBUG CORS allow-list: added `http://127.0.0.1:8080` / `http://localhost:8080`; added `CORS_ALLOW_HEADERS` incl. `prefer` and `cache-control`; added `CORS_EXPOSE_HEADERS = ("content-range",)` — only the headers the client actually sends/reads (QueryBuilder: `Prefer`; storage uploads: `Cache-Control`; count totals: `Content-Range`). `Accept-Profile/Content-Profile/Range` are not produced by this client, so not added. |
| `backend/hr/triggers.py` | `handle_new_user`: compute `full_name` from `first_name`/`last_name` (fallback: existing `full_name` attr, else email). |
| `src/integrations/supabase/core.ts` | `rawFetch()`: when a body is provided, default `Content-Type: application/json` unless the caller's headers already set one. Callers that pass their own headers (`authHeaders`, QueryBuilder run) are unchanged. |

`backend/hr/api/auth_views.py` was inspected and did **not** need a change.

---

## 3. Auth/API flow — before vs after (browser)

| Step | Before | After |
|---|---|---|
| Signup POST `/api/v1/auth/signup/` | Browser sent `text/plain` → **415** | `application/json` → **200**, session issued |
| Login POST `/api/v1/auth/token/` | **415** in browser | **200**, access + refresh token |
| profile.full_name after signup | email (name lost) | entered name ("UI Test Person") |
| `AuthProvider.loadContext` + dashboard data reads | Preflight **rejected** (prefer not allowed) → `net::ERR_FAILED`, no data | Preflight **200** with `prefer` allowed → all GETs **200**, data loads |
| `count=exact` totals | `Content-Range` not exposed → no counts | `content-range: 0-0/N` readable |
| Session persistence | impossible (no session) | `localStorage["spine-session"]` (access_token, refresh_token, expires_in 86400, user incl. full_name) |
| Reload / refresh | lost | session restored, stays on `/dashboard` |
| Sign out | n/a | `POST /api/v1/auth/logout/` **200**, storage cleared, redirect `/auth` |
| Account menu label | n/a | "UI Test Person | Employee" (role `employee` assigned by signup trigger) |

---

## 4. Evidence (real-browser E2E, headless Chrome + CDP)

Driver: `C:\Users\kiran.r\AppData\Local\Temp\opencode\ui_e2e_final.mjs`
Browser: Chrome 153, `--headless=new --remote-debugging-port=9222`, origin
`http://127.0.0.1:8080` (Vite dev, PID 13964); Django runserver PID 9248 on 127.0.0.1:8000.

E2E run (`uitest-mufbc9vj@example.com`):

```json
{
  "session": { "hasAccess": true, "email": "uitest-mufbc9vj@example.com", "fullName": "UI Test Person" },
  "failedRequestsDuringLoad": [],
  "contentRangeExposed": { "status": 200, "contentRange": "0-0/1", "countableRows": "1" },
  "afterRefresh": { "path": "/dashboard", "sessionStillThere": true },
  "menuLabel": "UI Test Person | Employee",
  "logout": "clicked-menuitem-styled",
  "afterLogout": { "path": "/auth", "sessionCleared": true },
  "failedRequests": [],
  "preferBlocked": 0
}
```

- **Zero** `prefer is not allowed by Access-Control-Allow-Headers` errors (`preferBlocked: 0`,
  and no CORS log entries during the whole run).
- **Zero** failed `Fetch` network events (`failedRequests: []`).
- Preflight (Origin 8080) now returns
  `Access-Control-Allow-Headers: accept, authorization, content-type, user-agent, x-csrftoken, x-requested-with, prefer, cache-control`.
- Server access log confirms all loadContext + dashboard queries returned **200**
  (`user_roles`, `profiles`, `employees`, `departments`, `leave_requests`,
  `attendance_records`, `job_requisitions`, `ai_insights`, `employee_documents`,
  `notifications`, `performance_reviews`, `role_permissions`), plus
  `POST /api/v1/auth/logout/` → 200.
- One benign log entry: a `401` on `role_permissions/` fired by a straggler refetch during
  the logout transition (token already cleared) — handled by the app's auth guard (redirect
  to `/auth`), not a flow failure.

---

## 5. Cleanup

Only temporary test accounts were touched; no pre-existing users modified/deleted.
Delete via service-role admin API (`DELETE /api/v1/auth/admin/users/<id>` → 204 each):

- `uitest-muf90cb4@example.com` (73a0d170-…)
- `uitest-mufb98bk@example.com` (b7167a71-…)
- `uitest-mufbc9vj@example.com` (83fb6b4c-…)

After cleanup: re-list shows **0** remaining temp accounts; residue checks for all three
deleted ids: `profiles → []`, `user_roles → []`, `employees → []` (cascade worked).
Total user list back to the pre-existing population (5 demo users + original admins).

---

## 6. Validation gates

| Gate | Result |
|---|---|
| `python manage.py check` | System check identified no issues (0 silenced) |
| `python manage.py makemigrations --check --dry-run` | **No changes detected** |
| `npx tsc --noEmit` | exit 0, no errors |
| `npm run build` | `✓ built` (client, ssr, nitro; `cloudflare-module` preset). Only pre-existing deprecation warnings (`createServerFn().inputValidator()`) — no errors |

---

## 7. Remaining issues / out of scope

- Pre-existing, unrelated to account creation (SignupView/TokenView do not go through RLS policies).
  Static inspection found the two `backend/hr/policies.py` defects — `org_check` insert-arity and
  `perm_write`-as-INSERT — already **MITIGATED (offline)** by `_adapt_insert`/`_adapt_check` plus the
  `perm_write(user, old, new, code=…)` predicate; 25 offline regression tests
  (`backend/hr/tests_insert_policy_arity.py`) passed. Limitations: Live PostgreSQL verification
  NOT VERIFIED; real RBAC/database lookups NOT VERIFIED; cross-organization isolation against a second
  organization NOT VERIFIED; live HTTP error mapping NOT VERIFIED. No production code was changed.
- Verified the browser `401` during logout is a harmless race, not a defect.
- Deprecation warnings for `createServerFn().inputValidator()` are cosmetic (build-stable).
- No empty/`null` session edge-case surfaced in the reviewed flow; the E2E used
  `expires_in=86400`.

## Final: **PASS** — account creation → login → session persistence → reload restoration →
authenticated app (data reads) → logout all work end-to-end in a real browser.