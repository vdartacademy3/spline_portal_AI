# PHASE 9 — SHORTLIST AI: UNRESOLVED DECISIONS

**Repository (only):** `D:\HR\pixel-perfect-clone`
**Prepared:** 2026-10-13
**Status:** decision register — planning only. No application code, configuration, tests,
database, migrations, dependencies, or Git state changed. No services started, no
PostgreSQL connection, no live tests. **Phase 8C remains BLOCKED and is not bypassed.**

**Sources (only):**
- `PHASE9_SHORTLIST_AI_PLAN.md`
- `PHASE9_SHORTLIST_AI.md`
- `PHASE7-10-CHECKPOINT-20261012-113726.md`

**Status legend**

| Label | Meaning |
|---|---|
| **VERIFIED** | Explicitly documented in one of the three named sources. |
| **NOT VERIFIED** | Not supported by the named sources (no evidence available). |
| **NEEDS OWNER DECISION** | Awaiting an owner's approval/decision. |
| **BLOCKED** | Cannot proceed until the Phase 8C security gate passes. |
| **UNRESOLVED** | Acknowledged open item, intentionally out of scope here. |

> No credentials, hashes, tokens, cookies, or secret values are recorded in this
> document. Documented facts are separated from recommendations; every recommendation
> is explicitly labelled.

---

## Summary

| # | Decision / item | Status | Responsible owner | Required next action |
|---|---|---|---|---|
| 1 | "Phase 9" = Shortlist AI vs Supabase cleanup | **RESOLVED** — Phase 9 = Supabase cleanup workstream; Shortlist AI = Shortlist AI workstream | Project owner / program lead | Mapping recorded in §1 (approved 2026-10-13); no renumbering performed |
| 2 | Real AI scoring vs deterministic fallback | Real: NOT VERIFIED · Fallback wiring: VERIFIED | Platform/ops + technical lead | Decide scope; provision key via approved store; verify with evidence |
| 3 | Ranking policy (criteria/weights/thresholds/size) | NEEDS OWNER DECISION | HR / product owner | Define and approve the policy |
| 4 | Explainability, audit, retention, human approval | Approval: VERIFIED · Explainability: NOT VERIFIED · Retention/policy: NEEDS OWNER DECISION | HR/recruitment lead + security/compliance | Approve rationale, retention, and reviewer policy |
| 5 | Privacy, RBAC, org isolation, post-8C tests | RBAC negatives: VERIFIED · Isolation: NOT VERIFIED · Privacy: NEEDS OWNER DECISION · Tests: BLOCKED | Security + platform + QA | Approve data handling; provision 2nd-org fixture; run tests after 8C |
| 6 | `org_check` and `perm_write` defects | UNRESOLVED (out of scope) | Technical lead / backend | Keep open; decide fix separately |
| 7 | Phase 8C security gate | BLOCKED | Security / incident commander | Clear the 8C gate before live Phase 9 |

---

## 1. Phase-number conflict — Shortlist AI vs Supabase cleanup — RESOLVED

**Status:** **RESOLVED** — owner decision recorded below
**Responsible owner:** Project owner / program lead
**Approved:** 2026-10-13 by the Project owner / program lead. A named individual
approver is **NOT DOCUMENTED**; only the documented owner role is recorded.

**Documented facts (evidence):**
- `PHASE9_SHORTLIST_AI.md` is titled "Phase 9 — Shortlist AI…" and treats Phase 9 as the Shortlist AI workstream.
- `PHASE7-10-CHECKPOINT-20261012-113726.md` uses "Phase 9" for Supabase cleanup: L149 "SUPABASE CLEANUP: NOT STARTED. Gates not satisfied; compatibility code retained."; L71 and L249 "SUPABASE CLEANUP: NOT STARTED."; L437 "Phase 9 (Supabase cleanup) and Phase 10 remain NOT STARTED / blocked."

