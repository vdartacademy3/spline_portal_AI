# Phase 9 — Shortlist AI: missing producer/action wiring fixed

## Bug / Gap (from `FUNCTIONAL_GAP_AUDIT.md`)
**Shortlist AI — MISSING.** The "Run AI shortlist" action (Recruitment → Shortlist) never produced a proposal: no `candidate_screenings` rows, no `ai_actions` action, no shortlist applied to the hiring pipeline.

## Root cause
The Shortlist AI **producer code path was fully present but dead** on the live backend:

1. The frontend producer `screenCandidates` (`src/lib/actions.functions.ts:244`) reads applications with the embed projection
   `applications?select=...,candidates(...)`. PostgREST resolves an embed against the **relation by field name** on the source table; here the FK field is named `candidate` and only the **target table** is named `candidates`.
2. The compatibility layer `_embed_relation` in `backend/hr/api/rest.py:352` supported forward fields (name = field name) and reverse accessors (name = accessor name) — **not** a target-table name. The embed returned `None`, the `candidates` object was omitted from the response, and the producer saw `candidate = {}` per application.
3. `screenCandidates` therefore wrote `candidate_screenings` rows with `candidate_id: undefined` → the NOT NULL insert failed (500) → *"Shortlist AI is never produced"*.
4. The identical dead-embed pattern breaks three more pages: recruitment pipeline (`recruitment.tsx:135`, `candidates(...)`), `recruitment.functions.ts:62`, and candidate detail (`$candidateId.tsx:78`, `job_requisitions(...)`).

The approval/execution side (`ai_actions` insert · hr_admin approve · `shortlistCandidates` executor via `executeAiAction("recruitment.shortlist")`) was already correct and verified live this phase.

## Root cause evidence
- Pre-fix live probe (service-role fixture + hr_admin read with the exact producer select): embed `candidates(...)` on `applications` resolved to **absent** per row; screening INSERT (with candidate data from the read) failed.
- The FG audit classified this "MISSING" for the right runtime symptom, but the actual technical cause is the embed resolution (verified above) — not a missing producer function, scoring hook, or executor registration (all present).

## Files changed
| File | Change |
|---|---|
| `backend/hr/api/rest.py` | `_embed_relation` (`:`352): after the forward-field and reverse-accessor checks, resolve an embed that names a FK **target table** (`f.related_model._meta.db_table == name`) when exactly one FK qualifies (`:`365-374). Falls back to `None` on ambiguity — no behavior change for existing embeds. |

No frontend change, no migration, no schema change, no `rbac.py`/`policies.py` change.

## DB changes
None. Code-only fix; `makemigrations --check --dry-run` reports **No changes detected**.

## Verification (live, PostgreSQL 17 + Django dev server)

### Full chain battery — 38/38 PASS
Drives the exact REST contract the fixed frontend emits (service-role writes are the documented workaround for the pre-existing `org_check` insert-arity defect):

- **A fixtures** — requisition + 3 candidates/applications (tagged, service role).
- **B producer reads (hr_admin)** — requisition single-read 200; `applications…candidates(...)` embed **now resolves** (all 3 rows carry full candidate objects); `has_permission(view_recruitment)=true`.
- **C producer writes** — 3 `candidate_screenings` (`action_type:"proposed"`) 201 with `candidate_id` from the embed; `ai_actions` row (`action_type:"recruitment.shortlist"`, `status:"pending"`) 201 carrying `screening_ids`; audit `recruitment.shortlist_proposed` 201.
- **D approval (hr_admin)** — action visible; PATCH `status:"approved"` 200 (policy `_is_admin_q`); audit 201.
- **E execute (service role, mirrors `shortlistCandidates`+`recordExecution`)** — screenings promoted to `action_type:"shortlisted"` 200; action `status:"executed"` + `executed_at` 200; audit `ai_action.executed` 201; `notify_hr` RPC `{ok:true}`.
- **F retrieval** — hr_admin reads 3 shortlisted rows incl. scores `[92,70,40]`; hr_staff scoped read ok; executed action retrievable.
- **G RBAC negatives** — employee/manager: `has_permission` false, reads empty, employee approve PATCH is a 204 no-op.
- **H duplicate control** — one producer run ⇒ exactly 3 screenings / 1 action (counts 3/1).
- **I failure handling** — hr_admin can place an action in `rejected`; rejected action stays rejected (never executed).
- **J cleanup** — all battery rows deleted; residue counts **zero** across requisitions, candidates, screenings, actions, audit logs, notifications.

### Gate suite
- `manage.py check` → "0 issues".
- `makemigrations --check --dry-run` → "No changes detected".
- `tsc --noEmit` → exit 0.
- `npm run build` → built (client + SSR + nitro), exit 0.

## Cleanup
All fixtures, notifications, and audit rows created by the battery were deleted (crash-safe `finally` cleanup). Live residue verified zero for every touched table. Stale dev servers were killed and a single fresh instance restarted on `127.0.0.1:8000`.

## Remaining gaps (pre-existing, intentionally out of scope)
1. **Real AI scoring needs a gateway key**: `callGateway` (`src/lib/ai.functions.ts`) requires `LOVABLE_API_KEY` in the environment; it is not configured locally, so real scoring cannot run here. The wiring is verified through deterministic scores driven through the exact producer INSERT contract — set the key to enable live scoring. No code path changed.
2. **`org_check` insert-arity defect — MITIGATED (offline)** (`backend/hr/policies.py`): `check_org.ok()` is `(user, old, new)` while `Policy.insert_ok` invokes the INSERT predicate with `(user, data)`. Static inspection found the mitigation already present: `_adapt_insert` normalises 3-arg predicates and `Policy.__init__` applies it, so `insert_ok` calls `org_check(user, {}, data)` instead of raising. 25 offline regression tests (`backend/hr/tests_insert_policy_arity.py`) passed, covering permission denial, same/foreign/missing-organization denial, and insert/check parity. Limitations: Live PostgreSQL verification NOT VERIFIED; real RBAC/database lookups NOT VERIFIED; cross-organization isolation against a second organization NOT VERIFIED; live HTTP error mapping NOT VERIFIED. The service-role workaround recorded for this flow is left unchanged — its current necessity is not re-established here.
3. **`perm_write`-as-INSERT defect — MITIGATED (offline)**: previously `perm_write("X")` bound the INSERT payload to the permission code (`perm(user, {...})` → `unhashable type: 'dict'`). Static inspection found `perm_write` now returns a `(user, old, new, code=…)` predicate so `insert_ok` passes the string code; the same 25 offline regression tests assert the code (never the payload) reaches `perm()`. Limitations: Live PostgreSQL verification NOT VERIFIED; real RBAC/database lookups NOT VERIFIED; cross-organization isolation against a second organization NOT VERIFIED; live HTTP error mapping NOT VERIFIED.

## Status
**PASS** — Shortlist AI producer → action → approve → execute chain now works end-to-end on the live stack; 38/38 live checks + full gate suite green; zero test residue.

> **Scope of this PASS — historical evidence only.** The 38/38 battery above is
> preserved unchanged as the historical record of what was observed under the
> conditions of that run. It does **not** satisfy the currently blocked Phase 8C
> security gate: the data-integrity incident is `UNRESOLVED` (no P1, P2 or P3
> evidence exists), and the Phase 8B live results this battery depended on are
> tainted by the 2026-10-12 safety violation. Phase 8C and Phase 9 remain
> `BLOCKED`. This PASS must not be read as clearance of any security,
> authorization, or tenant-isolation gate.