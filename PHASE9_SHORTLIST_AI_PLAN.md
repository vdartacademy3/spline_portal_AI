# PHASE 9 — SHORTLIST AI IMPLEMENTATION PLAN

**Repository (only):** `D:\HR\pixel-perfect-clone`
**Status:** planning artifact only — no code, config, dependency, test, database, or migration
change. **Phase 8C remains BLOCKED**; no security gate is bypassed. No live tests,
no service start, no PostgreSQL connection, no real candidate/employee data accessed.

**Source documents (only):**
- `PHASE9_SHORTLIST_AI.md` (existing Phase 9 implementation record)
- `PHASE7-10-CHECKPOINT-20261012-113726.md` (checkpoint)

> Items not established by the two sources are marked **NOT VERIFIED** or
> **NEEDS DECISION**. No features, files, requirements, or results are invented.

---

## 0. Naming / scope discrepancy — RESOLVED (owner decision)

**Canonical mapping (approved):**
- **Phase 9 = Supabase cleanup workstream** (consistent with the checkpoint).
- **Shortlist AI = the Shortlist AI workstream** — not numbered Phase 9.
- **Phase 8C = security gate** — unchanged.

**Decision record:** approved by the **Project owner / program lead** on **2026-10-13**.
A named individual approver is **NOT DOCUMENTED**; only the documented owner role is
recorded. This decision resolves naming ambiguity **only** — it does not authorize
Supabase cleanup, any database change, security-gate execution, or any other open
Phase 9 decision.

**Documented facts (unchanged):**
- `PHASE9_SHORTLIST_AI.md` uses **"Phase 9 = Shortlist AI"**.
- The checkpoint uses **"Phase 9 = Supabase cleanup"**: line 149 *"SUPABASE CLEANUP:
  NOT STARTED. Gates not satisfied; compatibility code retained."*; line 437
  *"Phase 9 (Supabase cleanup) and Phase 10 remain NOT STARTED / blocked."*;
  line 475 *"Phases 9/10 stay blocked."*

**Consequence:** this document's own title still reads "PHASE 9 — SHORTLIST AI". The
historical file is **not renamed and not renumbered**, per the decision; this section
is the authoritative mapping. The document titles of `PHASE9_SHORTLIST_AI.md`,
`PHASE9_SHORTLIST_AI_PLAN.md` and `PHASE9_SHORTLIST_AI_DECISIONS.md` retain the legacy
"PHASE 9 — SHORTLIST AI" heading and should be read together with this section.

---

## 1. Existing implementation and current status

### What exists (VERIFIED from `PHASE9_SHORTLIST_AI.md`)
- **Producer:** `screenCandidates` (`src/lib/actions.functions.ts:244`) reads
  applications with the embed projection `applications?select=...,candidates(...)`.
- **Embed resolution fix:** `_embed_relation` in `backend/hr/api/rest.py:352`
  gained a target-table-name fallback so `candidates(...)` resolves; ambiguity
  falls back to `None`.
- **Produced records:** `candidate_screenings` rows (`action_type:"proposed"`)
  carrying `candidate_id`; an `ai_actions` row (`action_type:"recruitment.shortlist"`,
  `status:"pending"`) carrying `screening_ids`; audit `recruitment.shortlist_proposed`.
- **Approval:** hr_admin PATCH `status:"approved"` (policy `_is_admin_q`); audit row.
- **Execution:** `shortlistCandidates` + `recordExecution` via
  `executeAiAction("recruitment.shortlist")` promotes screenings to
  `action_type:"shortlisted"`, sets action `status:"executed"` + `executed_at`,
  audit `ai_action.executed`, `notify_hr` RPC `{ok:true}`.
- **Retrieval:** hr_admin reads shortlisted rows incl. scores `[92,70,40]`; hr_staff
  scoped read ok.
- **RBAC negatives:** employee/manager `has_permission` false, reads empty,
  employee approve PATCH is a 204 no-op.
- **Duplicate control:** one producer run ⇒ exactly 3 screenings / 1 action.
- **Failure handling:** hr_admin can set an action to `rejected`; rejected stays
  rejected.
- **Cleanup:** battery rows deleted; residue counts zero.

