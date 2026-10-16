# PHASE 8C — LIVE QA EXECUTION PLAN

**Repository:** `D:\HR\pixel-perfect-clone` · **Branch:** `main` · **HEAD:** `13cbe01`
**Artifact type:** plan only (no execution, no services, no PostgreSQL connection, no HTTP, no auth, no mutations).
**Companion:** `backend/hr/tests_auth_rbac.py` (offline logic coverage) and
`PHASE7-10-CHECKPOINT-20261012-113726.md` (incident/gate state).

> No credentials, fixtures, approvals, or results are asserted here. Every row
> marked **BLOCKED** stays blocked until its prerequisite is delivered through
> the approved channel. Nothing in this plan may be recorded as PASS without a
> real observed result.

---

## 1. BLOCKED PREREQUISITES (must clear before any live execution)

| ID | Prerequisite | Owner | Non-secret evidence to obtain | State |
|---|---|---|---|---|
| P1 | Recovery/rotation of the 8 affected accounts | Privileged admin / IAM | Rotation attestation + audit-log export (timestamp, pseudonymous ID, action, outcome, actor) | **BLOCKED** |
| P2 | Session/refresh-token review + revocation decisions | Security/platform | Session inventory summary (counts/expiry ranges, no token values) + per-account revoke/keep + justification | **BLOCKED** |
| P3 | Recovery validation + formal incident closure | Incident commander | Closure record (incident ID, timestamp, operator, rationale) | **BLOCKED** |
| P4 | Dedicated least-privilege test account provisioned | IAM | Provisioning record: role `employee`, scope `SELF`, distinct from the 8 accounts | **BLOCKED** |
| P5 | Secure credential delivery (outside chat/files/logs) | Security | Delivery receipt (channel ref, recipient, timestamp; no secret values) | **BLOCKED** |
| P6 | Test-data / cleanup plan approved | Tech lead / security | Approved plan ID + version + approver + date | **BLOCKED** |
| P7 | Authorization for authenticated tests incl. `last_login` / `django_session` writes | Tech lead / security | Signed authorization naming the test account + scope + side-effect acknowledgment | **BLOCKED** |
| P8 | **Execution-time authorization** to connect to PostgreSQL and start Django | Platform / tech lead | Signed, time-boxed authorization to connect and execute. *(Runtime availability is already documented and is **not** re-tested or re-claimed by this plan: PostgreSQL 17.11, db `spine_ai`, 127.0.0.1:5432, hr migrations applied = 9, base tables = 76, Django models = 72 — read-only run recorded in `PHASE7-10-CHECKPOINT-20261012-113726.md` l.522–529. Availability is not the blocker; authorization is.)* | **BLOCKED** — no current execution-time authorization |
| P9 | Disposable fixtures created (see §6) | QA (after P6+P7 + write authz W2) | Fixture manifest of pseudonymous IDs (no PII secrets) | **BLOCKED** |
| P10 | Second organization + second location for isolation tests | Platform | Provisioning record for a separate org/location | **BLOCKED** — no such fixture exists |
| W2 | Separate authorization for disposable DB writes | Tech lead | Written write authorization referencing approved plan | **BLOCKED** |
| W3 | Separate authorization for document upload/delete | Tech lead / storage owner | Written storage authorization | **BLOCKED** |
| W4 | Cleanup authorization (delete only disposable fixtures) | Tech lead | Written cleanup authorization | **BLOCKED** |

**Hard stops:** never use the 8 affected accounts; never change roles to force an
outcome; never weaken a policy; stop and report on any unexpected data change;
never auto-delete an unexpected record.

---

## 2. Auth lifecycle & invalid-token cases (Area 1)

Preconditions: P8; for rows needing login also P4+P5+P7 (identity) — side effect:
`last_login` (Django) and `django_session` create/update on login, session flush on logout.

