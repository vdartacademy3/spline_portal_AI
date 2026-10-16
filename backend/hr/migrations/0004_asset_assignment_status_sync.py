"""Add the missing asset-assignment status-sync trigger/function.

The intended contract (drizzle/migrations/0010_spine_ai_phases_11_19.sql,
PHASE 12, registered as journal idx 10) declares a DB trigger that keeps
`company_assets.status` in sync with `employee_asset_assignments.status`:

  - assignment INSERT with status='active'   -> company_assets.status='assigned'
  - assignment UPDATE to 'returned' (from 'active')
                                              -> company_assets.status='available'

The live `spine_ai` database is Django-managed (django_migrations documents
hr/0001..0003; RLS is disabled and no DB triggers exist there), so the
trigger was never created in it. This migration delivers the same contract
through the Django migration chain so a fresh `manage.py migrate` database
and the existing spine_ai database converge.

Idempotent: function uses `create or replace`, trigger uses
`drop trigger if exists` before creating.

Authoritative source: drizzle/migrations/0010_spine_ai_phases_11_19.sql:103-118.
"""

from django.db import migrations

SQL_FORWARD = """
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
"""

SQL_REVERSE = """
drop trigger if exists sync_asset_assignment on public.employee_asset_assignments;
drop function if exists public.sync_asset_assignment();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("hr", "0003_seed_hr_admin_permissions"),
    ]

    operations = [
        migrations.RunSQL(SQL_FORWARD, SQL_REVERSE),
    ]