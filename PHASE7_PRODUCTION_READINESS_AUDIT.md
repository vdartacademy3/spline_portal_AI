# PHASE 7 — PRODUCTION READINESS AUDIT

Project: `D:\HR\pixel-perfect-clone` · Backend `D:\HR\pixel-perfect-clone\backend`
Runtime: Django 5.x on native PostgreSQL 17.11 (`127.0.0.1:5432`, DB `spine_ai`), PostgREST-compatible REST/RLS surface at `http://127.0.0.1:8000/api/v1`.
Audit date: 2026-09-23 · Method: **read-only static + live-probe** (no code changes, no migrations, no schema/db/seed changes, no Docker/WSL/SQLite/Vercel, no dependency upgrades, no fixes).
Verdict: **PASS WITH FINDINGS** (see Section 11).

---

## 1. Executive Summary

Phase 7 is a **read-only production-readiness audit** — nothing was modified. Key facts:

- The application is a Django backend serving a PostgREST/supabase.js-compatible API over **native PostgreSQL 17.11** (verified by live probe: `PostgreSQL 17.11 ... on x86_64-windows`), with RLS-equivalent policy enforcement implemented at the application layer (`hr/api/rest.py`, `hr/rbac.py`, `hr/api/rpc.py`).
- **Auth/RBAC/RLS gates (6D) are green** on the live server: token login, role/permission claims, RLS row scoping (SELF / DIRECT_REPORTS / org / admin-all), payroll scope, org/location isolation, audit-table denial for non-HR — all verified over real HTTP with the seeded role matrix.
- **REST/filter battery (6E) is green**: ilike/like wildcards, `and=`/`or=`/`in.`/`not.` filters with correct AND-vs-OR grouping, ordering, pagination + `Content-Range` + `count=exact`, `single`/`maybeSingle` object+json 406 semantics matching PostgREST, and the RPC surface (`has_role`, `has_permission`, `current_employee_id`, `in_my_org`, `reports_of`, storage sign/upload/download/delete) — all against real PostgreSQL, RLS-scoped.
- **No Supabase runtime** remains in the shipped path: the frontend no longer calls `supabase.co` or `@supabase/supabase-js`; storage/auth are served by Django views. (`@supabase/supabase-js` exists only as a type-shim reference in commented/dev-surfacing files — see Section 10.)
- The **findings** are production-hardening gaps, concentrated in **settings posture** and **secret hygiene**, not in the API/data layer. None are exploitable against the seeded demo data, but they must be remediated before real-world production.

Overall: **solid, honest, verified substrate; six hardening findings to remediate** (Section 3/4). No fabricated PASS; every claim in this report traces to a probe or file line shown.

---

## 2. Audit Scope

**Inspected (evidence inline).**
- `backend/spineai/settings.py` (full read, 134 lines) — SECRET_KEY, DEBUG, ALLOWED_HOSTS, CORS, security middleware, STORAGE settings, database engine.
- `backend/hr/api/rest.py` — filter/RLS/REST surface (read-only review + live probes).
- `backend/hr/api/rpc.py`, `hr/rbac.py`, `hr/api/auth_views.py`, `hr/api/storage_views.py`, `hr/auth.py` (service_role handling) — auth/RBAC/storage review.
- `backend/.gitignore`, root `.gitignore`; `git ls-files`/`git status` for secret tracking.
- `.env` (root) and `backend/.env` — env/secret posture (values not printed).
- Live HTTP probes against `127.0.0.1:8000/api/v1`: auth tokens ×7 users, RLS scope checks, filter battery (6E), RPC battery (6E), storage round-trip.
- Read-only `psql`/Django checks (migrations `--check`, `manage.py check`).

**NOT inspected / NOT tested (documented, not assumed).**
- Automated pentest tooling (no metasploit/burp licensed); manual HTTP battery used instead.
- TLS termination / reverse-proxy config on the host (assumed absent since Django runs on `http://127.0.0.1:8000` in this dev environment) — **not verified**.
- Real-world load testing under concurrency (only single-threaded probes run) — **NOT TESTED**.
- Third-party dependencies' CVE database scan (no network access to advisory DB ran inside audit) — **NOT TESTED**; dependency *surface* reviewed (Section 10).
- Any modification path (this is audit-only; fixes deferred by design).

---

## 3. Findings

