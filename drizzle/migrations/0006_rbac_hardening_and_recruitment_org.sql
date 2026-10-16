-- 1. Organization equality for the ORGANIZATION data scope
create or replace function public.can_view_employee(_user_id uuid, _employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from public.employees e
    left join public.employees me on me.id = public.current_employee_id(_user_id)
    where e.id = _employee_id
      and (
        e.user_id = _user_id
        or public.has_role(_user_id, 'super_admin')
        or (
          public.has_permission(_user_id, 'view_employee')
          and (
            public.user_scope(_user_id) = 'GLOBAL'
            or (public.user_scope(_user_id) = 'ORGANIZATION'
                and me.organization_id is not null and e.organization_id = me.organization_id)
            or (public.user_scope(_user_id) = 'LEGAL_ENTITY'
                and me.legal_entity_id is not null and e.legal_entity_id = me.legal_entity_id)
            or (public.user_scope(_user_id) = 'LOCATION'
                and me.location_id is not null and e.location_id = me.location_id)
            or (public.user_scope(_user_id) = 'DEPARTMENT'
                and me.department_id is not null and e.department_id = me.department_id)
            or (public.user_scope(_user_id) = 'DIRECT_REPORTS'
                and me.id is not null and e.id in (select r.id from public.reports_of(me.id) r))
          )
        )
      )
  );
$$;

-- 2. Scope check for proposed employee attribute values (used by UPDATE/INSERT WITH CHECK)
create or replace function public.can_place_employee(
  _user_id uuid, _organization_id uuid, _legal_entity_id uuid, _location_id uuid, _department_id uuid
) returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.has_role(_user_id,'super_admin')
    or (
      public.has_permission(_user_id,'manage_employee')
      and exists (
        select 1 from (select public.user_scope(_user_id) as s) sc
        left join public.employees me on me.id = public.current_employee_id(_user_id)
        where sc.s = 'GLOBAL'
           or (sc.s = 'ORGANIZATION' and me.organization_id is not null and _organization_id = me.organization_id)
           or (sc.s = 'LEGAL_ENTITY' and me.legal_entity_id is not null and _legal_entity_id = me.legal_entity_id)
           or (sc.s = 'LOCATION' and me.location_id is not null and _location_id = me.location_id)
           or (sc.s = 'DEPARTMENT' and me.department_id is not null and _department_id = me.department_id)
      )
    );
$$;

drop policy if exists "emp update" on public.employees;
create policy "emp update" on public.employees for update
  using (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), id))
  with check (public.can_place_employee(auth.uid(), organization_id, legal_entity_id, location_id, department_id));

drop policy if exists "emp insert" on public.employees;
create policy "emp insert" on public.employees for insert
  with check (public.can_place_employee(auth.uid(), organization_id, legal_entity_id, location_id, department_id));

-- 3. Helpdesk comments: only participants or authorised helpdesk staff
drop policy if exists "tc read" on public.ticket_comments;
create policy "tc read" on public.ticket_comments for select
  using (exists (
    select 1 from public.helpdesk_tickets t
    where t.id = ticket_comments.ticket_id
      and (
        t.created_by = auth.uid()
        or public.is_self_employee(auth.uid(), t.employee_id)
        or public.is_self_employee(auth.uid(), t.assigned_to)
        or public.has_permission(auth.uid(), 'manage_helpdesk')
      )
  ));

drop policy if exists "tc write" on public.ticket_comments;
create policy "tc write" on public.ticket_comments for insert
  with check (author_id = auth.uid() and exists (
    select 1 from public.helpdesk_tickets t
    where t.id = ticket_comments.ticket_id
      and (
        t.created_by = auth.uid()
        or public.is_self_employee(auth.uid(), t.employee_id)
        or public.is_self_employee(auth.uid(), t.assigned_to)
        or public.has_permission(auth.uid(), 'manage_helpdesk')
      )
  ));

-- 4. Recruitment gains organization ownership
alter table public.job_requisitions add column if not exists organization_id uuid references public.organizations(id);
alter table public.candidates add column if not exists organization_id uuid references public.organizations(id);

update public.job_requisitions j
   set organization_id = coalesce(
        (select d.organization_id from public.departments d where d.id = j.department_id),
        (select l.organization_id from public.locations l where l.id = j.location_id),
        (select o.id from public.organizations o order by o.created_at limit 1))
 where j.organization_id is null;

update public.candidates c
   set organization_id = coalesce(
        (select j.organization_id from public.job_requisitions j where j.id = c.job_id),
        (select o.id from public.organizations o order by o.created_at limit 1))
 where c.organization_id is null;

create or replace function public.current_organization_id(_user_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select organization_id from public.employees where user_id = _user_id limit 1;
$$;

create or replace function public.in_my_org(_user_id uuid, _organization_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.has_role(_user_id,'super_admin')
      or public.user_scope(_user_id) = 'GLOBAL'
      or (_organization_id is not null and _organization_id = public.current_organization_id(_user_id));
$$;

drop policy if exists "job read" on public.job_requisitions;
create policy "job read" on public.job_requisitions for select
  using (public.has_permission(auth.uid(),'view_recruitment') and public.in_my_org(auth.uid(), organization_id));
drop policy if exists "job write" on public.job_requisitions;
create policy "job write" on public.job_requisitions for all
  using (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id))
  with check (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id));

drop policy if exists "cand read" on public.candidates;
create policy "cand read" on public.candidates for select
  using (public.has_permission(auth.uid(),'view_recruitment') and public.in_my_org(auth.uid(), organization_id));
drop policy if exists "cand write" on public.candidates;
create policy "cand write" on public.candidates for all
  using (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id))
  with check (public.has_permission(auth.uid(),'manage_recruitment') and public.in_my_org(auth.uid(), organization_id));

-- 5. Audit logs cannot be forged: the actor is always the caller
create or replace function public.stamp_audit_actor()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists stamp_audit_actor on public.audit_logs;
create trigger stamp_audit_actor before insert on public.audit_logs
  for each row execute function public.stamp_audit_actor();

-- 6. Indexes behind the authorization predicates
create index if not exists idx_employees_manager on public.employees(manager_id);
create index if not exists idx_employees_user on public.employees(user_id);
create index if not exists idx_employees_org on public.employees(organization_id);
create index if not exists idx_employees_department on public.employees(department_id);
create index if not exists idx_employees_location on public.employees(location_id);
create index if not exists idx_user_roles_user on public.user_roles(user_id);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_leave_requests_employee on public.leave_requests(employee_id);
create index if not exists idx_attendance_employee_date on public.attendance_records(employee_id, work_date desc);
create index if not exists idx_candidates_job on public.candidates(job_id);
create index if not exists idx_ticket_comments_ticket on public.ticket_comments(ticket_id);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);