### Status
| Item | Status | Source |
|---|---|---|
| Producer → action → approve → execute wiring | **PASS (38/38 live checks) per `PHASE9_SHORTLIST_AI.md`** — **historical evidence only**; it does not satisfy the Phase 8C gate, which remains `BLOCKED` with the data-integrity incident `UNRESOLVED` | Phase 9 doc §Verification |
| Real AI scoring | **NOT VERIFIED** — `callGateway` (`src/lib/ai.functions.ts`) requires `LOVABLE_API_KEY`, not configured locally; deterministic scores used | Phase 9 doc §Remaining gaps 1 |
| `org_check` insert-arity defect | **MITIGATED (offline)** — `_adapt_insert` normalises 3-arg predicates and is applied in `Policy.__init__`; 25 offline regression tests pass. Live PostgreSQL, real RBAC/DB lookups, cross-org isolation and live HTTP error mapping: **NOT VERIFIED** | `PHASE9_SHORTLIST_AI.md` §Remaining gaps 2 (updated) |
| `perm_write`-as-INSERT defect | **MITIGATED (offline)** — `perm_write` takes a `(user, old, new, code=…)` predicate so the permission code, not the INSERT payload, reaches `perm()`; same 25 tests pass. Live verification: **NOT VERIFIED** | `PHASE9_SHORTLIST_AI.md` §Remaining gaps 3 (updated) |
| Re-verification under the cleared Phase 8C gate | **NEEDS DECISION / PENDING** — Phase 8C is BLOCKED, so further live testing must run only after its gate clears | checkpoint 149, 437, 475 + Phase 8C docs |

---

## 2. Intended inputs, outputs, ranking criteria, workflow integration

| Aspect | Established (source) | Unknown |
|---|---|---|
| **Inputs** | Applications rows with embedded candidate objects (`applications…candidates(...)`); job requisitions/candidates implied by the recruitment tables used in the battery | Exact input field set and any resume/CV text, skills, or requisition requirements fed to scoring — **NOT VERIFIED** |
| **Outputs** | `candidate_screenings` (`proposed` → `shortlisted`) with `candidate_id` and numeric scores; `ai_actions` (`recruitment.shortlist`) with lifecycle status; audit events; `notify_hr` | Whether per-candidate rationale/explanation, model id, or score version is persisted — **NOT VERIFIED** |
| **Ranking criteria** | Numeric scores exist (e.g. `[92,70,40]`) | The scoring prompt, weights, model, thresholds, tie-breaking, and shortlist size — **NOT VERIFIED** (requires the `LOVABLE_API_KEY` path; `callGateway` internals not read) |
| **Workflow integration** | Recruitment → Shortlist producer; hr_admin approval gate; executor via `executeAiAction`; recruitment pipeline and candidate-detail embeds share the same fix | Which roles may trigger produce/approve/execute beyond the tested hr_admin/hr_staff/employee/manager samples — **NEEDS DECISION**; UI flow details — **NOT VERIFIED** (no UI change planned) |

---

## 3. Privacy, authorization, isolation, explainability, human review

| Requirement | Status | Notes |
|---|---|---|
| **Candidate-data privacy** | **NEEDS DECISION** | Real scoring sends candidate data through `callGateway`/`LOVABLE_API_KEY` (third-party gateway). What fields leave the system, retention, consent, and data-minimization are **NOT VERIFIED**. Must be decided and documented before enabling live scoring. |
| **Authorization (produce/approve/execute)** | **PARTIAL (VERIFIED sample)** | Producer/approval = hr_admin; RBAC negatives verified for employee/manager; hr_staff scoped read ok. Exact permitted role set for each action — **NEEDS DECISION**. |
| **Organization isolation** | **NOT VERIFIED** | The `org_check` insert-arity defect is MITIGATED (offline), but non-service org isolation for candidate creation is still unproven live; no second-organization fixture exists (Phase 8C P10). Must be verified with a second-org fixture. |
| **Explainability / auditability** | **PARTIAL** | Audit events exist (`recruitment.shortlist_proposed`, `ai_action.executed`); per-score rationale storage is **NOT VERIFIED**. Whether a reviewer can see *why* a candidate ranked — **NEEDS DECISION**. |
| **Human review** | **VERIFIED (mechanism)** | Explicit hr_admin approval (`pending` → `approved`), `rejected` stays rejected, execution separate. Whether auto-execution is ever allowed, required reviewer count, and SLA — **NEEDS DECISION**. |
| **Data retention / deletion of shortlist artifacts** | **NEEDS DECISION** | Cleanup behavior for screenings/actions beyond the test battery is **NOT VERIFIED**. |

---

## 4. Minimum tests required after Phase 8C passes

All tests below are **gated by the Phase 8C security gate** (dedicated identity,
authorizations, fixtures, second-org fixture) and must reuse, not bypass, it.

1. **Producer embed + chain (regression):** replay the A–J battery with an approved
   identity and disposable fixtures — embed resolves; screenings/action/audit
   created; approve; execute; retrieve; counts 3/1; rejected stays rejected;
   residue zero.
