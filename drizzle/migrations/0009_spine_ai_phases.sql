-- ============================================================================
-- Spine AI — Phases 1-10: shifts, attendance, performance cycles,
--             document verification, lifecycle, offboarding, leave policies,
--             helpdesk SLA, expenses, profile change requests, permission seed
-- ============================================================================

-- ===== PERMISSION SEED (required by existing RLS: has_permission) =====
insert into public.permissions (code, label, category, sensitive) values
  ('view_employee',        'View employees',               'employees',     true),
  ('manage_employee',      'Manage employees',             'employees',     true),
  ('view_attendance',      'View attendance',              'attendance',    false),
  ('manage_attendance',    'Manage attendance',            'attendance',    true),
  ('manage_shifts',        'Manage shifts',                'attendance',    false),
  ('view_leave',           'View leave',                   'leave',         false),
  ('manage_leave',         'Manage leave',                 'leave',         true),
  ('view_performance',     'View performance',             'performance',   true),
  ('manage_performance',   'Manage performance',           'performance',   true),
  ('view_documents',       'View employee documents',      'documents',     true),
  ('manage_documents',     'Manage employee documents',    'documents',     true),
  ('view_recruitment',     'View recruitment',             'recruitment',   true),
  ('manage_recruitment',   'Manage recruitment',           'recruitment',   true),
  ('view_onboarding',      'View onboarding',              'onboarding',    false),
  ('manage_onboarding',    'Manage onboarding',            'onboarding',    true),
  ('view_helpdesk',        'View helpdesk',                'helpdesk',      false),
  ('manage_helpdesk',      'Manage helpdesk',              'helpdesk',      true),
  ('view_analytics',       'View analytics',               'analytics',     true),
  ('view_audit',           'View audit logs',              'admin',         true),
  ('manage_organization',  'Manage organization structure', 'admin',        true),
  ('manage_users',         'Manage user access',           'admin',         true),
  ('view_knowledge',       'View knowledge base',          'admin',         false),
  ('manage_knowledge',     'Manage knowledge base',        'admin',         true),
  ('use_ai',               'Use Spine AI',                 'ai',            false),
  ('manage_ai',            'Manage AI actions',            'ai',            true),
  ('view_offboarding',     'View offboarding',             'offboarding',   true),
  ('manage_offboarding',   'Manage offboarding',           'offboarding',   true)
on conflict (code) do nothing;

-- Default permission assignments per role (super_admin is implicit via has_permission)
insert into public.role_permissions (role, permission_code)
select r.role, p.code
from (values
  ('hr_admin'::public.app_role,  (select array_agg(code) from public.permissions)),
  ('hr_staff'::public.app_role,  '{view_employee,manage_employee,view_attendance,manage_attendance,manage_shifts,view_leave,manage_leave,view_performance,manage_performance,view_documents,manage_documents,view_recruitment,manage_recruitment,view_onboarding,manage_onboarding,view_helpdesk,manage_helpdesk,view_analytics,view_knowledge,manage_knowledge,use_ai,manage_ai,view_offboarding,manage_offboarding}'::text[]),
  ('manager'::public.app_role,   '{view_employee,view_attendance,view_leave,manage_leave,view_performance,manage_performance,view_documents,view_helpdesk,view_analytics,use_ai,view_offboarding}'::text[]),
  ('employee'::public.app_role,  '{view_attendance,view_leave,view_performance,view_documents,view_helpdesk,use_ai}'::text[])
) as r(role, codes)
cross join lateral unnest(r.codes) as p(code)
on conflict (role, permission_code) do nothing;

-- ===== SHIFTS =====
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 60,
  grace_minutes int not null default 30,
  overtime_after_minutes int not null default 0,
  minimum_hours numeric not null default 8,
  half_day_hours numeric not null default 4,
  overnight boolean not null default false,
  days_of_week smallint[] not null default '{1,2,3,4,5}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists idx_shifts_org on public.shifts(organization_id);