**Assessment:** The two sources apply the same label "Phase 9" to two different workstreams. Both usages are documented; the canonical mapping was ambiguous and is now fixed by the owner decision below.

**Owner decision (RESOLVED):** **Phase 9 = the Supabase cleanup workstream** (consistent with the checkpoint). **The Shortlist AI workstream is not numbered Phase 9.** **Phase 8C = the security gate**, unchanged. No phase was renumbered, no historical file renamed, and no historical result altered. The checkpoint is preserved as historical evidence.

**Scope limit:** this decision resolves naming ambiguity **only**. It does **not** authorize Supabase cleanup, any database change, security-gate execution, or any other open Phase 9 decision (items 2–7 remain with their owners).

**Consequence for this document:** its title still reads "PHASE 9 — SHORTLIST AI". The file is deliberately **not renamed**, per the decision; this section is the authoritative mapping. Read the title together with this section.

**Recommendation (not a documented fact):** Maintain a single canonical phase→workstream mapping and reference "Supabase cleanup" by name to avoid collisions.

---

## 2. AI scoring — deterministic fallback vs real AI
**Status:** Real AI scoring **NOT VERIFIED**; deterministic wiring path **VERIFIED**.
**Responsible owner:** Platform/ops (key + secret store) and technical lead (verification).

**Documented facts:**
- `PHASE9_SHORTLIST_AI.md` §Remaining gaps 1: `callGateway` (`src/lib/ai.functions.ts`) requires `LOVABLE_API_KEY`; it is **not configured locally**, so real scoring cannot run. The wiring was verified "through deterministic scores driven through the exact producer INSERT contract."
- The observed scores `[92,70,40]` are the deterministic values (`PHASE9_SHORTLIST_AI.md` §Verification F).
- Model, prompt, weights, thresholds, and shortlist size are **not documented** (`PHASE9_SHORTLIST_AI_PLAN.md` §2).
- Whether per-candidate rationale / model id / score version is persisted is **NOT VERIFIED** (`PHASE9_SHORTLIST_AI_PLAN.md` §2–§3).

**Assessment:** The producer → action → approve → execute chain is proven with deterministic scores. The gateway-backed scoring path has never been exercised in the recorded evidence.

**Required next action:** The owner decides whether real scoring is in scope. If yes, provision the key through the approved channel and execute the verification evidence below — **only after** the Phase 8C gate (item 7).

**Evidence needed to verify the real integration — Recommendation (none of this exists yet):**
1. `LOVABLE_API_KEY` provisioned via the approved secret store (never recorded in documentation).
2. One approved, authenticated producer run against disposable fixtures returning gateway-backed scores distinguishable from the deterministic constants `[92,70,40]`.
3. Persisted score provenance: model identifier, prompt/policy version, and timestamp.
4. A defined determinism/reproducibility expectation for identical input.
5. Gateway-failure behaviour verified: no partial `candidate_screenings` / `ai_actions` writes.
6. Confirmation that no real candidate PII is transmitted without approval.

---

## 3. Ranking policy — criteria, weights, thresholds, shortlist size
**Status:** NEEDS OWNER DECISION
**Responsible owner:** HR / product owner (with security/compliance review).

**Documented facts:**
- Numeric scores exist (`[92,70,40]`; `PHASE9_SHORTLIST_AI.md` §Verification F).
- The scoring criteria, weights, model, thresholds, tie-breaking, and shortlist size are **NOT VERIFIED** by any source (`PHASE9_SHORTLIST_AI_PLAN.md` §2 and decision D7).

**Assessment:** No hiring policy is documented in the sources. It must not be invented.

**Required next action:** HR/product define and approve: ranking criteria; weights; pass/shortlist thresholds; shortlist size; tie-breaking rules; and any fairness/adverse-impact review required.

**Recommendation (not a documented fact):** Record the approved policy in a controlled artifact and keep AI output as decision-support that requires human approval (item 4).

---

