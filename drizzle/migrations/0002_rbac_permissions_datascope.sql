-- ===== PERMISSION CATALOGUE =====
create table if not exists public.permissions (
  code text primary key,
  label text not null,
  category text not null default 'general',
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role public.app_role not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role, permission_code)
);

grant select on public.permissions to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant all on public.permissions, public.role_permissions to service_role;

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- account status for disable / reactivate
alter table public.profiles add column if not exists status text not null default 'active';

-- ===== SCOPE / PERMISSION FUNCTIONS =====
create or replace function public.user_scope(_user_id uuid)
returns public.data_scope language sql stable security definer set search_path = public as $$
  select coalesce((
    select ur.scope from public.user_roles ur
    where ur.user_id = _user_id
    order by case ur.scope
      when 'GLOBAL' then 7 when 'ORGANIZATION' then 6 when 'LEGAL_ENTITY' then 5
      when 'LOCATION' then 4 when 'DEPARTMENT' then 3 when 'DIRECT_REPORTS' then 2 else 1 end desc
    limit 1
  ), 'SELF'::public.data_scope);
$$;

create or replace function public.has_permission(_user_id uuid, _code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = _user_id and ur.role = 'super_admin')
      or exists (
        select 1 from public.user_roles ur
        join public.role_permissions rp on rp.role = ur.role
        where ur.user_id = _user_id and rp.permission_code = _code
      );
$$;

create or replace function public.reports_of(_manager_employee_id uuid)
returns table (id uuid) language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select e.id from public.employees e where e.manager_id = _manager_employee_id
    union
    select c.id from public.employees c join tree t on c.manager_id = t.id
  )
  select id from tree;
$$;

create or replace function public.can_view_employee(_user_id uuid, _employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
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
            public.user_scope(_user_id) in ('GLOBAL','ORGANIZATION')
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

create or replace function public.can_manage_employee(_user_id uuid, _employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission(_user_id, 'manage_employee')
     and public.can_view_employee(_user_id, _employee_id);
$$;

-- ===== SUPER ADMIN PROTECTION =====
create or replace function public.protect_super_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_is_super boolean;
begin
  if actor is null then
    return coalesce(new, old);
  end if;
  select public.has_role(actor, 'super_admin') into actor_is_super;
  if actor_is_super then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.role = 'super_admin' then
    raise exception 'Only a Super Admin can grant the Super Admin role';
  elsif tg_op = 'UPDATE' and (new.role = 'super_admin' or old.role = 'super_admin') then
    raise exception 'Only a Super Admin can change Super Admin access';
  elsif tg_op = 'DELETE' and old.role = 'super_admin' then
    raise exception 'Only a Super Admin can revoke the Super Admin role';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists protect_super_admin_roles on public.user_roles;
create trigger protect_super_admin_roles
  before insert or update or delete on public.user_roles
  for each row execute function public.protect_super_admin();

-- ===== POLICIES =====
create policy "perm read" on public.permissions for select to authenticated using (true);
create policy "perm super write" on public.permissions for all to authenticated
  using (public.has_role(auth.uid(),'super_admin')) with check (public.has_role(auth.uid(),'super_admin'));

create policy "roleperm read" on public.role_permissions for select to authenticated using (true);
create policy "roleperm super write" on public.role_permissions for all to authenticated
  using (public.has_role(auth.uid(),'super_admin')) with check (public.has_role(auth.uid(),'super_admin'));

-- permission-aware module policies
drop policy if exists "cand hr read" on public.candidates;
drop policy if exists "cand hr write" on public.candidates;
create policy "cand read" on public.candidates for select to authenticated
  using (public.has_permission(auth.uid(),'view_recruitment'));
create policy "cand write" on public.candidates for all to authenticated
  using (public.has_permission(auth.uid(),'manage_recruitment'))
  with check (public.has_permission(auth.uid(),'manage_recruitment'));

drop policy if exists "job read" on public.job_requisitions;
drop policy if exists "job hr write" on public.job_requisitions;
create policy "job read" on public.job_requisitions for select to authenticated
  using (public.has_permission(auth.uid(),'view_recruitment'));
create policy "job write" on public.job_requisitions for all to authenticated
  using (public.has_permission(auth.uid(),'manage_recruitment'))
  with check (public.has_permission(auth.uid(),'manage_recruitment'));

drop policy if exists "kb write" on public.kb_documents;
create policy "kb write" on public.kb_documents for all to authenticated
  using (public.has_permission(auth.uid(),'manage_knowledge'))
  with check (public.has_permission(auth.uid(),'manage_knowledge'));
drop policy if exists "kbc write" on public.kb_chunks;
create policy "kbc write" on public.kb_chunks for all to authenticated
  using (public.has_permission(auth.uid(),'manage_knowledge'))
  with check (public.has_permission(auth.uid(),'manage_knowledge'));

drop policy if exists "audit read" on public.audit_logs;
create policy "audit read" on public.audit_logs for select to authenticated
  using (public.has_permission(auth.uid(),'view_audit'));

drop policy if exists "emp hr write" on public.employees;
create policy "emp scoped write" on public.employees for all to authenticated
  using (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), id))
  with check (public.has_permission(auth.uid(),'manage_employee'));

drop policy if exists "att hr write" on public.attendance_records;
create policy "att scoped write" on public.attendance_records for all to authenticated
  using (public.has_permission(auth.uid(),'manage_attendance') and public.can_view_employee(auth.uid(), employee_id))
  with check (public.has_permission(auth.uid(),'manage_attendance') and public.can_view_employee(auth.uid(), employee_id));

drop policy if exists "org write" on public.organizations;
create policy "org write" on public.organizations for all to authenticated
  using (public.has_permission(auth.uid(),'manage_organization'))
  with check (public.has_permission(auth.uid(),'manage_organization'));
drop policy if exists "le write" on public.legal_entities;
create policy "le write" on public.legal_entities for all to authenticated
  using (public.has_permission(auth.uid(),'manage_organization'))
  with check (public.has_permission(auth.uid(),'manage_organization'));
drop policy if exists "loc write" on public.locations;
create policy "loc write" on public.locations for all to authenticated
  using (public.has_permission(auth.uid(),'manage_organization'))
  with check (public.has_permission(auth.uid(),'manage_organization'));
drop policy if exists "dept write" on public.departments;
create policy "dept write" on public.departments for all to authenticated
  using (public.has_permission(auth.uid(),'manage_organization'))
  with check (public.has_permission(auth.uid(),'manage_organization'));

drop policy if exists "roles admin write" on public.user_roles;
create policy "roles super write" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'super_admin')) with check (public.has_role(auth.uid(),'super_admin'));

drop policy if exists "profile self read" on public.profiles;
create policy "profile read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission(auth.uid(),'manage_users') or public.has_permission(auth.uid(),'view_employee'));
