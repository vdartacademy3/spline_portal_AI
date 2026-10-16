-- ============================================================================
-- Spine AI — Phases 11-19: employee letters, asset management, expense policy
--   & reimbursement, training foundation, HR compliance, AI action execution,
--   payroll, onboarding templates, candidate screenings (shortlist AI)
-- ============================================================================

-- ===== PERMISSION SEED (new codes for phases 11-19) =====
insert into public.permissions (code, label, category, sensitive) values
  ('view_letters',        'View employee letters',      'letters',     true),
  ('manage_letters',      'Manage employee letters',    'letters',     true),
  ('view_assets',         'View company assets',        'assets',      false),
  ('manage_assets',       'Manage company assets',      'assets',      true),
  ('view_training',       'View training',              'training',    false),
  ('manage_training',     'Manage training',            'training',    true),
  ('view_compliance',     'View compliance',            'compliance',  true),
  ('manage_compliance',   'Manage compliance',          'compliance',  true),
  ('view_payroll',        'View payroll',               'payroll',     true),
  ('manage_payroll',      'Manage payroll',             'payroll',     true)
on conflict (code) do nothing;

-- Default permission assignments per role for the new codes
insert into public.role_permissions (role, permission_code)
select r.role, p.code
from (values
  ('hr_admin'::public.app_role,  (select array_agg(code) from public.permissions)),
  ('hr_staff'::public.app_role,  '{view_letters,manage_letters,view_assets,manage_assets,view_training,manage_training,view_compliance,manage_compliance,view_payroll,manage_payroll}'::text[]),
  ('manager'::public.app_role,   '{view_letters,view_assets,view_training,view_compliance}'::text[]),
  ('employee'::public.app_role,  '{view_training}'::text[])
) as r(role, codes)
cross join lateral unnest(r.codes) as p(code)
on conflict (role, permission_code) do nothing;

-- ===== PHASE 11: EMPLOYEE LETTERS =====
create table if not exists public.employee_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  letter_type text not null default 'appointment_letter',
  title text not null,
  content text not null,
  status text not null default 'draft',
  issued_by uuid,
  issued_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_employee_letters_emp on public.employee_letters(employee_id, status);

-- Notify the employee when a letter is issued
create or replace function public.notify_letter_issued()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.status = 'issued' and (tg_op = 'INSERT' or old.status is distinct from 'issued') then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Letter issued', new.title,
        'documents', '/letters');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_letter_issued on public.employee_letters;
create trigger notify_letter_issued after insert or update on public.employee_letters
  for each row execute function public.notify_letter_issued();

-- ===== PHASE 12: ASSET MANAGEMENT =====
create table if not exists public.company_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  category text not null default 'laptop',
  asset_tag text,
  serial_number text,
  purchase_date date,
  purchase_value numeric,
  status text not null default 'available',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assets_org on public.company_assets(organization_id, status);

create table if not exists public.employee_asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.company_assets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  expected_return date,
  status text not null default 'active',
  return_note text,
  returned_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_asset_assign_active
  on public.employee_asset_assignments(asset_id) where status = 'active';
create index if not exists idx_asset_assign_emp on public.employee_asset_assignments(employee_id);

-- Keep an asset status in sync with its active assignment
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

-- Notify the employee when assets are assigned or returned
create or replace function public.notify_asset_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select user_id into v_user from public.employees where id = new.employee_id;
  if v_user is not null then
    if new.status = 'active' then
      perform public.notify_user(v_user, 'Asset assigned',
        'A company asset has been issued to you.', 'assets', '/assets');
    elsif new.status = 'returned' and old.status = 'active' then
      perform public.notify_user(v_user, 'Asset returned',
        coalesce(new.return_note, 'Your company asset return has been recorded.'), 'assets',
        '/assets');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_asset_assignment on public.employee_asset_assignments;
create trigger notify_asset_assignment after insert or update on public.employee_asset_assignments
  for each row execute function public.notify_asset_assignment();

-- ===== PHASE 13: EXPENSE POLICY + REIMBURSEMENT =====
alter table public.expense_requests add column if not exists reimbursed_at timestamptz;
alter table public.expense_requests add column if not exists reimbursed_by uuid;

create table if not exists public.expense_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  category text not null,
  max_amount numeric,
  currency text not null default 'USD',
  requires_receipt boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, category)
);