## 4. Explainability, audit records, retention, and human approval
**Status:** Human-approval mechanism **VERIFIED**; explainability storage **NOT VERIFIED**; retention/policy **NEEDS OWNER DECISION**.
**Responsible owner:** HR/recruitment lead (approval policy) + security/compliance (explainability, retention) + engineering (implementation).

**Documented facts:**
- Approval is an explicit hr_admin step: `pending` → `approved` (policy `_is_admin_q`); `rejected` stays rejected; execution is separate (`shortlistCandidates` via `executeAiAction("recruitment.shortlist")`) (`PHASE9_SHORTLIST_AI.md` §Verification).
- Audit events are emitted (`recruitment.shortlist_proposed`, `ai_action.executed`); `notify_hr` RPC returns `{ok:true}` (`PHASE9_SHORTLIST_AI.md` §Verification E).
- Per-candidate rationale / model / version storage is **NOT VERIFIED**; whether a reviewer can see *why* a candidate ranked is unknown (`PHASE9_SHORTLIST_AI_PLAN.md` §2–§3).
- Retention/deletion of screenings and actions beyond the test battery is **NOT VERIFIED** (`PHASE9_SHORTLIST_AI_PLAN.md` §3).

**Assessment:** The human-approval mechanism is documented and enforced. Explainability content and data-retention policy are undecided.

**Required next action:** The owner approves: (a) what rationale/model version must be stored and shown to reviewers; (b) reviewer role(s), reviewer count, auto-execution allowed (yes/no), and any SLA; (c) retention/deletion policy for screenings, actions, and audit records.

**Recommendation (not a documented fact):** Store rationale/model-version metadata per screening and keep execution strictly human-approved (no auto-execution).

---

## 5. Privacy, RBAC, organization isolation, and required post-Phase-8C tests
**Status:** RBAC negatives **VERIFIED**; organization isolation **NOT VERIFIED**; privacy handling **NEEDS OWNER DECISION**; required tests **BLOCKED** until Phase 8C passes.
**Responsible owner:** Security (privacy/isolation) + platform (second-org fixture) + QA / technical lead (tests).

**Documented facts:**
- RBAC negatives verified live: employee/manager `has_permission` false, reads empty, employee approve PATCH is a 204 no-op; hr_staff scoped read ok; hr_admin performs producer/approval (`PHASE9_SHORTLIST_AI.md` §Verification F–G).
- The exact permitted role set per action beyond those samples is **NEEDS OWNER DECISION** (`PHASE9_SHORTLIST_AI_PLAN.md` §2–§3).
- Organization isolation is **NOT VERIFIED**: no second organization/location fixture exists (`PHASE9_SHORTLIST_AI_PLAN.md` §3). The `org_check` insert-arity defect previously cited here as the blocker is **MITIGATED (offline)** — see item 6; live cross-organization isolation, real RBAC/database lookups, and live HTTP error mapping all remain **NOT VERIFIED**.
- Privacy: real scoring would route candidate data through `callGateway`/`LOVABLE_API_KEY` (third-party gateway); which fields leave the system, consent, and retention are **NOT VERIFIED** (`PHASE9_SHORTLIST_AI_PLAN.md` §3).

**Required post-Phase-8C tests — Recommendation (drawn from `PHASE9_SHORTLIST_AI_PLAN.md` §4):**
1. Producer embed + full chain regression on disposable fixtures.
2. RBAC matrix for produce/approve/execute per role.
3. Organization/location isolation using a second-org fixture.
4. Real-scoring verification (only if approved) using disposable fixtures.
5. Explainability / human-review metadata check.
6. Duplicate control; rejection and gateway-failure handling; audit completeness.
7. Cleanup and residue-zero verification.

**Required next action:** Security approves candidate-data handling; platform provisions the second-org/location fixture; QA/technical lead runs the tests above **only after** the Phase 8C gate (item 7).

---

## 6. Reported `org_check` insert-arity and `perm_write`-as-INSERT defects
**Status:** UNRESOLVED — acknowledged and intentionally out of scope here.
**Responsible owner:** Technical lead / backend owner (fix decision).