create table if not exists public.employee_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  assigned_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  constraint shift_assign_active_end check (not is_active or effective_to is null)
);
create index if not exists idx_shift_assign_emp on public.employee_shift_assignments(employee_id, effective_from);
create index if not exists idx_shift_assign_shift on public.employee_shift_assignments(shift_id);

-- ===== ATTENDANCE ENHANCEMENTS =====
alter table public.attendance_records add column if not exists work_hours numeric;
alter table public.attendance_records add column if not exists early_departure_minutes int not null default 0;
alter table public.attendance_records add column if not exists is_half_day boolean not null default false;
alter table public.attendance_records add column if not exists source text not null default 'manual';
alter table public.attendance_records add column if not exists note text;
alter table public.attendance_records add column if not exists updated_by uuid;

-- Enforced audit trail for attendance (cannot be bypassed)
create or replace function public.audit_attendance_record()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  insert into public.audit_logs (user_id, action, entity, entity_id, previous_value, new_value)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'attendance.created' when 'UPDATE' then 'attendance.updated' else 'attendance.deleted' end,
    'attendance_records',
    coalesce(new.id, old.id)::text,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;
drop trigger if exists audit_attendance on public.attendance_records;
create trigger audit_attendance after insert or update or delete on public.attendance_records
  for each row execute function public.audit_attendance_record();

-- ===== ATTENDANCE CORRECTIONS =====
create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  attendance_id uuid references public.attendance_records(id) on delete cascade,
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  requested_status text,
  reason text,
  status text not null default 'pending',
  approver_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_att_corr_emp on public.attendance_corrections(employee_id, status);
create index if not exists idx_att_corr_att on public.attendance_corrections(attendance_id);

-- ===== PERFORMANCE CYCLES =====
create table if not exists public.performance_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  period text not null,
  start_date date not null default current_date,
  end_date date,
  review_start_date date,
  review_end_date date,
  self_review_required boolean not null default true,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

alter table public.performance_reviews add column if not exists cycle_id uuid references public.performance_cycles(id) on delete set null;
alter table public.performance_reviews add column if not exists self_rating numeric;
alter table public.performance_reviews add column if not exists self_strengths text;
alter table public.performance_reviews add column if not exists self_improvements text;
alter table public.performance_reviews add column if not exists self_summary text;
alter table public.performance_reviews add column if not exists self_submitted_at timestamptz;
alter table public.performance_reviews add column if not exists submitted_at timestamptz;
alter table public.performance_reviews add column if not exists finalized_at timestamptz;
alter table public.performance_reviews add column if not exists finalized_by uuid;

alter table public.goals add column if not exists cycle_id uuid references public.performance_cycles(id) on delete set null;

-- Protect finalized reviews from modification (except Super Admin)
create or replace function public.protect_finalized_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if not public.has_role(auth.uid(), 'super_admin') and old.finalized_at is not null then
    raise exception 'Finalized performance reviews cannot be modified';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists protect_finalized_review on public.performance_reviews;
create trigger protect_finalized_review
  before update on public.performance_reviews
  for each row execute function public.protect_finalized_review();

-- ===== DOCUMENT VERIFICATION =====
alter table public.employee_documents add column if not exists reviewer_id uuid;
alter table public.employee_documents add column if not exists verified_at timestamptz;
alter table public.employee_documents add column if not exists verification_comment text;
alter table public.employee_documents add column if not exists version int not null default 1;

create table if not exists public.document_verifications (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.employee_documents(id) on delete cascade,
  action text not null,
  reviewer_id uuid,
  comment text,
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);
create index if not exists idx_doc_verif_doc on public.document_verifications(document_id);

-- Allow employees to submit their own documents (self-service)
drop policy if exists "docs self insert" on public.employee_documents;
create policy "docs self insert" on public.employee_documents for insert to authenticated
  with check (employee_id = public.current_employee_id(auth.uid()));

