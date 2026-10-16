# Phase 8 — Final Functional Regression

Status: **PASS**

## Battery executed

Authoritative Phase 8 battery, run **exactly as-is** (no edits):

`C:\Users\kiran.r\AppData\Local\Temp\opencode\p8_fixes_battery.py`

- Against the live Django API `http://127.0.0.1:8000/api/v1` (unchanged application code), which in turn
  uses the live native `spine_ai` PostgreSQL database (`127.0.0.1:5432`, PostgreSQL 17.11).
- Success gate used by the battery (unchanged): HTTP 200 / 201 / 204.
- Exit code: **0**.

## Complete result

**passed=26 failed=0** (Phase 8 baseline was 24 PASS / 2 FAIL; the two previously failing gates are now green):

| Row | Table | Result |
|-----|-------|--------|
| LEAVE | leave_requests approve PATCH | **PASS** — `status=approved`, `approver_id`, `decided_at` persisted; OLD `decided_by` rejected 400; fixture cleaned |
| HELPDESK | ticket_comments / ticket_internal_notes | **PASS** — `author` persisted on both; OLD `author_id` rejected 400; `assigned_to` unchanged; fixtures cleaned |
| ASSETS | employee_asset_assignments / company_assets | **PASS (all 9 gates)** — the two DB-trigger gates flipped to PASS (see below); fixture cleaned |
| ATTENDANCE | attendance_records | **PASS** — fixed checkOut shape accepted; no NaN; same-day + cross-day valid; fixtures cleaned |

Battery residue check: **residue: CLEAN**.

Full run transcript retained: `C:\Users\kiran.r\AppData\Local\Temp\opencode\p8_fixes_battery_final_out.txt`.

## Final asset gates (specific re-verification)

The three asset triggers from the battery, all **PASS** on the live DB (reads through the `hr_admin` RLS path):

1. **`active` → `company_assets.status = assigned`**
   `asset_trigger_sync_assigned` — `company_status_after_active_assign=assigned (hr_admin read)` **PASS**
   (this was a FAIL row in Phase 8; now green).
2. **`returned` → `company_assets.status = available`**
   `asset_trigger_sync_available` — `assign_sync=assigned return_sync=available (hr_admin reads)` **PASS**
   (this was a FAIL row in Phase 8; full `available → assigned → available` chain now completes).
3. **legacy `assigned` does not incorrectly sync**
   `asset_legacy_assign_not_synced` — `legacy_created=204 company_stayed=available` **PASS**.

## Cleanup / zero residue

- Battery-owned fixtures (leave_requests 2030-03-04, leave_balances year 2030, ticket_comments/notes for
  this run's bodies, company_assets/assignments `Phase8 Trigger …`, attendance for hr_admin on
  2026-09-25/2026-10-12, notifications 2030-03-04) — **all zero** after cleanup. Direct SQL spot-check:
  `company_assets` marked 0, assignments 0, leave 2030 requests 0, leave_balances 2030 0, attendance
  (battery dates, hr employee) 0, notifications 2030-04-marked 0.
- Pre-existing `employee_asset_assignments` count: 0 (unchanged). `company_assets` total: 5 (unchanged).
- The Phase 8.1 asset trigger remains present: `sync_asset_assignment` on
  `employee_asset_assignments` (`AFTER INSERT OR UPDATE … FOR EACH ROW … sync_asset_assignment()`).

## Remaining findings (documented, not modified)

- The two out-of-scope RBAC defects are **MITIGATED (offline)** per static inspection: `perm_write`-as-INSERT
  (the payload-dict-unhashable defect) and `_asset_assign_check` INSERT arity. `backend/hr/policies.py`
  already normalises the arity (`_adapt_insert`/`_adapt_check`, applied in `Policy.__init__`) and
  `perm_write` takes a `(user, old, new, code=…)` predicate, so a direct non-service INSERT no longer
  raises. 25 offline regression tests (`backend/hr/tests_insert_policy_arity.py`) passed.
  Limitations: Live PostgreSQL verification NOT VERIFIED; real RBAC/database lookups NOT VERIFIED;
  cross-organization isolation against a second organization NOT VERIFIED; live HTTP error mapping
  NOT VERIFIED. The battery's documented workarounds (super-admin writes company_assets, service-role
  writes assignments) are left exactly as in Phase 8 — their current necessity is not re-established here.
- Historical probe residue predating today's run remains **untouched** (per scope lock, do not delete
  pre-existing data): 9 `ticket_comments` and 9 `ticket_internal_notes` rows with `phase8 …` bodies
  created 2026-09-23 22:00 → 2026-09-24 00:28 (all on ticket `a6934dce-…`), plus one `attendance_records`
  row (`source='phase8_final'`, employee `…000006`, work_date 2026-09-25, created 2026-09-23 23:55).
  These are all from the historical Phase 8 probe session, not from today's authoritative battery run.