-- Only approved expenses can be reimbursed; stamp when it happens
create or replace function public.guard_expense_reimbursement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reimbursed' and old.status is distinct from 'approved' then
    raise exception 'Only approved expenses can be reimbursed';
  end if;
  if new.status = 'reimbursed' and new.reimbursed_at is null then
    new.reimbursed_at := now();
    new.reimbursed_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists guard_expense_reimbursement on public.expense_requests;
create trigger guard_expense_reimbursement before update on public.expense_requests
  for each row execute function public.guard_expense_reimbursement();

update public.expense_requests set reimbursed_at = decided_at, reimbursed_by = approver_id
  where status = 'reimbursed' and reimbursed_at is null;

-- ===== PHASE 14: TRAINING & LEARNING FOUNDATION =====
create table if not exists public.training_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'technical',
  mode text not null default 'self_paced',
  duration_hours numeric,
  provider text,
  external_url text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists idx_training_org on public.training_programs(organization_id, status);

create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.training_programs(id) on delete cascade,
  title text not null,
  starts_on date,
  ends_on date,
  instructor text,
  location text,
  created_at timestamptz not null default now()
);
create index if not exists idx_training_sessions_prog on public.training_sessions(program_id);

create table if not exists public.employee_trainings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  program_id uuid not null references public.training_programs(id) on delete cascade,
  session_id uuid references public.training_sessions(id) on delete set null,
  enrolled_by uuid,
  enrolled_at timestamptz not null default now(),
  status text not null default 'not_started',
  completed_at timestamptz,
  certificate text,
  score numeric,
  notes text
);
create index if not exists idx_employee_trainings_emp on public.employee_trainings(employee_id, status);

-- Mark program completed when all enrollments are complete (best-effort)
create or replace function public.notify_training_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Training completed',
        'Your training has been marked complete.', 'training', '/training');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_training_completion on public.employee_trainings;
create trigger notify_training_completion after update on public.employee_trainings
  for each row execute function public.notify_training_completion();

-- ===== PHASE 15: HR COMPLIANCE FOUNDATION =====
create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  title text not null,
  category text not null default 'labor',
  description text,
  recurrence text not null default 'none',
  default_due_in_days int not null default 30,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists idx_compliance_org on public.compliance_items(organization_id, category);

create table if not exists public.employee_compliance (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.compliance_items(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  status text not null default 'due',
  due_date date,
  completed_at timestamptz,
  evidence_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, employee_id)
);
create index if not exists idx_employee_compliance_emp on public.employee_compliance(employee_id, status);

-- Notify the employee when a compliance item is assigned; notify HR on completion
create or replace function public.notify_compliance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'INSERT' then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Compliance item assigned',
        'A compliance item has been assigned to you.', 'compliance', '/compliance');
    end if;
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.notify_hr('Compliance item completed',
      'An employee has completed a compliance item.', 'compliance', '/compliance');
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_compliance on public.employee_compliance;
create trigger notify_compliance after insert or update on public.employee_compliance
  for each row execute function public.notify_compliance();

-- ===== PHASE 17: PAYROLL =====
create table if not exists public.employee_salaries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  effective_from date not null default current_date,
  basic numeric not null default 0,
  allowances jsonb not null default '{}'::jsonb,
  deductions jsonb not null default '{}'::jsonb,
  currency text not null default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  paid_at timestamptz,
  paid_by uuid
);
create index if not exists idx_payroll_runs_org on public.payroll_runs(organization_id, status);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  basic numeric not null default 0,
  allowances numeric not null default 0,
  deductions numeric not null default 0,
  gross numeric not null default 0,
  net numeric not null default 0,
  status text not null default 'included',
  notes text,
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index if not exists idx_payroll_entries_run on public.payroll_entries(run_id);

-- Payroll entries can only change while the run is a draft
create or replace function public.guard_payroll_entries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.payroll_runs r
                 where r.id = new.run_id and r.status = 'draft') then
    raise exception 'Payroll entries can only be edited while the run is a draft';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_payroll_entries on public.payroll_entries;
create trigger guard_payroll_entries before insert or update on public.payroll_entries
  for each row execute function public.guard_payroll_entries();