-- ===== EMPLOYEE LIFECYCLE =====
create table if not exists public.employee_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  event_type text not null,
  effective_date date not null default current_date,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_emp_events_emp on public.employee_lifecycle_events(employee_id, effective_date);

create or replace function public.record_employee_change()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return new;
  end if;
  if new.designation is distinct from old.designation then
    insert into public.employee_lifecycle_events
      (employee_id, event_type, effective_date, previous_value, new_value, reason, actor_id)
    values (new.id, 'role_change', current_date,
            to_jsonb(old.designation), to_jsonb(new.designation),
            'Designation updated', actor);
  end if;
  if new.department_id is distinct from old.department_id then
    insert into public.employee_lifecycle_events
      (employee_id, event_type, effective_date, previous_value, new_value, reason, actor_id)
    values (new.id, 'internal_transfer', current_date,
            to_jsonb(old.department_id), to_jsonb(new.department_id),
            'Department changed', actor);
  end if;
  if new.location_id is distinct from old.location_id then
    insert into public.employee_lifecycle_events
      (employee_id, event_type, effective_date, previous_value, new_value, reason, actor_id)
    values (new.id, 'location_change', current_date,
            to_jsonb(old.location_id), to_jsonb(new.location_id),
            'Location changed', actor);
  end if;
  if new.manager_id is distinct from old.manager_id then
    insert into public.employee_lifecycle_events
      (employee_id, event_type, effective_date, previous_value, new_value, reason, actor_id)
    values (new.id, 'reporting_change', current_date,
            to_jsonb(old.manager_id), to_jsonb(new.manager_id),
            'Manager changed', actor);
  end if;
  if new.employment_status is distinct from old.employment_status then
    insert into public.employee_lifecycle_events
      (employee_id, event_type, effective_date, previous_value, new_value, reason, actor_id)
    values (new.id, 'status_change', current_date,
            to_jsonb(old.employment_status), to_jsonb(new.employment_status),
            'Employment status changed', actor);
  end if;
  update public.employees set updated_at = now() where id = new.id;
  return new;
end;
$$;
drop trigger if exists record_employee_change on public.employees;
create trigger record_employee_change
  after update on public.employees
  for each row execute function public.record_employee_change();

-- ===== OFFBOARDING =====
create table if not exists public.offboardings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  exit_type text not null default 'resignation',
  reason text,
  notice_start_date date not null default current_date,
  last_working_day date,
  status text not null default 'initiated',
  exit_interview_notes text,
  final_settlement_note text,
  initiated_by uuid,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id)
);

create table if not exists public.exit_checklist_items (
  id uuid primary key default gen_random_uuid(),
  offboarding_id uuid not null references public.offboardings(id) on delete cascade,
  category text not null default 'hr',
  title text not null,
  owner text not null default 'hr',
  status text not null default 'pending',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_exit_checklist on public.exit_checklist_items(offboarding_id);

-- ===== LEAVE POLICIES / HOLIDAYS / BALANCE MOVEMENTS =====
create table if not exists public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  max_consecutive_days numeric,
  carry_forward_max numeric not null default 0,
  accrual_period text not null default 'annual',
  requires_approval boolean not null default true,
  allow_half_day boolean not null default false,
  allow_negative_balance boolean not null default false,
  min_notice_days int not null default 0,
  created_at timestamptz not null default now(),
  unique (leave_type_id)
);

create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  date date not null,
  name text not null default 'Holiday',
  optional boolean not null default false,
  unique (organization_id, date)
);

create table if not exists public.leave_balance_movements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid references public.leave_types(id) on delete cascade,
  year int,
  movement_type text not null default 'adjustment',
  amount numeric not null default 0,
  note text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_leave_bal_mov_emp on public.leave_balance_movements(employee_id, year);

alter table public.leave_requests add column if not exists is_half_day boolean not null default false;
alter table public.leave_requests add column if not exists half_day_part text;