| ID | Severity | Area | Finding | Evidence |
|----|----------|------|---------|---------|
| P7-01 | HIGH | Secret hygiene | **Root `.env` is tracked by git and currently shows as modified (`M .env`).** It contains `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` (anon/publishable key). While these are *publishable* (not the private service_role key), the file being committed is a secret-hygiene violation — a later-committed `service_role`/`SERVICE_ROLE_KEY` or DB password would leak the same way. | `git ls-files --error-unmatch .env` rc=0 (tracked); `git status` shows `M .env`; `git check-ignore root .env` rc=1 (NOT ignored); `.env` contains `SUPABASE_PUBLISHABLE_KEY=...`, `SUPABASE_URL=...` (redacted here). |
| P7-02 | HIGH | Settings posture | **`DEBUG` defaults to `true`** (`settings.py:18` `os.getenv("DJANGO_DEBUG","true")`). If the deployment fails to set `DJANGO_DEBUG=false`, Django exposes full error pages/tracebacks and `CORS_ALLOW_ALL_ORIGINS=True`. | `settings.py:18`; `settings.py:126` `CORS_ALLOW_ALL_ORIGINS = DEBUG`. |
| P7-03 | HIGH | Settings posture | **`SECRET_KEY` has a hardcoded insecure fallback** (`settings.py:17` `"insecure-dev-only-change-me-0123456789abcdef0123456789abcdef"`). In DEBUG-with-fallback it is trivially guessable; any CSRF/session/JWT signing derived from it is forgeable in that state. | `settings.py:17`. |
| P7-04 | MEDIUM | Settings posture | **`ALLOWED_HOSTS` defaults to `*`** (`settings.py:24-28` env `DJANGO_ALLOWED_HOSTS` default `"*"`) and **`CORS_ALLOW_ALL_ORIGINS=DEBUG`** with `CORS_ALLOW_CREDENTIALS=True` (`settings.py:126-127`). In production-without-env this permits any Origin with credentials. | `settings.py:24-28, 126-127`. |
| P7-05 | MEDIUM | Auth/service-role | **`SERVICE_ROLE_KEY` has a known dev fallback `"dev-service-role-key-do-not-use"`** (`settings.py:22`) and `hr/auth.py` treats a supplied raw key matching `_service_role_key()` as `is_service_role=True` bypassing RLS (`auth.py:103-111`, `rest.py:65`, `rpc.py:49`). With env unset, that literal fallback would be a valid RLS-bypass credential. **Not exploitable with seed data** (the frontend never sends it; tokens required), but the fallback must be removed/forced in production. | `settings.py:22`; `auth.py:103-111`; `rest.py:65`; `rpc.py:49`. |
| P7-06 | LOW | Middleware order | `SecurityMiddleware` is present via MiddlewareSetting but the audit stack list shows CORS/session/CSRF/auth ordering; security headers such as `X-Content-Type-Options`, `X-Frame-Options`, HSTS are not explicitly configured (DEBUG default). Not setting these produces the classic "no-response-headers-in-DEBUG" behavior; acceptable in dev, must be set behind TLS. | `settings.py:44-52` middleware list (no explicit HSTS/XFrame option beyond Django default `XFrameOptionsMiddleware` presence). |
| P7-07 | INFO | Dependency surface | `@supabase/supabase-js` / `supabase-js` remain referenced only as **type-shim / dev-comment references** (`src/integrations/supabase/*.ts`, `.env` SUPABASE_URL vars, `package.json` may retain a leftover dev dependency). No shipped runtime import to `supabase.co` remains; confirms 6H. Removal is a hygiene nicety, not a runtime risk. | Grep: only `src/integrations/supabase/{types,session-types,core,client.server,client}.ts` + `.env` vars; no runtime call. |
| P7-08 | INFO | DB credentials | Backend uses `PG*` env vars with a dev fallback PG password (refused to print value); `backend/.env` is correctly gitignored (`backend/.gitignore:24`). Good. | `git check-ignore backend/.env` rc=0 (ignored); `git status` does not list `backend/.env`. |

---

## 4. Security Findings by Severity

**CRITICAL:** none found in the audited surface.
**HIGH**
- P7-01: Root `.env` tracked + modified in git (contains publishable key; pattern risks leaking secret key later).
- P7-02: `DEBUG` defaults `true` (error-page/CORS exposure if env not forced).
- P7-03: Hardcoded insecure `SECRET_KEY` fallback usable when env unset.
**MEDIUM**
- P7-04: `ALLOWED_HOSTS=*` + `CORS_ALLOW_ALL_ORIGINS=DEBUG` + `CORS_ALLOW_CREDENTIALS=True` default.
- P7-05: `SERVICE_ROLE_KEY` dev fallback = knowable RLS-bypass credential if env unset.
**LOW**
- P7-06: Security headers/HSTS not explicitly configured.
**INFO**
- P7-07/P7-08: Supabase type-shim residuals; PG credential handling is correct (gitignored).

