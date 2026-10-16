-- Requisition lifecycle + public job fields
alter table public.job_requisitions
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists responsibilities text,
  add column if not exists requirements text,
  add column if not exists qualifications text,
  add column if not exists work_mode text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists closed_at timestamptz;

update public.job_requisitions
   set slug = lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 6)
 where slug is null;

create unique index if not exists idx_job_slug on public.job_requisitions(slug);
create index if not exists idx_job_status on public.job_requisitions(status);

-- Candidate extras
alter table public.candidates
  add column if not exists location text,
  add column if not exists resume_path text,
  add column if not exists notice_period text,
  add column if not exists expected_salary text,
  add column if not exists parsed_resume jsonb;

create unique index if not exists idx_candidate_email_org on public.candidates(organization_id, lower(email)) where email is not null;

-- Applications
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  requisition_id uuid not null references public.job_requisitions(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  stage text not null default 'applied',
  status text not null default 'active',
  cover_letter text,
  resume_path text,
  answers jsonb,
  source text default 'careers_site',
  consent boolean not null default false,
  ai_screening jsonb,
  match_score integer,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_application_unique on public.applications(requisition_id, candidate_id);
create index if not exists idx_application_req on public.applications(requisition_id);
grant select, insert, update on public.applications to authenticated;
grant all on public.applications to service_role;
alter table public.applications enable row level security;
create policy "app read" on public.applications for select
  using (public.has_permission(auth.uid(),'view_recruitment') and public.in_my_org(auth.uid(), organization_id));
create policy "app write" on public.applications for all
  using (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id))
  with check (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id));

-- Interviews
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  application_id uuid not null references public.applications(id) on delete cascade,
  round text not null default 'screening',
  interview_type text not null default 'video',
  scheduled_at timestamptz,
  duration_minutes integer default 45,
  meeting_link text,
  location text,
  status text not null default 'scheduled',
  outcome text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_interview_app on public.interviews(application_id);
grant select, insert, update on public.interviews to authenticated;
grant all on public.interviews to service_role;
alter table public.interviews enable row level security;
create policy "iv read" on public.interviews for select
  using (public.has_permission(auth.uid(),'view_recruitment') and public.in_my_org(auth.uid(), organization_id));
create policy "iv write" on public.interviews for all
  using (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id))
  with check (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id));

create table if not exists public.interview_panel (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text default 'interviewer'
);
create unique index if not exists idx_panel_unique on public.interview_panel(interview_id, employee_id);
grant select, insert, delete on public.interview_panel to authenticated;
grant all on public.interview_panel to service_role;
alter table public.interview_panel enable row level security;
create policy "panel read" on public.interview_panel for select
  using (public.has_permission(auth.uid(),'view_recruitment') or public.is_self_employee(auth.uid(), employee_id));
create policy "panel write" on public.interview_panel for all
  using (public.has_permission(auth.uid(),'manage_recruitment'))
  with check (public.has_permission(auth.uid(),'manage_recruitment'));

create table if not exists public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  reviewer_id uuid references public.employees(id),
  rating numeric,
  recommendation text,
  strengths text,
  concerns text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_feedback_unique on public.interview_feedback(interview_id, reviewer_id);
grant select, insert, update on public.interview_feedback to authenticated;
grant all on public.interview_feedback to service_role;
alter table public.interview_feedback enable row level security;
create policy "fb read" on public.interview_feedback for select
  using (public.has_permission(auth.uid(),'view_recruitment') or public.is_self_employee(auth.uid(), reviewer_id));
create policy "fb write" on public.interview_feedback for all
  using (public.is_self_employee(auth.uid(), reviewer_id) or public.has_permission(auth.uid(),'manage_recruitment'))
  with check (public.is_self_employee(auth.uid(), reviewer_id) or public.has_permission(auth.uid(),'manage_recruitment'));

-- Offers
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  application_id uuid not null references public.applications(id) on delete cascade,
  designation text,
  department_id uuid references public.departments(id),
  location_id uuid references public.locations(id),
  employment_type text not null default 'full_time',
  annual_ctc numeric,
  currency text default 'INR',
  start_date date,
  expires_on date,
  status text not null default 'draft',
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  responded_at timestamptz,
  response_note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_offer_app on public.offers(application_id);
grant select, insert, update on public.offers to authenticated;
grant all on public.offers to service_role;
alter table public.offers enable row level security;
create policy "offer read" on public.offers for select
  using (public.has_permission(auth.uid(),'view_recruitment') and public.in_my_org(auth.uid(), organization_id));
create policy "offer write" on public.offers for all
  using (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id))
  with check (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id));

-- Public, read-only job access for anonymous visitors (published jobs only, safe columns)
create or replace function public.public_job_list()
returns table(slug text, title text, department text, location text, city text, country text,
              employment_type text, work_mode text, experience_min integer, experience_max integer,
              skills text[], description text, published_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select j.slug, j.title, d.name, l.name, l.city, l.country,
         j.employment_type, j.work_mode, j.experience_min, j.experience_max,
         j.skills, left(coalesce(j.description,''), 400), j.published_at
  from public.job_requisitions j
  left join public.departments d on d.id = j.department_id
  left join public.locations l on l.id = j.location_id
  where j.status = 'published'
  order by j.published_at desc nulls last, j.created_at desc;
$$;

create or replace function public.public_job_detail(_slug text)
returns table(slug text, title text, department text, location text, city text, country text,
              employment_type text, work_mode text, experience_min integer, experience_max integer,
              skills text[], description text, responsibilities text, requirements text,
              qualifications text, openings integer, published_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select j.slug, j.title, d.name, l.name, l.city, l.country,
         j.employment_type, j.work_mode, j.experience_min, j.experience_max,
         j.skills, j.description, j.responsibilities, j.requirements,
         j.qualifications, j.openings, j.published_at
  from public.job_requisitions j
  left join public.departments d on d.id = j.department_id
  left join public.locations l on l.id = j.location_id
  where j.status = 'published' and j.slug = _slug;
$$;

grant execute on function public.public_job_list() to anon, authenticated;
grant execute on function public.public_job_detail(text) to anon, authenticated;

-- Recruitment notifications from real events
create or replace function public.notify_application_event()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  hm_user uuid;
  cand_name text;
  job_title text;
begin
  select c.full_name into cand_name from public.candidates c where c.id = new.candidate_id;
  select j.title, e.user_id into job_title, hm_user
    from public.job_requisitions j
    left join public.employees e on e.id = j.hiring_manager_id
   where j.id = new.requisition_id;

  if tg_op = 'INSERT' then
    if hm_user is not null then
      insert into public.notifications (user_id, title, body, category, link)
      values (hm_user, 'New application received',
              coalesce(cand_name,'A candidate') || ' applied for ' || coalesce(job_title,'a role'),
              'recruitment', '/recruitment');
    end if;
  elsif new.stage is distinct from old.stage and hm_user is not null then
    insert into public.notifications (user_id, title, body, category, link)
    values (hm_user, 'Candidate moved to ' || new.stage,
            coalesce(cand_name,'A candidate') || ' — ' || coalesce(job_title,'role'),
            'recruitment', '/recruitment');
  end if;
  return new;
end;
$$;
drop trigger if exists notify_application_insert on public.applications;
create trigger notify_application_insert after insert on public.applications
  for each row execute function public.notify_application_event();
drop trigger if exists notify_application_stage on public.applications;
create trigger notify_application_stage after update on public.applications
  for each row execute function public.notify_application_event();