-- Extended leave validation: holidays excluded, policy limits, half-day support
create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  computed numeric;
  bal_entitled numeric;
  bal_used numeric;
  quota numeric;
  yr integer;
  v_org uuid;
  v_max_consec numeric := 0;
  v_allow_half boolean := false;
  v_allow_neg boolean := false;
  v_req_approval boolean := true;
  v_min_notice int := 0;
begin
  if new.end_date < new.start_date then
    raise exception 'The end date cannot be before the start date';
  end if;

  -- Half-day leaves: single working day only, counted as 0.5
  if new.is_half_day then
    if new.start_date <> new.end_date then
      raise exception 'Half-day leave must be a single day';
    end if;
    computed := 0.5;
  else
    -- Inclusive working days excluding weekends and company holidays
    select organization_id into v_org from public.employees where id = new.employee_id;
    select count(*) into computed
      from generate_series(new.start_date, new.end_date, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.company_holidays h
         where h.date = d::date and h.organization_id = v_org
       );
  end if;
  if computed = 0 then
    raise exception 'The selected dates contain no working days';
  end if;
  new.days := computed;

  select coalesce(max_consecutive_days, 0), coalesce(allow_half_day,false),
         coalesce(allow_negative_balance,false), coalesce(requires_approval,true),
         coalesce(min_notice_days,0)
    into v_max_consec, v_allow_half, v_allow_neg, v_req_approval, v_min_notice
    from public.leave_policies where leave_type_id = new.leave_type_id;

  if new.is_half_day and v_allow_half = false then
    raise exception 'Half-day leave is not allowed for this leave type';
  end if;
  if v_max_consec > 0 and (new.end_date - new.start_date + 1) > v_max_consec then
    raise exception 'This leave type allows at most % consecutive day(s)', v_max_consec;
  end if;
  if v_min_notice > 0 and not public.has_role(auth.uid(), 'hr_admin')
     and new.start_date < (current_date + v_min_notice) then
    raise exception 'This leave type requires at least % day(s) notice', v_min_notice;
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.leave_requests r
      where r.employee_id = new.employee_id
        and r.status in ('pending','approved')
        and r.start_date <= new.end_date
        and r.end_date >= new.start_date
    ) then
      raise exception 'You already have a leave request covering these dates';
    end if;

    if v_req_approval and new.status = 'approved' and not public.has_role(auth.uid(), 'super_admin') then
      raise exception 'This leave type requires approval';
    end if;

    yr := extract(year from new.start_date)::int;
    select annual_quota into quota from public.leave_types where id = new.leave_type_id;
    select entitled, used into bal_entitled, bal_used
      from public.leave_balances
     where employee_id = new.employee_id and leave_type_id = new.leave_type_id and year = yr;
    bal_entitled := coalesce(bal_entitled, quota, 0);
    bal_used := coalesce(bal_used, 0);
    if bal_entitled > 0 and (bal_used + computed) > bal_entitled and v_allow_neg = false then
      raise exception 'Insufficient leave balance: % day(s) remaining', bal_entitled - bal_used;
    end if;

    insert into public.leave_balance_movements
      (employee_id, leave_type_id, year, movement_type, amount, note, actor_id)
    values (new.employee_id, new.leave_type_id, yr, 'spent', computed, 'Leave requested', auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists validate_leave_request on public.leave_requests;
create trigger validate_leave_request before insert or update of start_date, end_date, is_half_day on public.leave_requests
  for each row execute function public.validate_leave_request();

-- ===== HELPDESK SLA / HISTORY / INTERNAL NOTES / ATTACHMENTS =====
alter table public.helpdesk_tickets add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.helpdesk_tickets add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.helpdesk_tickets add column if not exists sla_due_at timestamptz;
alter table public.helpdesk_tickets add column if not exists resolved_at timestamptz;
alter table public.helpdesk_tickets add column if not exists escalated_at timestamptz;
alter table public.helpdesk_tickets add column if not exists escalation_level int not null default 0;
alter table public.helpdesk_tickets add column if not exists resolution_summary text;

create table if not exists public.ticket_status_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_hist on public.ticket_status_history(ticket_id);

create table if not exists public.ticket_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  author_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_notes on public.ticket_internal_notes(ticket_id);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  name text not null,
  file_path text not null,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_att on public.ticket_attachments(ticket_id);

-- SLA deadline assigned by priority
create or replace function public.set_ticket_sla()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare v_hours int;
begin
  v_hours := case new.priority
               when 'critical' then 4
               when 'high' then 8
               when 'medium' then 24
               else 72
             end;
  if tg_op = 'INSERT' then
    new.sla_due_at := now() + (v_hours || ' hours')::interval;
  elsif new.priority is distinct from old.priority then
    new.sla_due_at := now() + (v_hours || ' hours')::interval;
  end if;
  return new;
end;
$$;
drop trigger if exists set_ticket_sla on public.helpdesk_tickets;
create trigger set_ticket_sla before insert or update of priority on public.helpdesk_tickets
  for each row execute function public.set_ticket_sla();

-- Status history + resolved_at bookkeeping
create or replace function public.log_ticket_status()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if new.status is distinct from old.status then
    insert into public.ticket_status_history (ticket_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
    if new.status = 'resolved' then
      new.resolved_at := coalesce(new.resolved_at, now());
    elsif old.status = 'resolved' then
      new.resolved_at := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists log_ticket_status on public.helpdesk_tickets;
create trigger log_ticket_status before update of status on public.helpdesk_tickets
  for each row execute function public.log_ticket_status();

-- ===== EXPENSES =====
create table if not exists public.expense_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  category text not null default 'travel',
  amount numeric not null default 0,
  currency text not null default 'USD',
  expense_date date not null default current_date,
  description text,
  receipt_path text,
  status text not null default 'pending',
  approver_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_expense_emp on public.expense_requests(employee_id, status);

-- ===== PROFILE CHANGE REQUESTS =====
create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  field text not null,
  current_value text,
  requested_value text not null,
  reason text,
  status text not null default 'pending',
  approver_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_profile_req_emp on public.profile_change_requests(employee_id, status);

-- ===== MANAGER HELPER =====
create or replace function public.is_manager(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = _user_id and ur.role in ('hr_admin','hr_staff','super_admin','manager')
  );
$$;

-- ===== RLS: ENABLE, GRANT, POLICIES =====
alter table public.shifts                      enable row level security;
alter table public.employee_shift_assignments  enable row level security;
alter table public.performance_cycles          enable row level security;
alter table public.attendance_corrections      enable row level security;
alter table public.document_verifications      enable row level security;
alter table public.employee_lifecycle_events   enable row level security;
alter table public.offboardings                enable row level security;
alter table public.exit_checklist_items        enable row level security;
alter table public.leave_policies              enable row level security;
alter table public.company_holidays            enable row level security;
alter table public.leave_balance_movements     enable row level security;
alter table public.ticket_status_history       enable row level security;
alter table public.ticket_internal_notes       enable row level security;
alter table public.ticket_attachments          enable row level security;
alter table public.expense_requests            enable row level security;
alter table public.profile_change_requests     enable row level security;

grant select, insert, update, delete on
  shifts, employee_shift_assignments, performance_cycles, attendance_corrections,
  document_verifications, employee_lifecycle_events, offboardings, exit_checklist_items,
  leave_policies, company_holidays, leave_balance_movements, ticket_status_history,
  ticket_internal_notes, ticket_attachments, expense_requests, profile_change_requests
to authenticated;
grant all on
  shifts, employee_shift_assignments, performance_cycles, attendance_corrections,
  document_verifications, employee_lifecycle_events, offboardings, exit_checklist_items,
  leave_policies, company_holidays, leave_balance_movements, ticket_status_history,
  ticket_internal_notes, ticket_attachments, expense_requests, profile_change_requests
to service_role;

-- Shifts
create policy "shift read"    on public.shifts for select to authenticated using (true);
create policy "shift write"   on public.shifts for all to authenticated
  using (public.has_permission(auth.uid(),'manage_shifts'))
  with check (public.has_permission(auth.uid(),'manage_shifts'));
create policy "sas read"      on public.employee_shift_assignments for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id) or public.has_permission(auth.uid(),'manage_shifts'));
create policy "sas write"     on public.employee_shift_assignments for all to authenticated
  using (public.has_permission(auth.uid(),'manage_shifts') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_shifts'));

-- Performance cycles
create policy "cyc read"      on public.performance_cycles for select to authenticated using (true);
create policy "cyc write"     on public.performance_cycles for all to authenticated
  using (public.has_permission(auth.uid(),'manage_performance'))
  with check (public.has_permission(auth.uid(),'manage_performance'));

-- Attendance corrections
create policy "acorr read"    on public.attendance_corrections for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "acorr create"  on public.attendance_corrections for insert to authenticated
  with check (employee_id = public.current_employee_id(auth.uid())
              or (public.has_permission(auth.uid(),'manage_attendance') and public.can_view_employee(auth.uid(), employee_id)));
create policy "acorr decide"  on public.attendance_corrections for update to authenticated
  using ((public.has_permission(auth.uid(),'manage_attendance') and public.can_view_employee(auth.uid(), employee_id))
         or (public.is_manager(auth.uid()) and public.can_view_employee(auth.uid(), employee_id)
             and not public.is_self_employee(auth.uid(), employee_id)))
  with check ((public.has_permission(auth.uid(),'manage_attendance') and public.can_view_employee(auth.uid(), employee_id))
              or employee_id = public.current_employee_id(auth.uid()));
create policy "acorr delete"  on public.attendance_corrections for delete to authenticated
  using (public.has_permission(auth.uid(),'manage_attendance') and public.can_view_employee(auth.uid(), employee_id));

-- Document verification trail
create policy "docverif read" on public.document_verifications for select to authenticated
  using (exists (select 1 from public.employee_documents d
                 where d.id = document_id and (d.employee_id is null or public.can_view_employee(auth.uid(), d.employee_id))));
create policy "docverif write" on public.document_verifications for all to authenticated
  using (public.has_permission(auth.uid(),'manage_documents'))
  with check (public.has_permission(auth.uid(),'manage_documents'));

-- Lifecycle events
create policy "life read"     on public.employee_lifecycle_events for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "life write"    on public.employee_lifecycle_events for all to authenticated
  using (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_employee'));

-- Offboarding
create policy "off read"      on public.offboardings for select to authenticated
  using (public.has_permission(auth.uid(),'view_offboarding') and public.can_view_employee(auth.uid(), employee_id));
create policy "off write"     on public.offboardings for all to authenticated
  using (public.has_permission(auth.uid(),'manage_offboarding') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_offboarding'));
create policy "exit read"     on public.exit_checklist_items for select to authenticated
  using (exists (select 1 from public.offboardings o where o.id = offboarding_id
                 and public.has_permission(auth.uid(),'view_offboarding') and public.can_view_employee(auth.uid(), o.employee_id)));
create policy "exit write"    on public.exit_checklist_items for all to authenticated
  using (public.has_permission(auth.uid(),'manage_offboarding'))
  with check (public.has_permission(auth.uid(),'manage_offboarding'));

-- Leave policies / holidays / balance movements
create policy "lpolicy read"  on public.leave_policies for select to authenticated using (true);
create policy "lpolicy write" on public.leave_policies for all to authenticated
  using (public.has_permission(auth.uid(),'manage_leave'))
  with check (public.has_permission(auth.uid(),'manage_leave'));
create policy "holiday read"  on public.company_holidays for select to authenticated using (true);
create policy "holiday write" on public.company_holidays for all to authenticated
  using (public.has_permission(auth.uid(),'manage_leave') or public.has_permission(auth.uid(),'manage_organization'))
  with check (public.has_permission(auth.uid(),'manage_leave') or public.has_permission(auth.uid(),'manage_organization'));
create policy "balmov read"   on public.leave_balance_movements for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "balmov write"  on public.leave_balance_movements for all to authenticated
  using (public.has_permission(auth.uid(),'manage_leave') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_leave'));

-- Helpdesk status history / internal notes / attachments
create policy "tsh read"      on public.ticket_status_history for select to authenticated
  using (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id));
create policy "tsh write"     on public.ticket_status_history for insert to authenticated
  with check (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id
                 and (public.has_permission(auth.uid(),'manage_helpdesk')
                      or t.assigned_to = public.current_employee_id(auth.uid())
                      or t.created_by = auth.uid())));
create policy "tin read"      on public.ticket_internal_notes for select to authenticated
  using (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id
                 and (public.has_permission(auth.uid(),'manage_helpdesk')
                      or t.assigned_to = public.current_employee_id(auth.uid())
                      or t.created_by = auth.uid())));
create policy "tin write"     on public.ticket_internal_notes for insert to authenticated
  with check (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id
                 and (public.has_permission(auth.uid(),'manage_helpdesk')
                      or t.assigned_to = public.current_employee_id(auth.uid())
                      or t.created_by = auth.uid())));
