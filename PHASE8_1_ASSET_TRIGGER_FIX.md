# Phase 8.1 — Asset Trigger Fix

Status: **PASS**

Live database: `spine_ai` (native PostgreSQL 17.11 on `127.0.0.1:5432`, PostgreSQL 17.x).
Live API: `http://127.0.0.1:8000/api/v1` (Django PostgREST-compatible surface, unchanged).

## Root cause

`drizzle/migrations/0010_spine_ai_phases_11_19.sql` (PHASE 12, journal idx 10) declares the intended
asset-status sync contract — trigger `sync_asset_assignment` on `employee_asset_assignments`
(`AFTER INSERT OR UPDATE`) plus function `public.sync_asset_assignment()` — so any fresh database
built from the drizzle SQL chain receives it.

The live `spine_ai` database is **Django-managed**, not drizzle-built. Proof gathered before the fix:

- `django_migrations` recorded only `hr/0001_initial`, `hr/0002_seed_data`,
  `hr/0003_seed_hr_admin_permissions`.
- `pg_class.relrowsecurity = f` for both asset tables and `pg_policies` had zero rows → the drizzle RLS
  migrations were never applied to this database.
- `pg_proc` in `public` had **no** functions matching `%asset%` or `%sync%`.
- `pg_trigger` had **no** triggers on `employee_asset_assignments` or `company_assets`.

Because the Django migration chain is the mechanism that actually builds this database, the repair
belongs in a **Django migration**, so a fresh `manage.py migrate` database and the existing `spine_ai`
database converge on the same contract. (The drizzle SQL chain already declares it in `0010`; nothing was
added there to avoid duplicating an equivalent declaration.)

## Migration / file changed

New file: `backend/hr/migrations/0004_asset_assignment_status_sync.py`

Applied to the live database: `python manage.py migrate hr` → `Applying hr.0004_asset_assignment_status_sync... OK`
(now recorded in `django_migrations` as `hr|0004_asset_assignment_status_sync`).

The migration is a faithful port of the intended contract from
`drizzle/migrations/0010_spine_ai_phases_11_19.sql:103-118` (no new business rules), and is idempotent
(`create or replace` function; `drop trigger if exists` before create). Reverse operation drops both.

## Trigger / function created

```sql
create or replace function public.sync_asset_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    update public.company_assets set status = 'assigned', updated_at = now()
      where id = new.asset_id;
  elsif tg_op = 'UPDATE' and new.status = 'returned' and old.status = 'active' then
    update public.company_assets set status = 'available', updated_at = now()
      where id = new.asset_id;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists sync_asset_assignment on public.employee_asset_assignments;
create trigger sync_asset_assignment after insert or update on public.employee_asset_assignments
  for each row execute function public.sync_asset_assignment();
```

## Before state

| Item | Before |
|------|--------|
| `public.sync_asset_assignment()` in `pg_proc` | absent |
| `sync_asset_assignment` trigger in `pg_trigger` | absent |
| triggers on `company_assets` | none |
| `django_migrations` (hr) | `0001_initial`, `0002_seed_data`, `0003_seed_hr_admin_permissions` |
| `company_assets` rows | 5 (pre-existing) |
| `employee_asset_assignments` rows | 0 |

## After state

| Item | After |
|------|-------|
| `public.sync_asset_assignment()` in `pg_proc` | present (body matches the intended contract) |
| `pg_trigger` on `employee_asset_assignments` | `sync_asset_assignment AFTER INSERT OR UPDATE ON public.employee_asset_assignments FOR EACH ROW EXECUTE FUNCTION sync_asset_assignment()` |
| `django_migrations` (hr) | `... , 0004_asset_assignment_status_sync` |
| `company_assets` rows | 5 (unchanged, pre-existing preserved) |
| `employee_asset_assignments` rows | 0 (untouched) |

## ACTIVE → assigned live evidence

Verification driver: `C:\Users\kiran.r\AppData\Local\Temp\opencode\p81_asset_verify.py` (run twice; final
run 17/17 gates PASS — full output in `p81_asset_verify_out.txt`). Isolated fixtures only.

**API plane** (lives through the real REST surface; mutation statuses 204/201/200 accepted):

- POST `company_assets` (admin) → 204; asset created (`api_asset_created` PASS).
- POST `employee_asset_assignments` `{status:"active"}` (service role) → 204
  (`api_assign_active_accepted` PASS); read back via `hr_admin` → `status=active` persisted
  (`api_assign_active_persisted` PASS).
