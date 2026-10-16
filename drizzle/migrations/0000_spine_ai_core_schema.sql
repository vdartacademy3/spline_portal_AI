
-- ===== ENUMS =====
create type public.app_role as enum ('super_admin','hr_admin','hr_staff','manager','employee');
create type public.data_scope as enum ('SELF','DIRECT_REPORTS','DEPARTMENT','LOCATION','LEGAL_ENTITY','ORGANIZATION','GLOBAL');

-- ===== ORG STRUCTURE =====
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  industry text,
  timezone text default 'UTC',
  currency text default 'USD',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  registration_number text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  name text not null,
  address text,
  city text,
  country text,
  timezone text default 'UTC',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ===== USERS / ROLES =====
create table public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  avatar_url text,
  last_login timestamptz,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  scope public.data_scope not null default 'SELF',
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- ===== EMPLOYEES =====
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  user_id uuid,
  first_name text not null,
  last_name text not null,
  profile_photo text,
  work_email text,
  phone text,
  date_of_birth date,
  gender text,
  joining_date date not null default current_date,
  employment_type text not null default 'full_time',
  employment_status text not null default 'active',
  designation text,
  organization_id uuid references public.organizations(id) on delete set null,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  probation_end_date date,
  emergency_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.departments add column department_head_id uuid references public.employees(id) on delete set null;

-- ===== ATTENDANCE =====
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'present',
  late_minutes int not null default 0,
  overtime_minutes int not null default 0,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ===== LEAVE =====
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  annual_quota numeric not null default 0,
  paid boolean not null default true
);

create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year int not null default extract(year from now()),
  entitled numeric not null default 0,
  used numeric not null default 0,
  unique (employee_id, leave_type_id, year)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  days numeric not null default 1,
  reason text,
  status text not null default 'pending',
  approver_id uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

-- ===== PERFORMANCE =====
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  progress int not null default 0,
  status text not null default 'in_progress',
  created_at timestamptz not null default now()
);

create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  reviewer_id uuid references public.employees(id) on delete set null,
  period text not null,
  rating numeric,
  strengths text,
  improvements text,
  summary text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- ===== DOCUMENTS =====
create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  name text not null,
  category text not null default 'other',
  file_url text,
  expiry_date date,
  verification_status text not null default 'pending',
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  title text not null,
  body text not null,
  employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ===== RECRUITMENT =====
create table public.job_requisitions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department_id uuid references public.departments(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  employment_type text not null default 'full_time',
  experience_min int default 0,
  experience_max int,
  skills text[] default '{}',
  salary_min numeric,
  salary_max numeric,
  hiring_manager_id uuid references public.employees(id) on delete set null,
  openings int not null default 1,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.job_requisitions(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  resume_url text,
  skills text[] default '{}',
  experience_years numeric default 0,
  education text,
  source text,
  stage text not null default 'applied',
  match_score int,
  ai_analysis jsonb,
  applied_at timestamptz not null default now()
);

-- ===== ONBOARDING =====
create table public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  title text not null,
  owner text,
  due_date date,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- ===== HELPDESK =====
create table public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null default concat('HD-', to_char(now(),'YYMM'), '-', substr(gen_random_uuid()::text,1,4)),
  employee_id uuid references public.employees(id) on delete set null,
  created_by uuid,
  category text not null default 'general',
  subject text not null,
  description text,
  priority text not null default 'medium',
  status text not null default 'open',
  assigned_to uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  author_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);

-- ===== KNOWLEDGE BASE =====
create table public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'policy',
  content text not null,
  version text default 'v1',
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index int not null default 0,
  heading text,
  content text not null
);

-- ===== AI =====
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null,
  content text not null,
  payload jsonb,
  sources jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  title text not null,
  reason text,
  target_summary text,
  proposed_payload jsonb,
  risk_level text not null default 'low',
  status text not null default 'pending',
  requested_by uuid,
  approved_by uuid,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  severity text not null default 'info',
  recommended_action text,
  link text,
  created_at timestamptz not null default now()
);

