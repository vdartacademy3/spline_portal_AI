# Phase 7 — Final Verification (P7-XX)

**Scope:** `D:\HR\pixel-perfect-clone` (Spine AI / pixel-perfect-clone).
**Date of run:** 2026-09-23 (fresh; no prior result reused).
**Backend runtime:** Django + DRF on PostgreSQL 17.11 / DB `spine_ai` (VENDOR=postgresql). No SQLite, Docker or WSL.
**Server state:** Django dev server restarted on `127.0.0.1:8000` after the P7-08 fix to load fresh code.
**Sources:** `PHASE7_PRODUCTION_READINESS_AUDIT.md`, `PHASE7_PRODUCTION_READINESS_REMEDIATION.md`.

---

## A. P7-01..P7-06 verification snapshot

| ID | Severity | Finding | Verification evidence | Status |
|----|----------|---------|----------------------|--------|
| P7-01 | HIGH | Root `.env` tracked by git | `git ls-files --error-unmatch .env` → error (untracked); `git status` shows staged-deletion `D .env`; `.gitignore` has `/.env`, `/.env.*`, `!.env.example`, `backend/.env`. `git add -n .env.example backend/.env.example` → would add both (templates trackable). Root `.env.example` (3 keys, placeholder-only) and `backend/.env.example` (9 keys, placeholder-only) exist. | FIXED — verified |
| P7-02 | HIGH | DEBUG/ALLOWED_HOSTS posture | `settings.py:51` `DEBUG = _env_bool("DJANGO_DEBUG", default=False)`; probe with `DJANGO_DEBUG=false` → raises `ImproperlyConfigured` unless explicit hosts given (`settings.py:64-70`). Live probe: fully-configured production env loads with `DEBUG=False`, `ALLOWED_HOSTS=['hr.example.com']`. | FIXED — verified |
| P7-03 | HIGH | SECRET_KEY / DB secrets | `settings.py:36-42` raises when `DJANGO_SECRET_KEY` unset (explicit, no known default); source grep shows no `supabase.jwt_secret` / dev fallback literals. Live battery: `SECRET_SET=True`, no-dev-fallback gates pass. | FIXED — verified |
| P7-04 | HIGH | CORS allow-all | `settings.py:170` `CORS_ALLOW_ALL_ORIGINS = False`; production requires explicit `DJANGO_CORS_ORIGINS` (`settings.py:184-191`). Battery: `CORS_ALLOW_ALL=False`; probe returns `CORS_ALLOW_ALL=False + explicit origins`. | FIXED — verified |
| P7-05 | HIGH | SERVICE_ROLE_KEY hardcoded fallback | `settings.py:47` reads solely from env, empty ⇒ service-role bypass unavailable (fail safe); no fallback literal (grep verified). | FIXED — verified |
| P7-06 | MEDIUM | HSTS / HTTPS hardening not env-gated | `settings.py:210-225`: HTTPS flags (HSTS, SSL_REDIRECT, secure cookies) all gated behind `DJANGO_HTTPS=true`; plain-HTTP local dev unchanged. Note: local run is plain HTTP, so HSTS behaviour is **not** claimed as exercised (see Section G). | FIXED — verified (env-gated; runtime on plain HTTP remains local-dev only) |

---

## B. Runtime regression battery — fresh run

Battery: `C:\Users\kiran.r\AppData\Local\Temp\opencode\p7_battery.py` (48 original gates + 1 added P7-08 gate = **49 gates**).
Recorded on 2026-09-23 against the restarted Django server **after** the P7-08 fix. Result: **49/49 PASS, failed=0, exit rc=0.**

Key live results (redacted, never private values):
- **auth:** bad-credentials 401; session 200 (+id present); no-token 401; refresh-with-access-token 401; claims 200; `/admin/users` employee 401 / admin 200.
- **RBAC RPC:** has_role admin true / employee false; has_permission 200; current_employee_id / current_organization_id 200; in_my_org own true / other false; reports_of manager+employee 200; notify_hr non-HR **403** (was 500) / unauthenticated **401** / admin 200; is_hr true/false.
- **RLS / REST:** admin / hr_admin / hr_staff 15 rows; manager 6 rows; employee 1 (self); cross-user 0 rows; employee POST 401; admin zero-row PATCH 204.
- **Storage:** bad-sig signed URL 401; authenticated GET missing 404; sign-missing 404; path traversal 400; PUT 200; signed-URL GET (authed) 200; DELETE cleanup 200.
- **Django posture:** `manage.py check` rc=0; `makemigrations --check --dry-run` rc=0; settings probe rc=0 → VENDOR=postgresql, SECRET_SET=True, CORS_ALLOW_ALL=False, no code-fallback literals.
- **Frontend gates:** `npx tsc --noEmit -p tsconfig.json` rc=0; `npm run build` rc=0 (client+SSR+Nitro, deprecation warnings only).
- **Database:** `SELECT server_version()` → 17.11; `current_database()` → `spine_ai`.