| ID | Precondition | Action | Expected result | Evidence to record | Separate authz |
|---|---|---|---|---|---|
| AC-01 | P8 only | Unauth `GET /api/v1/public/employees/` (and `/auth/user/`) | 401, no rows | status, body-key shape only | none |
| AC-02 | P8 only | `Authorization: Bearer` (no token) / bad scheme | 401 or ignored→401 on protected route | status, sanitized header form | none |
| AC-03 | P8 only | Bearer with bad-signature token | 401 invalid token | status, reason string, no token | none |
| AC-04 | P8 only | Bearer with expired access token | 401 expired/invalid | status, reason string | none |
| AC-05 | P8 only | `POST /auth/token` missing email/password | 400 required-fields | status, code | none |
| AC-06 | P8 only | `POST /auth/token` wrong password (non-affected, disposable identity) | 401 invalid credentials | status only | none |
| AC-07 | P4+P5+P7 | Valid login | 200 + session shape `{access_token,refresh_token,token_type,expires_in,expires_at,user}` | status, key list, `expires_in`; **no token/cookie values** | P7 (session side effects) |
| AC-08 | P4+P5+P7 | `GET /api/v1/auth/user` with access token | 200, own user object | status, `id`==identity ref, key shape | P7 |
| AC-09 | P4+P5+P7 | `POST /auth/refresh` valid refresh | 200 new tokens | status, shape | P7 |
| AC-04b | P4+P5 (**not** P8-only) | Refresh with expired/invalid token | 401 | status, reason | none |
| AC-05b | P8 only | Login missing email or missing password | 400 | status | none |
| AC-06b | P4+P5 (**not** P8-only) | Login wrong password | 401 | status | none |
| AC-11 | P4+P5+P7 | `POST /auth/logout` | 200 | status | none |
| AC-12 | P4+P5+P7 | Protected `GET` after logout | 401 | status | none |
| AC-13 | P8 only | `POST /auth/claims` with bad/empty token | 401 | status | none |
| AC-14 | P4+P5 | `POST /auth/claims` with valid access token | 200 `{claims}` containing `sub`/`exp`/`role` (do not print token) | status, claim keys only | none |

**Negative-case prerequisite rule (AC-04b, AC-06b):** although AC-04b and AC-06b
are negative cases that submit no valid credential, this plan assigns them
**P4+P5**, not P8 alone. They must therefore **not** be scheduled, marked
executable, or reported as done under the P8-only bucket. This matches the
executability summary in §8c, where they appear only in the approved-identity
bucket. AC-03, AC-04, and AC-05b remain the genuinely P8-only negative cases.

---

## 3. RBAC — actual grants & employee/manager/payroll/admin (Area 2)

Precondition: P8 + an approved identity per role (P4/P5/P7). Grants are **read
from the live `role_permissions` table**, never assumed.

| ID | Precondition | Action | Expected result | Evidence to record | Separate authz |
|---|---|---|---|---|---|
| RB-00 | P8 | `SELECT role, permission_id, scope FROM role_permissions` (read-only) | Baseline grant map for the approved test identities | counts + mapping (no secrets) | read-only |
| RB-01 | employee identity | Read own `employees` row | 200, exactly self | status, row count = 1 | none |
| RB-02 | employee identity | Read another employee's row | 0 rows / not visible | status, row count = 0 | none |
| RB-03 | manager identity | Read direct report rows | allowed per grant+scope | status, pseudonymous row IDs/count | none |
| RB-04 | manager identity | Read indirect (recursive) report | allowed if `DIRECT_REPORTS`/wider applies | status, count | none |
| RB-05 | manager identity | Read non-report outside scope | denied / 0 rows | status, count | none |
| RB-06 | payroll identity | Read `employee_salaries` within scope | allowed iff `manage_payroll` present in the RB-00 baseline | status, count, grant found in RB-00 | none |
| RB-07 | employee/manager identity | Read `employee_salaries` | denied / 0 rows | status, count | none |
| RB-08 | service/super_admin identity | `GET /auth/admin/users` | 200 user list | status, total | none |
| RB-09 | employee/manager/HR_STAFF identity | `GET`+`POST /auth/admin/users` | 401 | status | none |
| RB-10 | any approved identity | Default-deny: `GET` an unconfigured table path | 404 | status | none |