-- Resume lock on payroll runs: a paid run cannot be cancelled
create or replace function public.guard_payroll_run_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'paid' and new.status is distinct from 'paid' then
    raise exception 'A paid payroll run cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_payroll_run_status on public.payroll_runs;
create trigger guard_payroll_run_status before update on public.payroll_runs
  for each row execute function public.guard_payroll_run_status();

-- Notify every employee in the run when payroll is released
create or replace function public.notify_payroll_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_user uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    for v_emp in
      select pe.employee_id from public.payroll_entries pe
      where pe.run_id = new.id and pe.status = 'included'
    loop
      select user_id into v_user from public.employees where id = v_emp;
      if v_user is not null then
        perform public.notify_user(v_user, 'Payroll released',
          format('Your payroll for %s to %s has been released.', new.period_start, new.period_end),
          'payroll', '/payroll');
      end if;
    end loop;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_payroll_paid on public.payroll_runs;
create trigger notify_payroll_paid after update on public.payroll_runs
  for each row execute function public.notify_payroll_paid();

-- ===== PHASE 18: ONBOARDING TEMPLATES =====
create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.onboarding_template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.onboarding_templates(id) on delete cascade,
  title text not null,
  owner text not null default 'hr',
  due_in_days int not null default 0,
  sort_order int not null default 0
);
create index if not exists idx_onboarding_tt on public.onboarding_template_tasks(template_id, sort_order);