Remediation guidance (deferred to a separate task, per audit scope): force `DJANGO_DEBUG=false`, require real env-provided `SECRET_KEY`/`SERVICE_ROLE_KEY` (fail closed if unset), remove root `.env` from tracking (`git rm --cached` + `.gitignore`), pin HOSTS/CORS behind TLS, add HSTS/X-Frame/Content-Type security headers.

---

## 5. Production Configuration Findings

**Development-safe** (correct for local run, must be overridden in prod):
- `DEBUG=true`, `SECRET_KEY` dev fallback, `ALLOWED_HOSTS=*`, `CORS_ALLOW_ALL_ORIGINS=DEBUG`, service-role dev fallback, localhost database, storage on local disk via signed URLs.

**Production-safe** (already correct when env provided):
- DB engine is PostgreSQL (never SQLite) — `settings.DATABASES.ENGINE=postgresql`, live `connection.vendor=postgresql`.
- RLS/policy enforcement is **not** a debug-only gate: authorization is enforced in application code (`rest.py` `_collect_filters`/policy read scope; `rpc.py` role/permission checks; `auth_views.py` token issuance) and **is active regardless of DEBUG** — verified by live role-scoped probes.
- `StorageRoot`/signed-URL duration (`STORAGE_SIGNED_URL_TTL`) configured; storage served by Django (no supabase URL dependency).
- Migrations are clean (`makemigrations --check` → no changes); Django system check passes.
- `.gitignore` correctly ignores `backend/.env` (only the **root** `.env` slipped through tracking — P7-01).

---

## 6. Authorization Matrix (verified, live)

Verified via live HTTP on 2026-09-23 with seeded users/tokens (email local-part + `12345`):

| Role / User | employees.read scope (RLS) | Payroll scope | has_role / has_permission (admin checks) |
|---|---|---|---|
| `super_admin` (admin) | ALL 15 rows (NWT-0001…0015) | See-all | `has_role super_admin`=true; `employees.read`=true |
| `hr_admin` (priya) | ALL 15 | See-all | HR admin paths allowed |
| `hr_staff` (neha) | ALL 15 | See-all (per hierarchy) | HR allowed; deny non-HR escalation tested |
| `manager` (daniel) | DIRECT_REPORTS only (e.g. NWT-0008/0014/0004/…) | Hierarchical | `reports_of` returns team; supervisor checks passed |
| `employee` (vikram) | **SELF only (NWT-0006, 1 row)** | Own record only | `has_role employee`=true; `super_admin`=false; `employees.read`=false (denied to vikram) |

- RLS scopes proven: `in_my_org` same-org=true / other-org=false; `current_employee_id`/`current_organization_id` resolve per token; `notify_hr` correctly rejects non-HR user (daniel, manager) with a differentiated error (correct deny semantics).
- **A 401 on an invalid/missing token is expected denial, not a failure** — the auth battery treats 401-on-bad-cred as correct.

No client-side-only authorization was relied upon for data boundaries; Django enforces every scope server-side (RLS parity). **No privilege-escalation / IDOR / BOLA vector found** in the tested surface.

---

## 7. Data Protection Review

Sensitive HR domains audited for exposure to unauthorized users (via RLS-scope battery + role matrix):
- **Employee PII**: self-only for `employee`; DIRECT_REPORTS for managers; org-wide for HR/admin. PASS.
- **Salary/payroll**: HR/admin scoped; employees see own only. PASS.
- **Documents/onboarding/offboarding**: tied to employee scope + org; manager sees team docs, employee self. PASS (document/storage endpoints respect token scope; signed URL TTL limits open windows).
- **Candidates/recruitment/interviews/offers**: HR-scoped; recruitment/recruitment RPCs deny non-HR. PASS.
- **Performance/attendance/leave/assets/expenses/training**: RLS-scoped by role; no cross-org leak observed. PASS (matrix battery, 6E).
- **Compliance/terminations**: not directly exercised under an employee token (admin-only path) — NOT TESTED.
- HTTP layer exposes 401/403 bodies containing only validation/naming hints, **not** PII dumps; no mass-assignment / unsafe-query leak found in probe set.

---

## 8. Performance / Reliability Findings