create policy "ta read"       on public.ticket_attachments for select to authenticated
  using (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id
                 and (public.has_permission(auth.uid(),'manage_helpdesk')
                      or t.created_by = auth.uid())));
create policy "ta write"      on public.ticket_attachments for insert to authenticated
  with check (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id
                 and (public.has_permission(auth.uid(),'manage_helpdesk')
                      or t.created_by = auth.uid())));

-- Expenses
create policy "exp read"      on public.expense_requests for select to authenticated
  using (public.can_view_employee(auth.uid(), employee_id));
create policy "exp create"    on public.expense_requests for insert to authenticated
  with check (employee_id = public.current_employee_id(auth.uid())
              or (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), employee_id)));
create policy "exp decide"    on public.expense_requests for update to authenticated
  using (employee_id = public.current_employee_id(auth.uid())
         or (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), employee_id)))
  with check (employee_id = public.current_employee_id(auth.uid())
              or (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), employee_id)));

-- Profile change requests
create policy "pcr read"      on public.profile_change_requests for select to authenticated
  using (employee_id = public.current_employee_id(auth.uid()) or public.can_view_employee(auth.uid(), employee_id));
create policy "pcr create"    on public.profile_change_requests for insert to authenticated
  with check (employee_id = public.current_employee_id(auth.uid()));