-- ===== NOTIFICATIONS / AUDIT =====
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  body text,
  category text not null default 'general',
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  entity text,
  entity_id text,
  previous_value jsonb,
  new_value jsonb,
  status text not null default 'success',
  created_at timestamptz not null default now()
);

-- ===== HELPER FUNCTIONS =====
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.is_hr(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id
    and role in ('super_admin','hr_admin','hr_staff'));
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id
    and role in ('super_admin','hr_admin'));
$$;

create or replace function public.current_employee_id(_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = _user_id limit 1;
$$;

create or replace function public.can_view_employee(_user_id uuid, _employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hr(_user_id)
    or exists (
      select 1 from public.employees e
      where e.id = _employee_id
        and (e.user_id = _user_id or e.manager_id = public.current_employee_id(_user_id))
    );
$$;

-- profile bootstrap
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role, scope)
  values (new.id, 'employee', 'SELF')
  on conflict do nothing;
  update public.employees set user_id = new.id where lower(work_email) = lower(new.email) and user_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== GRANTS =====
grant select on public.organizations, public.legal_entities, public.locations, public.departments,
  public.leave_types, public.kb_documents, public.kb_chunks, public.ai_insights to authenticated;
grant select, insert, update, delete on
  public.organizations, public.legal_entities, public.locations, public.departments,
  public.profiles, public.user_roles, public.employees, public.attendance_records,
  public.leave_types, public.leave_balances, public.leave_requests, public.goals,
  public.performance_reviews, public.employee_documents, public.generated_documents,
  public.job_requisitions, public.candidates, public.onboarding_tasks,
  public.helpdesk_tickets, public.ticket_comments, public.kb_documents, public.kb_chunks,
  public.ai_conversations, public.ai_messages, public.ai_actions, public.ai_insights,
  public.notifications, public.audit_logs to authenticated;
grant all on
  public.organizations, public.legal_entities, public.locations, public.departments,
  public.profiles, public.user_roles, public.employees, public.attendance_records,
  public.leave_types, public.leave_balances, public.leave_requests, public.goals,
  public.performance_reviews, public.employee_documents, public.generated_documents,
  public.job_requisitions, public.candidates, public.onboarding_tasks,
  public.helpdesk_tickets, public.ticket_comments, public.kb_documents, public.kb_chunks,
  public.ai_conversations, public.ai_messages, public.ai_actions, public.ai_insights,
  public.notifications, public.audit_logs to service_role;

-- ===== RLS =====
alter table public.organizations enable row level security;
alter table public.legal_entities enable row level security;
alter table public.locations enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.goals enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.employee_documents enable row level security;
alter table public.generated_documents enable row level security;
alter table public.job_requisitions enable row level security;
alter table public.candidates enable row level security;
alter table public.onboarding_tasks enable row level security;
alter table public.helpdesk_tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_actions enable row level security;
alter table public.ai_insights enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- org structure: readable by all signed-in, writable by admins
create policy "org read" on public.organizations for select to authenticated using (true);
create policy "org write" on public.organizations for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "le read" on public.legal_entities for select to authenticated using (true);
create policy "le write" on public.legal_entities for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "loc read" on public.locations for select to authenticated using (true);
create policy "loc write" on public.locations for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "dept read" on public.departments for select to authenticated using (true);
create policy "dept write" on public.departments for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "profile self read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_hr(auth.uid()));
create policy "profile self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "roles self read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_hr(auth.uid()));
create policy "roles admin write" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'super_admin')) with check (public.has_role(auth.uid(),'super_admin'));

create policy "emp scoped read" on public.employees for select to authenticated using (public.can_view_employee(auth.uid(), id));
create policy "emp hr write" on public.employees for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "att scoped read" on public.attendance_records for select to authenticated using (public.can_view_employee(auth.uid(), employee_id));
create policy "att hr write" on public.attendance_records for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "lt read" on public.leave_types for select to authenticated using (true);
create policy "lt write" on public.leave_types for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "lb scoped read" on public.leave_balances for select to authenticated using (public.can_view_employee(auth.uid(), employee_id));
create policy "lb hr write" on public.leave_balances for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "lr scoped read" on public.leave_requests for select to authenticated using (public.can_view_employee(auth.uid(), employee_id));
create policy "lr self create" on public.leave_requests for insert to authenticated with check (employee_id = public.current_employee_id(auth.uid()) or public.is_hr(auth.uid()));
create policy "lr approve" on public.leave_requests for update to authenticated using (public.is_hr(auth.uid()) or public.can_view_employee(auth.uid(), employee_id)) with check (public.is_hr(auth.uid()) or public.can_view_employee(auth.uid(), employee_id));