**Documented facts:**
- Historically, `PHASE9_SHORTLIST_AI.md` §Remaining gaps 2 recorded that `check_org.ok()` has arity `(user, old, new)` while `Policy.insert_ok` calls it with `(user, data)`, and §Remaining gaps 3 recorded that `perm_write` was not implemented as INSERT.
- **Both of those entries have since been updated in `PHASE9_SHORTLIST_AI.md` to MITIGATED (offline)**, following static inspection of `backend/hr/policies.py` (`_adapt_insert`/`_adapt_check` applied in `Policy.__init__`; `perm_write` takes a `(user, old, new, code=…)` predicate) and 25 passing offline regression tests in `backend/hr/tests_insert_policy_arity.py`.
- Limitations retained: live PostgreSQL verification **NOT VERIFIED**; real RBAC/database lookups **NOT VERIFIED**; cross-organization isolation against a second organization **NOT VERIFIED**; live HTTP error mapping **NOT VERIFIED**. The service-role workaround status is unchanged and its current necessity is not re-established.

**Assessment:** Both defects pre-date the Phase 9 embed fix; `PHASE9_SHORTLIST_AI.md` §Files changed shows no `policies.py` change.

**Required next action:** Keep both unresolved and out of scope for this task. Decide separately (`PHASE9_SHORTLIST_AI_PLAN.md` D6) whether to fix via a separately authorized change or to retain the documented service-role workaround.

**Recommendation (not a documented fact):** Track both as separate defect tickets and add regression tests when a fix is authorized. Do not resolve them by weakening organization policy.

---

## 7. Security gate — Phase 8C must pass before live Phase 9
**Status:** BLOCKED
**Responsible owner:** Security / incident commander / technical lead.

**Documented facts:**
- `PHASE7-10-CHECKPOINT-20261012-113726.md` L149: "SUPABASE CLEANUP: NOT STARTED. Gates not satisfied; compatibility code retained."; L437: "Phase 9 (Supabase cleanup) and Phase 10 remain NOT STARTED / blocked."; L450: "NO recovery attempts, NO Phase 9/10 work."
- `PHASE9_SHORTLIST_AI.md` records a live 38/38 PASS for the wiring (using the service-role workaround), while `PHASE9_SHORTLIST_AI_PLAN.md` §5–§6 records that re-verification is gated by Phase 8C, which is BLOCKED.

**Assessment:** The sources differ in emphasis — a recorded live PASS versus a blocked security gate. Under the standing gate, no further live Phase 9 implementation or testing may proceed until Phase 8C passes and its requirements are cleared.

**Required next action:** Clear the Phase 8C security gate before any live Phase 9 implementation or testing. **Do not bypass.**

**Recommendation (not a documented fact):** Re-run the Phase 9 chain under the cleared gate with an approved identity and disposable fixtures; retain the existing 38/38 result as historical evidence only.

---

## Ownership summary

| Decision | Owner |
|---|---|
| Phase-number mapping (item 1) — **RESOLVED** | Project owner / program lead |
| Real AI scoring scope + evidence (item 2) | Platform/ops + technical lead |
| Ranking policy (item 3) | HR / product owner |
| Explainability, retention, human-review policy (item 4) | HR/recruitment lead + security/compliance |
| Privacy, RBAC scope, org isolation, test authorization (item 5) | Security + platform + QA |
| Defect fix decision (item 6) | Technical lead / backend owner |
| Phase 8C gate clearance (item 7) | Security / incident commander |

---

## Boundaries
- This is a decision register only. It makes no code, configuration, test, database,
  migration, dependency, or Git change.
- Phase 8C remains BLOCKED; nothing here bypasses its gate.
- Phase 9 implementation has not been started.
- Unknown items remain marked **NOT VERIFIED**; pending approvals remain
  **NEEDS OWNER DECISION**.