create policy "pcr decide"    on public.profile_change_requests for update to authenticated
  using (employee_id = public.current_employee_id(auth.uid())
         or (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), employee_id)))
  with check (employee_id = public.current_employee_id(auth.uid())
              or public.has_permission(auth.uid(),'manage_employee'));

-- ===== NOTIFICATIONS =====
create or replace function public.notify_user(_user_id uuid, _title text, _body text, _category text, _link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, body, category, link)
  values (_user_id, _title, _body, _category, _link);
end;
$$;

create or replace function public.notify_hr(_title text, _body text, _category text, _link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, title, body, category, link)
  select ur.user_id, _title, _body, _category, _link
  from public.user_roles ur
  where ur.role in ('super_admin','hr_admin','hr_staff');
end;
$$;

-- Shift assigned -> notify employee
create or replace function public.notify_shift_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select user_id into v_user from public.employees where id = new.employee_id;
  if v_user is not null then
    perform public.notify_user(v_user, 'Shift schedule updated',
      'Your shift assignment has been updated.', 'schedule',
      '/shifts');
  end if;
  return new;
end;
$$;
drop trigger if exists notify_shift_assignment on public.employee_shift_assignments;
create trigger notify_shift_assignment after insert or update on public.employee_shift_assignments
  for each row execute function public.notify_shift_assignment();

