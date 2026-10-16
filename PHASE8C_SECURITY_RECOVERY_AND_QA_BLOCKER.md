# PHASE 8C — SECURITY RECOVERY AND QA BLOCKER: ACTION REQUIRED

**Repository:** `D:\HR\pixel-perfect-clone` · **Branch:** `main` · **HEAD:** `13cbe01`
**Status:** Phase 8C live verification — **BLOCKED**
**Audience:** IAM / security operator, incident commander, technical lead
**Sources (only):** `PHASE8C_LIVE_QA_PLAN.md`, `PHASE7-10-CHECKPOINT-20261012-113726.md`

> **Secret-handling notice.** No credentials, password hashes, tokens, cookies,
> session IDs, or keys appear in this document and none may be transmitted in
> response to it. All secret material must be delivered **only** through the
> approved secure channel — never in chat, email bodies, files, or logs.

---

## 1. Why Phase 8C live verification is blocked

The live authentication / RBAC / tenant pass cannot start because of an
unresolved chain of security prerequisites — **not** a code defect:

- **Unresolved recovery incident.** Eight accounts' password hashes were
  overwritten during a prior Phase 8B run outside the granted authorization
  (checkpoint lines 337–364; `DATA INTEGRITY remains INCIDENT UNRESOLVED`,
  lines 452–454).
- **No dedicated test identity.** No least-privilege test account or credentials
  have been delivered; the eight affected accounts must not be reused
  (checkpoint 473–475, 481, 493–495, 517–519).
- **No authenticated-testing authorization.** Authorization for authenticated
  requests and their session side effects (`last_login`, `django_session`), for
  the test-data plan, and for any writes is not in place (checkpoint 321–327,
  445–451, 474–475).
- **No fixtures.** No disposable self/manager/payroll/document fixtures exist
  (checkpoint 390–394, 414–417), and no second organization/location fixture
  exists (checkpoint 387–389).
- **PostgreSQL/runtime is not the blocker.** Availability is already evidenced:
  PostgreSQL 17.11 at 127.0.0.1:5432, db `spine_ai`, hr migrations 0001–0009
  applied, Django served and stopped (checkpoint 477–480, 502–516). The missing
  item is **authorization to connect/execute at test time**, not availability.
- **No safe-mode cause.** No recorded permission-denied error exists in the
  source documents; the only tool limitation on record is an ESLint timeout
  (checkpoint 265), which is unrelated. Safe mode is **not** inferred as the
  cause. No reproducible application defect is recorded either.

---

## 2. Required IAM / security actions — recover the eight accounts and close the incident

Affected account **identifiers** (identifiers only — no credential material):

- `admin@spineai.local`
- `vikram@northwind.io`
- `ananya@northwind.io`
- `grace@northwind.io`
- `daniel@northwind.io`
- `neha@northwind.io`
- `admin@northwind.io`
- `priya@northwind.io`

Required actions:

1. **Rotate** each account's password through the approved provisioning/recovery
   path. Do not reuse the accounts; do not restore unknown prior hashes; do not
   bulk-script the rotation.
2. **Review sessions / refresh tokens** for the eight accounts; record an
   explicit revoke/keep decision per account and revoke compromised or
   inappropriate sessions through an authorized process.
3. **Validate recovery** without disclosing any credential.
4. **Formally close the incident** with an incident ID, closure timestamp,
   responsible operator, and rationale.

**Non-secret evidence required:** rotation attestation + audit-log export;
session inventory summary + per-account decisions + justification; recovery
validation checklist; closure record.

---

## 3. Dedicated least-privilege test account (no credentials here)

**Request:** provision **one** dedicated account with role `employee` and scope
`SELF`, **distinct** from the eight affected accounts.

- Provision through the approved administrative path; record a provisioning
  record (role, scope, creator, timestamp).
- Deliver the credentials **only** through the approved secure channel; record a
  delivery receipt (channel reference, recipient, timestamp) with **no secret
  values**.
- Do not place credentials in chat, files, logs, tickets, or this repository.

---

## 4. Required approvals before live execution