-- ===== PHASE 19: CANDIDATE SCREENINGS (SHORTLIST AI evidence) =====
create table if not exists public.candidate_screenings (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  requisition_id uuid references public.job_requisitions(id) on delete cascade,
  score numeric not null default 0,
  rating text not null default 'neutral',
  summary text,
  evidence jsonb,
  action_type text not null default 'shortlist',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_candidate_screenings_cand on public.candidate_screenings(candidate_id);
create index if not exists idx_candidate_screenings_req on public.candidate_screenings(requisition_id);

-- ===== RLS POLICIES =====
alter table public.employee_letters enable row level security;
alter table public.company_assets enable row level security;
alter table public.employee_asset_assignments enable row level security;
alter table public.expense_policies enable row level security;
alter table public.training_programs enable row level security;
alter table public.training_sessions enable row level security;
alter table public.employee_trainings enable row level security;
alter table public.compliance_items enable row level security;
alter table public.employee_compliance enable row level security;
alter table public.employee_salaries enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.onboarding_template_tasks enable row level security;
alter table public.candidate_screenings enable row level security;

-- Employee letters
create policy "letter read"  on public.employee_letters for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "letter write" on public.employee_letters for all to authenticated
  using (public.has_permission(auth.uid(),'manage_letters') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_letters'));

-- Assets
create policy "asset read"  on public.company_assets for select to authenticated
  using (public.has_permission(auth.uid(),'view_assets') or public.is_hr(auth.uid())
         or exists (select 1 from public.employee_asset_assignments a
                    where a.asset_id = company_assets.id and a.status = 'active'
                      and public.is_self_employee(auth.uid(), a.employee_id)));
create policy "asset write" on public.company_assets for all to authenticated
  using (public.has_permission(auth.uid(),'manage_assets'))
  with check (public.has_permission(auth.uid(),'manage_assets'));
create policy "aassign read" on public.employee_asset_assignments for select to authenticated
  using (public.has_permission(auth.uid(),'view_assets') or public.can_view_employee(auth.uid(), employee_id));
create policy "aassign write" on public.employee_asset_assignments for all to authenticated
  using (public.has_permission(auth.uid(),'manage_assets') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_assets'));

-- Expense policies
create policy "ep read"  on public.expense_policies for select to authenticated using (true);
create policy "ep write" on public.expense_policies for all to authenticated
  using (public.has_permission(auth.uid(),'manage_employee') or public.has_permission(auth.uid(),'manage_payroll'))
  with check (public.has_permission(auth.uid(),'manage_employee') or public.has_permission(auth.uid(),'manage_payroll'));

-- Training
create policy "tp read"  on public.training_programs for select to authenticated using (true);
create policy "tp write" on public.training_programs for all to authenticated
  using (public.has_permission(auth.uid(),'manage_training'))
  with check (public.has_permission(auth.uid(),'manage_training'));
create policy "ts read"  on public.training_sessions for select to authenticated using (true);
create policy "ts write" on public.training_sessions for all to authenticated
  using (public.has_permission(auth.uid(),'manage_training'))
  with check (public.has_permission(auth.uid(),'manage_training'));
create policy "et read"  on public.employee_trainings for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "et write" on public.employee_trainings for all to authenticated
  using (public.has_permission(auth.uid(),'manage_training') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_training'));

-- Compliance
create policy "ci read"  on public.compliance_items for select to authenticated using (true);
create policy "ci write" on public.compliance_items for all to authenticated
  using (public.has_permission(auth.uid(),'manage_compliance') or public.has_permission(auth.uid(),'manage_organization'))
  with check (public.has_permission(auth.uid(),'manage_compliance') or public.has_permission(auth.uid(),'manage_organization'));
create policy "ec read"  on public.employee_compliance for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "ec write" on public.employee_compliance for all to authenticated
  using (public.has_permission(auth.uid(),'manage_compliance') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_compliance'));

-- Payroll (compensation is sensitive: HR manages, employees see only their own)
create policy "sal read"  on public.employee_salaries for select to authenticated
  using (public.has_permission(auth.uid(),'view_payroll') or public.is_self_employee(auth.uid(), employee_id));
create policy "sal write" on public.employee_salaries for all to authenticated
  using (public.has_permission(auth.uid(),'manage_payroll') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_payroll'));
create policy "pr read"  on public.payroll_runs for select to authenticated
  using (public.has_permission(auth.uid(),'view_payroll'));
create policy "pr write" on public.payroll_runs for all to authenticated
  using (public.has_permission(auth.uid(),'manage_payroll'))
  with check (public.has_permission(auth.uid(),'manage_payroll'));
create policy "pe read"  on public.payroll_entries for select to authenticated
  using (public.has_permission(auth.uid(),'view_payroll')
         or exists (select 1 from public.payroll_runs r
                    where r.id = payroll_entries.run_id and r.status = 'paid'
                      and public.is_self_employee(auth.uid(), payroll_entries.employee_id)));
create policy "pe write" on public.payroll_entries for all to authenticated
  using (public.has_permission(auth.uid(),'manage_payroll'))
  with check (public.has_permission(auth.uid(),'manage_payroll'));

-- Onboarding templates
create policy "ot read"  on public.onboarding_templates for select to authenticated
  using (public.has_permission(auth.uid(),'view_onboarding') or public.has_permission(auth.uid(),'manage_onboarding'));
create policy "ot write" on public.onboarding_templates for all to authenticated
  using (public.has_permission(auth.uid(),'manage_onboarding'))
  with check (public.has_permission(auth.uid(),'manage_onboarding'));
create policy "ott read"  on public.onboarding_template_tasks for select to authenticated
  using (exists (select 1 from public.onboarding_templates t where t.id = template_id
                 and (public.has_permission(auth.uid(),'view_onboarding') or public.has_permission(auth.uid(),'manage_onboarding'))));
create policy "ott write" on public.onboarding_template_tasks for all to authenticated
  using (public.has_permission(auth.uid(),'manage_onboarding'))
  with check (public.has_permission(auth.uid(),'manage_onboarding'));

-- Candidate screenings
create policy "cs read"  on public.candidate_screenings for select to authenticated
  using (public.has_permission(auth.uid(),'view_recruitment'));
create policy "cs write" on public.candidate_screenings for all to authenticated
  using (public.has_permission(auth.uid(),'manage_recruitment'))
  with check (public.has_permission(auth.uid(),'manage_recruitment'));

-- ===== GRANTS =====
grant select, insert, update, delete on public.employee_letters, public.company_assets,
  public.employee_asset_assignments, public.expense_policies, public.training_programs,
  public.training_sessions, public.employee_trainings, public.compliance_items,
  public.employee_compliance, public.employee_salaries, public.payroll_runs,
  public.payroll_entries, public.onboarding_templates, public.onboarding_template_tasks,
  public.candidate_screenings to authenticated;
grant all on public.employee_letters, public.company_assets,
  public.employee_asset_assignments, public.expense_policies, public.training_programs,
  public.training_sessions, public.employee_trainings, public.compliance_items,
  public.employee_compliance, public.employee_salaries, public.payroll_runs,
  public.payroll_entries, public.onboarding_templates, public.onboarding_template_tasks,
  public.candidate_screenings to service_role;