**RB-06 conditional rule:** RB-06 is conditional on the `manage_payroll` grant
already existing in the live `role_permissions` table. If that grant is **absent**,
or if RB-00 has not been executed and its baseline has not been reviewed, RB-06 is
recorded **NOT VERIFIED** — never PASS and never a policy failure. **Never add,
modify, grant, or remove a role or permission to make RB-06 pass**; grants are read
from RB-00, never assumed (also see fixture F7, §6).

---

## 4. API behavior + denied-write semantics (Area 3)

Precondition: P8; reads need an approved identity; **all writes need W2**.

| ID | Precondition | Action | Expected result | Evidence to record | Separate authz |
|---|---|---|---|---|---|
| API-01 | identity | `GET` + column filters (`eq`, `in`, `is`) | 200 filtered rows | status, row count, filter used | none |
| API-02 | identity | `GET ?order=col.asc/desc` | 200 correctly ordered | status, first/last pseudonymous key | none |
| API-03 | identity | Pagination (`limit`/`offset`) + `Range` | 200 (206 where applicable) counted subset | status, count, range | none |
| API-04 | identity | Defect 3: `?limit=0` | controlled 400 (not 500/hang) | status | none |
| API-05 | identity | Defect 4: `?limit=foo` | controlled 400 | status | none |
| API-06 | identity | Defect 5: LIKE on UUID column (`id.like.*`) | controlled 400 | status | none |
| API-07 | identity | `Accept: application/vnd.pgrst.object+json` (single) | 200 object OR 406 when ≠1 row | status, shape | none |
| API-08 | identity | `maybeSingle` (`?limit=1`, object Accept) | 200 object or null when 0 | status, shape | none |
| API-09 | identity | RPC on a supported function | 200 per function contract | status, shape | none |
| API-10 | identity + W2 | INSERT disposable record | 201/200 created | status, new pseudonymous ID | **W2** |
| API-11 | identity + W2 | UPDATE disposable record (`PATCH`) | 200 updated, before/after differ | status, before/after booleans | **W2** |
| API-12 | identity + W2 | UPSERT disposable record | 200/201 | status | **W2** |
| API-13 | identity + W2 | DELETE disposable record | 204 | status | **W2** |
| API-14 | identity (no W2) | UPDATE a row the policy excludes | 403, **no change** | status, before/after unchanged | none |
| API-15 | identity (no W2) | DELETE a row the policy excludes | 403, **no change** | status, before/after unchanged | none |
| API-16 | identity (no W2) | Empty allowed target set | 204 quiet success (distinct from 403) | status | none |
| API-17 | service identity | Excluded-target write as service_role | quiet 204 (not treated as denial) | status | none |

---

## 5. Storage metadata / signed URLs / private docs (Area 4)

Precondition: P8 + approved disposable test file + an approved identity; upload/delete need **W3**.

| ID | Precondition | Action | Expected result | Evidence to record | Separate authz |
|---|---|---|---|---|---|
| ST-01 | identity + test file | Read object metadata for own doc | 200 metadata | status, metadata keys | none |
| ST-02 | identity + test file | Mint signed URL for own private doc | 200 URL issued (do **not** print URL/token) | status, TTL field | none |
| ST-03 | identity + test file | Download own private doc via signed URL | 200 bytes | status, byte count | none |
| ST-04 | other identity | Access another user's private doc | denied / 404 | status | none |
| ST-05 | identity + W3 | Upload disposable test doc | 201 | status, pseudonymous path | **W3** |
| ST-06 | identity + W3 | Delete disposable test doc | 204 | status | **W3** |
| ST-07 | P8 | Cross-tenant/private bucket access attempt | denied per policy | status | none |

Storage/tenant isolation that cannot be attempted safely → report **NOT TESTED** / **NOT VERIFIED**.

---

## 6. Persistence, isolation & fixtures (Area 5)

Precondition: P8; `employee_salaries`, manager-scope, second-org test downloads.

**Minimum disposable fixtures** (created only under W2; never real business rows):