create policy "goal scoped read" on public.goals for select to authenticated using (public.can_view_employee(auth.uid(), employee_id));
create policy "goal write" on public.goals for all to authenticated using (public.is_hr(auth.uid()) or public.can_view_employee(auth.uid(), employee_id)) with check (public.is_hr(auth.uid()) or public.can_view_employee(auth.uid(), employee_id));

create policy "review scoped read" on public.performance_reviews for select to authenticated using (public.can_view_employee(auth.uid(), employee_id));
create policy "review write" on public.performance_reviews for all to authenticated using (public.is_hr(auth.uid()) or public.can_view_employee(auth.uid(), employee_id)) with check (public.is_hr(auth.uid()) or public.can_view_employee(auth.uid(), employee_id));

create policy "docs scoped read" on public.employee_documents for select to authenticated using (employee_id is null or public.can_view_employee(auth.uid(), employee_id));
create policy "docs hr write" on public.employee_documents for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "gendoc hr" on public.generated_documents for all to authenticated using (public.is_hr(auth.uid()) or created_by = auth.uid()) with check (public.is_hr(auth.uid()) or created_by = auth.uid());

create policy "job read" on public.job_requisitions for select to authenticated using (true);
create policy "job hr write" on public.job_requisitions for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "cand hr read" on public.candidates for select to authenticated using (public.is_hr(auth.uid()));
create policy "cand hr write" on public.candidates for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "onb scoped read" on public.onboarding_tasks for select to authenticated using (public.is_hr(auth.uid()) or (employee_id is not null and public.can_view_employee(auth.uid(), employee_id)));
create policy "onb hr write" on public.onboarding_tasks for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "ticket read" on public.helpdesk_tickets for select to authenticated using (public.is_hr(auth.uid()) or created_by = auth.uid() or (employee_id is not null and public.can_view_employee(auth.uid(), employee_id)));
create policy "ticket create" on public.helpdesk_tickets for insert to authenticated with check (created_by = auth.uid() or public.is_hr(auth.uid()));
create policy "ticket update" on public.helpdesk_tickets for update to authenticated using (public.is_hr(auth.uid()) or created_by = auth.uid()) with check (public.is_hr(auth.uid()) or created_by = auth.uid());

create policy "tc read" on public.ticket_comments for select to authenticated using (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id and (public.is_hr(auth.uid()) or t.created_by = auth.uid())));
create policy "tc write" on public.ticket_comments for insert to authenticated with check (author_id = auth.uid());

create policy "kb read" on public.kb_documents for select to authenticated using (status = 'published' or public.is_hr(auth.uid()));
create policy "kb write" on public.kb_documents for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));
create policy "kbc read" on public.kb_chunks for select to authenticated using (true);
create policy "kbc write" on public.kb_chunks for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "conv own" on public.ai_conversations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "msg own" on public.ai_messages for all to authenticated using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())) with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

create policy "aiaction read" on public.ai_actions for select to authenticated using (public.is_hr(auth.uid()) or requested_by = auth.uid());
create policy "aiaction create" on public.ai_actions for insert to authenticated with check (requested_by = auth.uid());
create policy "aiaction update" on public.ai_actions for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "insight read" on public.ai_insights for select to authenticated using (public.is_hr(auth.uid()) or public.has_role(auth.uid(),'manager'));
create policy "insight write" on public.ai_insights for all to authenticated using (public.is_hr(auth.uid())) with check (public.is_hr(auth.uid()));

create policy "notif own" on public.notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "audit read" on public.audit_logs for select to authenticated using (public.is_admin(auth.uid()));
create policy "audit insert" on public.audit_logs for insert to authenticated with check (user_id = auth.uid());