- GET `company_assets?id=<asset>` via `hr_admin` → **`status=assigned`**
  (`api_company_assigned_after_active` PASS — this is the Phase 8 failing gate
  `asset_trigger_sync_assigned`, now green).

**SQL plane** (native PostgreSQL direct, authoritative):

- `insert into employee_asset_assignments(...) values (... 'active') returning id` → row created.
- `select status from company_assets` → **`assigned`** (`sql_company_assigned_after_active` PASS).

## RETURNED → available live evidence

**API plane**:

- PATCH `employee_asset_assignments?id=<active>&status=eq.active` `{status:"returned", returned_at}` (admin)
  → 204 (`api_return_shape_accepted` PASS); read back via `hr_admin` → `status=returned`, `returned_at` set
  (`api_return_persisted` PASS).
- GET `company_assets?id=<asset>` via `hr_admin` → **`status=available`**
  (`api_company_available_after_return` PASS — Phase 8 failing gate `asset_trigger_sync_available`, full
  assign→return chain now completes).

**SQL plane**:

- `update employee_asset_assignments set status='returned', returned_at=now()` on the active row.
- `select status from company_assets` → **`available`** (`sql_company_available_after_return` PASS).

## Negative / legacy behavior evidence

Legacy value `assigned` must NOT trigger the `active`→`assigned` transition.

**API plane**: POST `employee_asset_assignments` `{status:"assigned"}` (service role) → 204, row read back
(`api_legacy_assign_created` PASS); `company_assets.status` still **`available`** via `hr_admin`
(`api_legacy_not_synced` PASS — matches Phase 8 `asset_legacy_assign_not_synced`).

**SQL plane**: INSERT `status='assigned'` direct → row created; `company_assets.status` still
**`available`** (`sql_legacy_not_synced` PASS).

## PostgreSQL version

`PostgreSQL 17.11 on x86_64-windows, compiled by msvc-19.44.35228, 64-bit` (PostgreSQL 17.x, as required).

## Migration / check results

- `python manage.py check` → `System check identified no issues (0 silenced)`, exit 0.
- `python manage.py makemigrations --check --dry-run` → `No changes detected`, exit 0.

## Build / typecheck results

- `node_modules/.bin/tsc --noEmit` → exit 0 (no type errors).
- `npm run build` → exit 0. `vite v8.1.5`: client env `✓ built in 40.09s`, SSR env `✓ built in 12.09s`,
  nitro env `✓ built`, `Generated .output/nitro.json`, `√ You can deploy this build`. Only pre-existing
  deprecation warnings (`inputValidator()`, vite-tsconfig-paths plugin); none related to this change.

## Cleanup result

Only fixtures created by this verification were deleted (API-plane asset+assignments via service/admin
DELETE; SQL-plane rows via `DELETE ... ; DELETE ... ;`). Post-cleanup residue check:

- `company_assets where name like 'P81%'` → 0
- `employee_asset_assignments joining P81 assets` → 0
- `company_assets` total → 5 (pre-existing, unchanged)
- `employee_asset_assignments` total → 0 (pre-existing, unchanged)

Zero residue; no pre-existing data deleted.

## Remaining findings (documented, not fixed — out of Phase 8.1 scope)

1. The two pre-existing RBAC defects remain unfixed (out of scope, as instructed):
   `backend/hr/policies.py` `perm_write`-as-INSERT unhashable-dict defect; `_asset_assign_check`
   3-arg/2-arg arity defect. Verification used the same documented workarounds as Phase 8
   (super-admin writes company_assets; service-role writes assignments; all reads via `hr_admin`).
2. `sync_leave_balance` (and the notification triggers) also exist only in the drizzle chain, not in the
   live DB. Leave approval already passes at the REST level through the Python parity in
   `backend/hr/triggers.py`; the DB copies are not part of this asset fix.
3. Observation (no change made): on the Django-managed tables, `company_assets.id`,
   `created_at`/`updated_at` and `employee_asset_assignments.assigned_at`/`created_at` have no DB-level
   defaults, so direct SQL inserts must supply them; the API/ORM path is unaffected and was not changed.
4. `npm run build` was invoked as `cmd /c "npm run build"` because the `npm.ps1` shim resolves the
   workspace incorrectly from this shell; output and exit code are identical to the direct `vite build`
   verification above.