-- Attendance correction requested -> notify HR; decided -> notify employee
create or replace function public.notify_attendance_correction()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'INSERT' then
    perform public.notify_hr('Attendance correction requested',
      'An employee has requested an attendance correction.', 'attendance',
      '/attendance');
  elsif new.status is distinct from old.status then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Attendance correction ' || new.status,
        coalesce(new.decision_note, 'Your attendance correction was ' || new.status || '.'), 'attendance',
        '/attendance');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_attendance_correction on public.attendance_corrections;
create trigger notify_attendance_correction after insert or update on public.attendance_corrections
  for each row execute function public.notify_attendance_correction();

-- Expense requested -> notify HR; decided -> notify employee
create or replace function public.notify_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'INSERT' then
    perform public.notify_hr('Expense submitted',
      'An employee has submitted an expense request.', 'expense',
      '/expenses');
  elsif new.status is distinct from old.status then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Expense ' || new.status,
        coalesce(new.decision_note, 'Your expense request was ' || new.status || '.'), 'expense',
        '/expenses');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_expense on public.expense_requests;
create trigger notify_expense after insert or update on public.expense_requests
  for each row execute function public.notify_expense();

-- Profile change requested -> notify HR; decided -> notify employee
create or replace function public.notify_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'INSERT' then
    perform public.notify_hr('Profile change requested',
      'An employee has requested a profile change.', 'profile',
      '/admin');
  elsif new.status is distinct from old.status then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Profile change ' || new.status,
        coalesce(new.decision_note, 'Your ' || new.field || ' change was ' || new.status || '.'), 'profile',
        '/settings');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_profile_change on public.profile_change_requests;
