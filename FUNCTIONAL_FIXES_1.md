# Phase 8 — Functional Fixes 1

Status: FAIL — 3 of 4 fix rows fully PASS; ASSETS DB-trigger state contract genuinely absent (battery exit 1; 24 PASS / 2 FAIL gates)

Fixes verified live (Django + PostgREST + PostgreSQL 17, schema `spine_ai`, `http://127.0.0.1:8000/api/v1`) against the exact REST contract the fixed frontend now emits — using the real `hr_admin` HR path end-to-end, plus the documented `admin`/service-role workarounds for two pre-existing RBAC defects that are out of scope (not fixed, see note). Every mutation was created, read back, and deleted by the battery; zero residue.

| Row | Table | Operation | OLD shape (rejected 400/422) | NEW shape (accepted 200/201/204) | Role | Read-back (scoped) |
|-----|-------|-----------|------------------------------|-----------------------------------|------|--------------------|
| LEAVE | leave_requests | approve PATCH | `decided_by` (no such column) | `{status, approver_id, decided_at}` | hr_admin | `status=approved`, `approver_id`, `decided_at` persisted |
| HELPDESK | ticket_comments / ticket_internal_notes | POST comment/note | `author_id` (no such column) | `{ticket_id, author, body}` | hr_admin | `author` persisted on both; `assigned_to` unchanged |
| ASSETS | employee_asset_assignments | INSERT status contract `active`/`returned` | legacy value `assigned` (correctly not synced) | `active`/`returned` rows | admin writes / service-role insert (RBAC workaround) | `company_assets.status` must transition `available → assigned → available` — **FAIL: stays `available`** |
| ATTENDANCE | attendance_records | POST record | NaN / invalid dates | finite checkOut shape, same-day + cross-day | hr_admin | all numeric fields persisted finite; dates valid |

Battery: `C:\Users\kiran.r\AppData\Local\Temp\opencode\p8_fixes_battery.py` — executed exactly once, exit 1.

Result: **passed=24 failed=2**
FAILED: `asset_trigger_sync_assigned`, `asset_trigger_sync_available`

The two FAIL gates are one defect in one row (ASSETS): the DB trigger that must synchronize allocation state was never created in the live database.

### The genuine failure (ASSETS DB-trigger contract)

1. Assignment row written with `status='active'` via service role → 204; read back via `hr_admin` → persisted `active`. Verified: `asset_assign_active_accepted` PASS, `asset_assign_active_persisted` PASS.
2. But `company_assets.status` read back via `hr_admin` (RLS path) stays **`available`** → `asset_trigger_sync_assigned` FAIL.
3. Return PATCH `{status:'returned', returned_at}` via `admin` → 204; persisted. Verified: `asset_return_shape_accepted` PASS, `asset_returned_persisted` PASS. Company status stays `available` → `asset_trigger_sync_available` FAIL (full chain never completes because step 2 failed).
4. Legacy value `assigned` inserts → 204 and does **not** sync (stays `available`) → `asset_legacy_assign_not_synced` PASS (tells nothing about the trigger; it is a negative assertion only).

### Root cause

`drizzle\migrations\0010_spine_ai_phases_11_19.sql` declares the `sync_asset_assignment` trigger (`BEFORE INSERT OR UPDATE OF status ON employee_asset_assignments`) plus `sync_leave_balance`. In the live `spine_ai` DB, `pg_trigger` and `pg_proc` contain **no** triggers/functions on `employee_asset_assignments`, `company_assets`, or `leave_requests`. The "DB trigger synchronizes allocation state" half of the ASSETS contract is therefore genuinely absent — the application-level REST contract works and the frontend emits the correct statuses, but the DB layer that must reflect them was never created. This is a real, provable defect beyond the 4 frontend-contract fixes; the fix belongs in the database schema layer (apply/mirror the trigger into the live `spine_ai` schema and create `sync_leave_balance`), not in the frontend. It is out of the 4-fix scope, but the battery must exit nonzero because the contract item is not met.

### PASS evidence per row (live, not assumed)