| Fixture | Purpose | Notes |
|---|---|---|
| F1 test identity (role `employee`, scope `SELF`) | self-ownership | from P4; distinct from 8 accounts |
| F2 employee row linked to F1 | self row | same org/location |
| F3 manager identity + F4 own employee row | manager scope | needs an authorized manager-scope identity |
| F5 direct report + F6 indirect (grandchild) | recursive reports | via `manager_id` chain |
| F7 payroll identity + F8 `employee_salaries` row | payroll gate | grant must already exist; never add role |
| F9 test document + metadata | storage | approved test file only |
| F10 second organization | org isolation | **BLOCKED (P10)** — does not exist |
| F11 second location | location isolation | **BLOCKED (P10)** |

| ID | Precondition | Action | Expected result | Evidence to record | Separate authz |
|---|---|---|---|---|---|
| PG-01 | P8 | `SELECT count(*)` on key tables before run | baseline counts | counts only | read-only |
| PG-02 | identity + W2 | After API-10/11/12/13, re-`SELECT` the fixture row | state matches the write | before/after row state | **W2** |
| PG-03 | P8 | Re-`SELECT auth_users` count after run | unchanged unless authorized | count delta = 0 (or authorized delta) | none |
| ISO-01 | F10 (P10) | Cross-organization read attempt | denied / scoped | status, row count | none |
| ISO-02 | F11 (P10) | Cross-location read attempt | denied / scoped | status, row count | none |

**Cross-organization and location isolation: NOT VERIFIED** — no authorized
second-org/location fixture exists (single-organization DB).

---

## 7. Sanitized evidence rules

- Record only: HTTP status codes, row counts, boolean before/after, presence/shape
  of fields, pseudonymous fixture IDs, migration counts, command exit codes.
- Never record or print: passwords, password hashes, access/refresh tokens,
  cookies, `Authorization` headers, signed URLs, service keys, secrets.
- One line per test: `ID | status | expected | observed | evidence-ref | authz`.
- Distinguish **live** results from offline unit results (`backend/hr/tests_auth_rbac.py`).

## 8. Cleanup plan (requires W4)

1. Delete only fixtures **F1–F9** that were actually created, in reverse creation
   order. **F10 and F11 are explicitly excluded**: they are BLOCKED (P10), have not
   been created, and this plan neither authorizes their creation nor their deletion.
   If any F10/F11 organization or location is ever found to exist, **STOP and
   report** — do not delete it under W4.
- Never delete unexpected records; if any appear, **stop and report**.
- Confirm `auth_users` count returns to the PG-01 baseline.
- Record a cleanup manifest of pseudonymous IDs; no secret values.

## 8b. Execution-side-effect authorization matrix

| Side effect | Required authorization |
|---|---|
| Login/logout (`last_login`, `django_session` writes) | P7 |
| Read-only authenticated requests | identity (P4/P5) + P7 |
| Disposable DB row create/update/upsert/delete | **W2** |
| Document upload/delete | **W3** |
| Cleanup deletes | **W4** |
| Any connection to PostgreSQL | P8 |

---

## 8c. Executable vs BLOCKED summary

- **Executable once P8 is authorized (no identity, no writes):** AC-01, AC-02 (unauth side), AC-13, RB-10, and the negative-token legs of AC-03/AC-04/AC-05b. **AC-04b and AC-06b are NOT in this bucket** — they require P4+P5 per §2, even though they are negative cases.
- **Executable with an approved identity (no writes):** AC-04b, AC-06b–AC-14 (auth flow), RB-01–RB-09, API-01–API-09, API-14–API-17, ST-01–ST-04, ST-07, PG-01, PG-03.
- **Requires separate write/document authorization:** API-10–API-13 (W2), ST-05–ST-06 (W3), PG-02 (W2).
- **BLOCKED (missing prerequisite/fixture):** all of §2–§7 until P1–P10 are documented; ISO-01/ISO-02 additionally need P10.

**No result in this plan is claimed as passed. All live rows remain BLOCKED or
NOT VERIFIED until the corresponding evidence is observed under authorization.**

**Standing status — unchanged by this documentation-only revision (D1–D6):**
`DATA INTEGRITY` incident **UNRESOLVED** · Phase 8C live verification **BLOCKED** ·
Phase 9 (Shortlist AI) **BLOCKED**. No prerequisite in §1 is cleared, no approval
or evidence is created or implied by these edits, and no gate state changes.
Runtime connectivity, migration state, and every live row above are **NOT VERIFIED**
by this plan.