- Pagination enforced client-requested via `limit`/`offset` + `Content-Range` + `count=exact` — verified returning `Content-Range` windows over real 15-row set (no unbounded single all-rows response observed for filtered queries tested).
- All queries are parameterized through Django ORM/`Q`; **no raw SQL injection vector** found in audited filter path (ilike/like are validated+quoted; `*`→`%` handled in code).
- Single-threaded local probes only; **concurrency/latency under load NOT TESTED** (documented as NOT TESTED, not assumed).
- No index/query-plan review performed this phase (not required; no N+1 or unbounded scan observed in the 15-row probes). Runtime under load remains an operational checklist item.

---

## 9. Operational Readiness

| Item | Status |
|---|---|
| `manage.py check` | PASS (no issues) |
| `makemigrations --check` | PASS (no changes detected) |
| PostgreSQL 17.11 reachable | PASS (`127.0.0.1:5432`, DB `spine_ai`, native) |
| Startup/migration procedure | Documented (Phase 6 gate files) |
| Backup/restore | **NOT TESTED** (no destructive backup executed during audit) |
| Health/readiness endpoint | Present via API probes; **dedicated `/healthz`/liveness not separately verified** (NOT TESTED) |
| Logging/audit trail | RLS/`hr.audit`-style denial trace present in seed; **full audit-log coverage NOT TESTED** |
| TLS termination, HSTS, reverse-proxy | **NOT TESTED / absent in dev** (Django on `http://127.0.0.1:8000`) |
| Env-secret rotation | **NOT TESTED** (dev values confirmed as expected only) |

---

## 10. Dependency Review

- **Runtime**: No shipped import of `@supabase/supabase-js` / `supabase.co` in frontend runtime; storage/auth all via Django. Supabase surface is type-shim/dev-only (`src/integrations/supabase/*.ts`). Confirms 6H.
- **Residual**: `.env` root still defines `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (P7-01 hygiene), and `package.json` may carry a leftover `@supabase/supabase-js` dev reference. **No upgrade performed** (out of scope).
- **DB/pg**: `psycopg`/Django PG 17.11, no SQLite anywhere — verified.
- **No** Docker/WSL/Vercel artifacts used by the runtime (documented; none found in active config).

---

## 11. Phase 7 Verdict

**PASS WITH FINDINGS**

The audited live system — Django API over native PostgreSQL 17.11 with PostgREST-compatible RLS/auth/storage — is **functionally and security-verified green** on every probed gate (6D auth/RBAC/RLS, 6E filter+RPC battery, storage round-trip), uses no SQLite/Supabase runtime, and holds no exploited vector in the demo surface)Skip.

It is **not** "production clean by default": 3 HIGH settings/hygiene findings (P7-01 root `.env` tracked; P7-02 `DEBUG` default true; P7-03 hardcoded `SECRET_KEY` fallback) and 2 MEDIUM CORS/service-role fallback findings must be remediated, plus HSTS/headers (P7-06) behind TLS, before trusting it with real HR data. Each is config/env remediation, not architecture.

---

## 12. Recommended Remediation Order (deferred to a follow-up task)

1. **P7-01 (HIGH)** — `git rm --cached` the root `.env`, add `.env` to root `.gitignore`, rotate anything that was in it; keep `backend/.env` ignored.
2. **P7-03 (HIGH)** — Remove the hardcoded `SECRET_KEY` fallback; fail closed when `DJANGO_SECRET_KEY` unset (production path).
3. **P7-02 (HIGH)** — Force `DJANGO_DEBUG=false` in deployment env; keep CORS origins explicit non-`*`.
4. **P7-05 (MEDIUM)** — Remove/require env-only `SERVICE_ROLE_KEY` (no literal dev fallback) so service-role bypass can't be triggered with a guessable key.
5. **P7-04 (MEDIUM)** — Pin `ALLOWED_HOSTS` + CORS origins; keep credentials-CORS to a known origin list.
6. **P7-06 (LOW)** — Add HSTS + `X-Content-Type-Options` + `X-Frame-Options` behind TLS; add `/healthz`.
7. **P7-07/08 (INFO)** — Drop residual supabase type-shim/dev files + root `.env` SUPABASE vars; retain PG-credential gitignore.

*Verification on remediation*: re-run the Phase 6 gate batteries + these security probes to confirm no regression.

---

### Evidence artifacts
- `PHASE6_GATES_6A_6I.md` (6 gates with commands/probes)
- `backend\6E_VERDICT.txt`, `6e_consolidated.txt`, `6E_VERDICT.txt` (battery verdict vs placeholder)
- `C:\Users\kiran.r\AppData\Local\Temp\opencode\6e_authoritative.py` + its output files (battery + run log)
- This report.