2. **RBAC matrix:** produce/approve/execute per role (employee, manager, hr_staff,
   hr_admin, super_admin, service) against actual `role_permissions`.
3. **Organization/location isolation:** with the second-org/location fixture,
   confirm a non-global caller cannot produce/approve/execute across orgs.
4. **Real scoring (only if the gateway key + data-handling decision are approved):**
   one bounded run over disposable fixtures; verify scores are produced, bounded,
   and reproducible; confirm no real candidate data is used.
5. **Explainability:** confirm the required reaction (see §3) is persisted/visible,
   if the decision requires it.
6. **Idempotency/duplicate control:** repeated producer runs do not duplicate active
   screenings/actions.
6. **Failure handling:** gateway failure, invalid input, and rejected action paths
   leave no partial state and are recoverable.
7. **Audit completeness:** required audit events exist for propose/approve/execute/reject.
6. **Cleanup + integrity:** all disposable fixtures removed; residue counts zero;
   `auth_users` count unchanged (or authorized delta only).
7. **Pre-existing-defect decision tests:** if `org_check` / `perm_write` are fixed,
   add focused unit tests for non-service INSERT; otherwise record the service-role
   workaround as the accepted limitation.

> Offline/unit success and the existing Phase 9 doc's live PASS do **not** substitute
> for re-verification under the cleared Phase 8C gate.

---

## 5. Dependencies and unresolved decisions

**Dependencies**
- Phase 8C security gate cleared: recovery/closure, dedicated least-privilege
  identity, authenticated-test authorization, disposable fixtures, PG-connection
  authorization, and (for isolation) a second org/location fixture.
- Approval and configuration for `LOVABLE_API_KEY` if real scoring is in scope.
- Disposable recruitment fixtures (requisition, candidates, applications) + write
  and cleanup authorization.

**Unresolved decisions**
- **D1** — Phase 9 naming: Shortlist AI vs Supabase cleanup (§0). **RESOLVED** — Phase 9 = Supabase cleanup workstream; Shortlist AI = the Shortlist AI workstream.
- **D2** — Gateway: whether real scoring is required, which fields leave the system,
  retention/consent, and which key/secret store.
- **D3** — Permitted roles for produce / approve / execute; whether super_admin or
  service-only execution is allowed.
- **D4** — Explainability: what rationale/model/version must be stored and shown
  to reviewers.
- **D5** — Human-review policy: reviewer count, auto-execution allowed (yes/no),
  rejection handling, SLA.
- **D6** — `org_check` insert-arity and `perm_write`-as-INSERT: both are already
  MITIGATED (offline) in the uncommitted `backend/hr/policies.py`. Decide whether
  to commit that mitigation (requires separate code-change authorization) or retain
  the documented service-role workaround. Do not weaken organization policy either
  way.
- **D7** — Ranking criteria/thresholds/shortlist size (not defined in the sources).
- **D8** — Retention/deletion policy for screening and action artifacts.

---

## 5b. Smallest implementation sequence (no UI / architecture redesign)

Reuse the existing producer (`screenCandidates`), approval gate, and executor
(`shortlistCandidates` / `executeAiAction`). Do not redesign the UI or schema
beyond the smallest change each decision requires.

- **S0 — Clear the Phase 8C gate** (dedicated identity, authenticated-testing +
  session-write authorization, fixtures, write/cleanup authorization, second-org
  fixture). *No work proceeds while 8C is BLOCKED.*
- **S1 — Re-verify the existing chain** with disposable fixtures and an approved
  identity. No code change. (Minimum test 1 + 2.)
- **S2 — Resolve D6 defect decisions.** If fixing is approved, make the smallest
  targeted fix; otherwise document the service-role workaround as accepted.
- **S3 — Resolve D2 (gateway/privacy) and enable real scoring** behind the existing
  config path; verify with disposable fixtures only. (Minimum test 4.)
- **S4 — Add only the explainability/human-review metadata** required by D4/D5
  (smallest additive change; no UI redesign). (Minimum test 5.)
- **S5 — Isolation, RBAC, duplicate, failure, and audit tests.** (Minimum tests 2, 3,
  6-historical, plus audit.)
- **S6 — Cleanup and residue verification** under W4. (Minimum test 6/7.)

Each step is separable and can stop without leaving partial state. No step may
alter roles, weaken policies, or use real candidate/employee data.

---

## 6. Phase 8C / Phase 10 boundaries

- **Phase 8C stays BLOCKED.** No Phase 9 live test or code change may be used to
  work around its gate; re-verification waits for the gate.
- **Phase 10** is out of scope and not started.
- **Supabase cleanup** (checkpoint's "Phase 9") remains NOT STARTED and is not
  addressed here (see §0).