- **LEAVE — 4/4.** No pending leaves existed for the HR employee, so the battery created its own fixture (employee `55555555-0000-0000-0000-000000000003`, Unpaid Leave type `66666666-0000-0000-0000-000000000004`, 2030-03-04 → 2030-03-06) via the `admin` token (workaround for the insert RBAC bug; see note). The fixture deliberately omits `organization_id` — the OLD fixture shape was rejected by the OLD frontend as `Could not find the "organization_id" column in "leave_requests"`. Approve PATCH with OLD `decided_by` → **400** `Could not find the "decided_by" column in "leave_requests"`. Approve PATCH with NEW `{status:'approved', approver_id, decided_at}` → **204**; read back via `hr_admin`: `status=approved`, `approver_id` = HR employee, `decided_at` set. The OLD shape rejection proves the fix.
- **HELPDESK — 8/8.** Open ticket found; `assigned_to` read before (`55555555-0000-0000-0000-000000000003`) and unchanged after. Comment and internal note POSTed with NEW `author` → **204** each; read back via `hr_admin` → `author` set. OLD `author_id` → **400** `Could not find the "author_id" column in "ticket_comments" / "ticket_internal_notes"`. OLD shape rejections prove the fix.
- **ASSETS — REST contract 4/4, DB state contract 2/2 FAIL, negative 1/1, read path 1/1.** Company asset fixture created via `admin` (super_admin bypasses the buggy insert predicate; **204**). Assignment `active` insert via service role (**204**), return PATCH via `admin` (**204**), reads via `hr_admin`. The DB trigger sync half fails as detailed above. `asset_readback_hr_path` PASS: reads performed through the real `hr_admin` RLS path, not the service role.
- **ATTENDANCE — 5/5.** Record POST via `hr_admin` (upsert on `on_conflict=employee_id,work_date`) → **204** for both same-day (2026-09-25, checkOut 18:00 same date) and cross-day (2026-10-12 → checkOut 2026-10-13). Read back via `hr_admin`: `late_minutes`/`overtime_minutes`/`early_departure_minutes`/`work_hours` all finite (no NaN), `status=present`, dates valid. No NaN/invalid_date persisted.

### Observance of the battery rules

- Live `_public` API + current role tokens; every fixture created, read back, **then deleted**; zero residue (verified `leave_requests`, `ticket_comments`, `ticket_internal_notes`, `company_assets`, `employee_asset_assignments`, both `attendance_records` rows, the `leave_balances` row created by approval, and the leave `notifications`). No pre-existing residue was deleted.
- No application code was changed. `backend/hr/rbac.py` and `backend/hr/policies.py` were intentionally **not** touched.
- 204 is a genuinely valid PostgREST success code (no `Prefer: return=representation` → 204); the OLD gate treated it as a failure. The battery's success gate is (200, 201, 204).
- The battery exits nonzero on a genuine defect (the missing DB trigger), as required — the exit code is the truth of the run, not a manufactured pass.

### Out-of-scope findings (documented, not fixed in Phase 8)

1. `backend/hr/policies.py` `perm_write(code)` returns `lambda user, code=code: perm(user, code)`; PostgREST POST-INSERT calls the insert predicate with the INSERT payload dict bound to `code`, so `dict in frozenset(...)` → **500** for every non-super-admin INSERT on tables using `perm_write` as their insert check (e.g. `leave_requests`, `company_assets`). Workaround used: fixture inserts via the `admin` (super_admin) token.
2. `employee_asset_assignments` insert predicate `_asset_assign_check(user, old, new)` is invoked as `(user, payload)` by `Policy.insert_ok` (2 args) → `TypeError: missing 1 required positional argument: 'new'` → **500 for every role**. Workaround used: assignment row written with the SERVICE ROLE key (writer-agnostic; the DB trigger — if present — fires regardless of writer). This is why `admin` writes the asset but the service role writes the allocation.

Both defects pre-date the 4 fixes and were neither introduced by, nor fixed by, this phase. No unrelated code was modified.