- **Live QA plan + test-data/cleanup plan approval** (plan P6).
- **Authenticated-testing authorization** naming the test account and explicitly
  acknowledging the `last_login` (Django user) and `django_session` writes that
  login/logout cause (plan P7).
- **PostgreSQL connection + runtime execution authorization** at test time
  (plan P8).
- **Separate authorization for side effects**, required only if mutation or
  storage tests are pursued:
  - disposable database writes (W2),
  - document/object upload and delete (W3),
  - cleanup deletes of disposable fixtures only (W4).

---

## 5. Second organization / location fixture — tenant isolation

The database currently contains a **single organization**, so no
cross-organization or negative-isolation test can be performed. A separate
organization and location fixture (with an identity placed in them) must be
provisioned and authorized before any isolation claim.

Until then, **cross-organization and location isolation remain NOT VERIFIED**
and must not be recorded as PASS.

---

## 6. Evidence required before live testing can begin

| ID | Evidence | Owner |
|---|---|---|
| P1 | Rotation attestation + audit-log export (timestamp, pseudonymous ID, action, outcome, actor) | Privileged admin / IAM |
| P2 | Session/refresh revocation decisions with justification (no token values) | Security / platform |
| P3 | Recovery validation + formal incident-closure record | Incident commander |
| P4 | Provisioning record: role `employee`, scope `SELF`, distinct from the eight | IAM |
| P5 | Secure channel delivery receipt (no secret values) | Security |
| P6 | Approved live-QA + test-data/cleanup plan (ID, version, approver, date) | Tech lead / security |
| P7 | Signed authenticated-testing authorization incl. `last_login`/`django_session` acknowledgment | Tech lead / security |
| P8 | Authorization to connect to PostgreSQL and start Django at execution time | Platform / tech lead |
| P9 | Disposable fixture manifest (pseudonymous IDs; no PII secrets) | QA (under W2) |
| P10 | Second organization + location provisioning record | Platform |
| W2 / W3 / W4 | Written authorizations for DB writes / document operations / cleanup (only if required) | Tech lead / security |

---

## 7. Stop conditions

Stop immediately and report — do **not** clean up, retry, or work around — if any
of the following occurs:

- **Unexpected data change:** any row changes or is created/deleted outside the
  approved, disposable fixtures; any `auth_users` count change not authorized.
- **Authorization failure:** a test returns an authorization result that would
  require changing a role, weakening a policy, or reusing an affected account to
  proceed.
- **Scope breach:** any mutation occurs without separate, explicit write
  authorization, or beyond the authorized scope.
- **Secret exposure risk:** any step would require recording, printing, or
  transmitting credentials, hashes, tokens, cookies, or session IDs.
- **Affected accounts:** any need to touch the eight affected accounts.
- **Runtime integrity:** PostgreSQL/Django unavailability, corruption signals, or
  errors suggesting the environment is not in the expected state.

Standing rules: never auto-delete unexpected records; never change roles to force
an expected outcome; never weaken policy enforcement; preserve all existing Git
changes.

---

## 8. Offline unit-test success does not prove live behavior

Passing offline/unit tests (`backend/hr/tests_auth_rbac.py`, write-denial,
filter-coercion, fixture-guard tests) and static code review exercise
authorization **logic only**. They do **not** prove:

- live PostgreSQL row-level enforcement or RLS equivalence,
- authentication, JWT validity, session/refresh handling, or logout invalidation,
- RBAC against the **actual** `role_permissions` grants,
- persistence after writes,
- or tenant/organization/location isolation.

A PASS may only be recorded from a real, authorized live observation.

---

## 9. Phase 9 — Shortlist AI

**Phase 9 — Shortlist AI remains pending** and must not begin until the security
gate in this document is cleared and the recovery incident is formally closed.

---

## 10. Reference and response

See `PHASE8C_LIVE_QA_PLAN.md` for the full test matrix, side-effect
authorization matrix, and cleanup plan. Respond with the **non-secret** evidence
and approvals listed in §6. **Do not send credentials.**

*No further live testing will be attempted until the required approvals are
confirmed.*