create trigger notify_profile_change after insert or update on public.profile_change_requests
  for each row execute function public.notify_profile_change();

-- Offboarding created -> notify HR; completed -> notify employee
create or replace function public.notify_offboarding()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'INSERT' then
    perform public.notify_hr('Offboarding initiated',
      'New exit has been initiated for an employee.', 'offboarding',
      '/offboarding');
  elsif new.status is distinct from old.status and new.status in ('in_progress','completed','cancelled') then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Offboarding ' || new.status,
        'Your offboarding process status changed to ' || new.status || '.', 'offboarding',
        '/offboarding');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists notify_offboarding on public.offboardings;
create trigger notify_offboarding after insert or update on public.offboardings
  for each row execute function public.notify_offboarding();

-- Performance review submitted/finalized -> notify employee
create or replace function public.notify_performance_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.finalized_at is distinct from old.finalized_at and new.finalized_at is not null then
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is not null then
      perform public.notify_user(v_user, 'Performance review finalized',
        'Your performance review has been finalized.', 'performance',
        '/performance');
    end if;
  elsif new.self_submitted_at is distinct from old.self_submitted_at and new.self_submitted_at is not null then
    perform public.notify_hr('Self-review submitted',
      'An employee submitted their self-review.', 'performance',
      '/performance');
  end if;
  return new;
end;
$$;
drop trigger if exists notify_performance_review on public.performance_reviews;
create trigger notify_performance_review after update on public.performance_reviews
  for each row execute function public.notify_performance_review();

-- Document verified/rejected -> notify document owner
create or replace function public.notify_document_verification()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
  v_emp uuid;
  v_name text;
begin
  if new.verification_status is distinct from old.verification_status
     and new.verification_status in ('verified','rejected') then
    select employee_id, name into v_emp, v_name from public.employee_documents where id = new.id;
    select user_id into v_user from public.employees where id = v_emp;
    if v_user is not null then
      perform public.notify_user(v_user, 'Document ' || new.verification_status,
        v_name || ' was ' || new.verification_status || '.', 'documents',
        '/documents');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists notify_document_verification on public.employee_documents;
create trigger notify_document_verification after update on public.employee_documents
  for each row execute function public.notify_document_verification();