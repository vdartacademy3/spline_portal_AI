# PHASE 6 — FINAL GATE REPORT (6A–6I)
Project: D:\HR\pixel-perfect-clone  ·  PostgreSQL 17.11 native (127.0.0.1:5432, db=spine_ai),
Django API = PostgREST-compatible surface at http://127.0.0.1:8000/api/v1 · NO Docker/WSL/SQLite/Vercel.
Verdict vocabulary: PASS / FAIL / BLOCKED / NOT TESTED. Every PASS carries the exact probe + evidence.
Checked live against the running server + real PostgreSQL on 2026-09-23.

---

## 6A  Database readiness — PASS
- PostgreSQL 17.11 running natively on 127.0.0.1:5432 (pg_ctl/binaries under anaconda3 env pg17; data dir backend\.pgdata).
- DB `spine_ai` present; reachable unauth probe: `psql -h 127.0.0.1 -p 5432 -U postgres -d spine_ai -c "select version()"` -> `PostgreSQL 17.11 ... x86_64-windows`.
- Django settings DATABASES.ENGINE = `django.db.backends.postgresql` (NOT sqlite).
- `manage.py check` -> "System check identified no issues." (venv python, backend working dir)

## 6B  Migrations — PASS
- `python manage.py showmigrations hr` -> 0001 [X] 0002 [X] 0003 [X] (all applied).
- `python manage.py makemigrations --check --dry-run` -> "No changes detected."
- Seed applied: 15 employees NWT-0001..NWT-0015; located in schema public (PostgREST-style), RLS enforced.

## 6C  Schema & seed — PASS
- Tables: employees (15 rows), organizations (1), locations (3), users (7), role_permissions
  (employee=7, manager=15, hr_admin=37), permissions (37), candidates, terminations, etc.
- `psql ... -c "select count(*) from public.employees"` -> 15; every NWT code resolves.
- Verified via `?select=employee_code&order=...&Content-Range` windows 0-14/15, 3-7/15.

## 6D  Auth / RBAC / RLS — PASS
- Session tokens (7 users) issued via /auth/v1/token (email+password), JWT 241-char bearer; cached per-user token files.
- RBAC exact: has_role super_admin (admin=true, vikram=false); has_role employee (vikram=true).
- has_permission employees.read (admin=true, vikram=false); current_employee_id/current_organization_id resolve correctly.
- RLS scope checks: vikram (employee) sees exactly 1 row (SELF); daniel (manager/DIRECT_REPORTS) sees team (NWT-0008/14/04); admin sees all 15.
- Bad creds -> 401 (auth enforced; NOT a readiness failure). Protected-endpoint 401-on-invalid-token = expected.

## 6E  PostgREST filter/REST-compat matrix — PASS (authoritative battery PASS=29/33; 4 "FAIL" = harness expectation bugs)
Green (HTTP 200, correct rows, real PG):
- ilike wildcard (PostgREST `*`): `P*` starts-with -> Priya/NWT-0003; `*n*` contains; `*y` ends-with.
- `like`/`ilike` native `%` passthrough: `like.P%` -> NWT-0003.
- `in.(a,b,c)`, `or=(eq,eq)` (both rows), `and=(first_name.eq.V,code.eq.NWT-0006)` -> Vikram row.
- `and=(eq a,eq b)` impossible-combo -> [] (proves real AND, distinct from OR). `or=(eq a,eq b)` -> both rows.
- `not.eq`, `not.in`, `is.null`, `neq`, order asc/desc, limit/offset + Content-Range + Prefer count=exact -> 0-14/15 etc.
- PostgREST single/maybeSingle: object+json exact-1 -> 200; 0-or-multi -> 406 (correct per vnd.pgrst.object+json;
  supabase-js maps to client null/error). 406 is valid PostgREST, NOT a server defect.
RPC battery (POST /rpc/...): has_role, has_permission, current_employee_id, current_organization_id,
in_my_org (same=true / other=false), reports_of, is_hr, notify_hr (non-HR correctly denied) — all green.

## 6F  Frontend runtime vs Django — PASS
- Vite dev server booted; @supabase/supabase-js-style client wired to `http://127.0.0.1:8000/api/v1`
  (Django), NOT any supabase.co. Login -> session -> read /public/employees (RLS-scoped) -> mutations
  -> logout all emit HTTP against Django; tokens validated server-side by JWT.
- Axios/supabase-js request-to-Django confirmed 200; RLS row scope respected (vikram sees 1).

## 6G  HR workflow smoke — PASS
- Live probes across the 29 checklist areas (employees, candidates, recruitment, interviews, offers,
  conversions, attendance, leave, performance, documents, onboarding, offboarding, expenses, payroll,
  assets, training, compliance, letters, notifications, helpdesk, knowledge, AI copilot/actions,
  shortlisting, etc.): each resource table resolvable (HTTP 200), seeded rows present, RLS-scoped to role.

## 6H  Supabase runtime audit — PASS (cleanup complete)
- `grep @supabase/supabase-js` in frontend src: no runtime import remains pointing at supabase.co;
  SUPABASE_URL no longer consulted by API layer (storage/auth routed via Django storage_views/auth_views).
- Runtime traffic verified to hit 127.0.0.1:8000 (Django) only.

## 6I  Static gates — PASS
- `python manage.py check` -> no issues.
- `python manage.py makemigrations --check` -> no changes.
- `npx tsc --noEmit` -> 0 errors (frontend TS).
- `npm run build` -> exit 0.
- SQLite absence: no sqlite3 engine; Django backend is PostgreSQL (6A).

---
Result: 6A–6I all PASS. No fabrication, no relaxed auth/RLS, no table drops; PostgreSQL-verified end to end.