Prior baseline (2026-01-29): 48/48. This run is a fresh, independent 49/49 (48 baseline + the new notify_hr-unauthenticated gate).

---

## C. Supabase runtime audit

Scope scanned: `src/**` (ts/tsx), `backend/**/*.py`, `package.json`, build output `.output/**`.

| Classification | Evidence | Action |
|----------------|----------|--------|
| ACTIVE RUNTIME | None. No shipped import of `@supabase/supabase-js` or call to `supabase.co` in source or in `.output`. | none |
| COMPATIBILITY SHIM (runtime) | `src/integrations/supabase/client.ts`, `client.server.ts`, `core.ts`, `auth-middleware.ts`, `auth-attacher.ts` implement a `SpineClient` that talks to the local Django backend (`VITE_API_URL`/`API_URL`), shape-compatible with the old supabase-js client. ~66 module imports of `@/integrations/supabase/client` across `src`. | none — legitimate, required runtime |
| TYPE-ONLY | `session-types.ts`, `types.ts` (structural stand-ins); `@supabase/supabase-js` only mentioned in comments. | none |
| DEAD DEV REFERENCE | `package.json:46` still lists `"@supabase/supabase-js": "^2.116.0"` (no source import; only comments). Removal is a hygiene nicety only. | none performed (out of scope; no runtime risk) |
| DOCUMENTATION | `backend/*.py` docstrings reference "Supabase"/"postgrest" as compatibility notes; `hr/exceptions.py` echoes postgrest error shape to preserve the frontend error contract. | none |
| ENV LEFTOVERS | `.env` (root, untracked + ignored) still defines `SUPABASE_URL` / `VITE_SUPABASE_URL` etc. No source reads them (`grep SUPABASE_URL src` → none). | none (file is ignored/untracked; not removed) |

Conclusion: **No Supabase runtime remains.** All traffic goes to the Django backend; supabase surface is compat-shim + type shims only. Consistent with Phase 6H/7S.

---

## D. Secret-leakage audit

Method: targeted scan over **git-tracked files only** (149 files), plus a token-pattern scan (JWT `eyJ…`, `ghp_`, `sk-`, `AKIA`, `xox`, `AIza`). All matched values were redacted before output; nothing private was printed.

- Token-pattern scan over tracked files: **0 hits**.
- Keyword scan (password/secret/api_key/token/service_role/private_key…): **59 redacted matches, all benign** — examples: markdown plan text (docs about setup passwords), `drizzle/migrations/*.sql` grants `… to service_role` (SQL role grants, not credentials), UI components (`password` field names), `knowledge.test.ts` mocks, `ai.functions.ts`/`knowledge.ts` reading `LOVABLE_API_KEY` from `import.meta.env` (env-read, no literal).
- Environment files: **no `.env*` file is tracked** (`git ls-files` → none). Root `.env` is staged-deleted + ignored; `backend/.env` is ignored. Both `.env.example` templates are placeholder-only and trackable.
- Built output: no `supabase.co` refs; no secret values in `.output`.

Conclusion: **No secret leakage in tracked content.** The only private material lives in untracked, git-ignored local env files (dev opt-ins, Section F P7-10).

---

## E. Git working-tree / config hygiene

- `.gitignore` correctly covers: `node_modules`, `.output`, `backend/.env`, `/.env`, `/.env.*` (with `!.env.example`), etc.
- `git status --short`: staged deletion `D .env` (P7-01) plus the pre-existing `M` set of frontend files (format + Phase 6 changes already in the tree from earlier work — pre-existing, not introduced by this session). Unknown/untracked files are: `.env.example`, three PHASE reports, `backend/`, two new drizzle migration SQL files, `package-lock.json`, and several new `src/**` files from earlier Phases — all pre-existing, none from this pass.
- `git ls-files` contains **no** `.env`, keys/certs (`.pem/.key/.p12/.pfx`), `*.log`, SQLite/`.db`, or `/storage/` artifacts.
- Note (hygiene, no change made): the entire `backend/` directory is **untracked and not ignored** (`git check-ignore -v` → no rule; `git add -n` would stage it). This predates this session; committing the backend has not been requested and was left untouched.

Conclusion: no unexpected tracked secrets/binaries/logs; the only staged change is the intended `.env` untrack (P7-01).

---

## F. P7-07 .. P7-10 resolution

| ID | Finding | Verification | Resolution |
|----|---------|--------------|------------|
| P7-07 | INFO — signed-URL anonymous download blocked by DRF default `IsAuthenticated` | Storage view class has no `permission_classes` override, so DRF default `IsAuthenticated` rejects anonymous requests BEFORE the signed-URL branch in `storage_views.py:98-108`. Live test: valid signed URL **anond GET → 401**, **authed GET → 200**, cleanup OK. | **VERIFIED — NO FIX REQUIRED** (fail-closed, pre-existing). Storage auth intentionally not loosened. |
| P7-08 | HIGH — RPC authorization denials return HTTP 500 | Root cause `backend/hr/api/rpc.py:33-34`: `_pgrst_error` built `APIException(detail=…, code=str(http_status))` but never set `status_code`, so DRF served 500. `rest.py:76-80` already did it correctly. Fix: mirror rest.py (set `err.status_code = int(http_status)`; body `code` keeps the postgrest code, e.g. `42501`), and the two **authenticated-but-unauthorized** call sites (`rpc.py` `_claim` cross-user id and `notify_hr` non-HR) now pass `403` instead of `401`. Policy unchanged; unauthenticated stays 401 via DRF `IsAuthenticated`/BearerAuth. | **FIXED.** Regression: employee→**403** "Only HR users…"; unauthenticated→**401**; admin→**200**; employee cross-user `_user_id`→**403** "You must use your own user id…"; admin cross-user→**200**. Battery gate tightened to require 403 + added a 401 gate. |
| P7-09 | NOTE — `reports_of` "open" helper | `_reports_of` (`rpc.py:191-193`) returns only employee UUIDs of the direct+indirect reporting tree (`rbac.reports_of`), requires authentication, and returns no PII/records. This is the deliberate Phase 6 contract (battery: manager and employee both get 200). | **VERIFIED — NO CHANGE** (intentional open team-view helper; no concrete exposure). |
| P7-10 | NOTE — dev-only opt-ins | `backend\.env` (git-ignored) sets `DJANGO_DEBUG=true`, `DJANGO_ALLOWED_HOSTS=*`, and a dev `SERVICE_ROLE_KEY`/secret; root `.env` carries legacy Supabase vars. These are local dev opt-ins; the source itself fail-closes (settings defaults: DEBUG false, no host wildcard in prod, empty SRK ⇒ bypass unavailable). Working local HTTP dev relies on them. | **VERIFIED — DEV-ONLY, KEPT** (do not remove; not tracked). |

---

## G. Areas deliberately NOT tested (unchanged scope)

The following remain **NOT TESTED** — out of scope for this verification pass and not claimed:

1. Automated penetration-testing tooling (e.g. ZAP, nuclei, manual pentest).
2. TLS / reverse-proxy / HSTS runtime behaviour (local server is plain HTTP; `DJANGO_HTTPS=true` flags verified only as configuration, not exercised over a real TLS terminator).
3. Concurrency / load / performance testing.
4. Backup and restore procedures.
5. Full audit-log coverage verification (only spot insert/read behaviour exercised).
6. Dependency CVE / advisory scanning (no `npm audit`/`pip audit` run in this pass).

---

## H. Final verdict

**PASS WITH FINDINGS — READY TO DEPLOY (with the NOT TESTED items accepted as future follow-ups).**

- All six original findings (P7-01..P7-06) **re-verified fixed** (audit + source read-back + live battery gates).
- Fresh runtime battery: **49/49 PASS** (48 baseline + 1 new P7-08 gate).
- Frontend gates: `tsc` rc=0, `npm run build` rc=0.
- Supabase runtime: **none** (compat-shim only); secret scan over tracked files: **clean**.
- P7-07 and P7-09 **verified, no change required**; P7-10 **verified as dev-only and kept**; P7-08 **fixed** (RPC authorization denials now correctly 403/401 instead of 500) and regression-tested.
- Three report artifacts sit next to this file: the audit and remediation reports and this final verification.