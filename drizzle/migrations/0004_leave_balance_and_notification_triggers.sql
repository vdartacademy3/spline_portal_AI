-- Keep leave balances in step with approvals, and notify people about real events.
create or replace function public.sync_leave_balance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  yr integer := extract(year from new.start_date)::int;
  quota numeric;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      select annual_quota into quota from public.leave_types where id = new.leave_type_id;
      insert into public.leave_balances (employee_id, leave_type_id, year, entitled, used)
      values (new.employee_id, new.leave_type_id, yr, coalesce(quota, 0), new.days)
      on conflict (employee_id, leave_type_id, year)
      do update set used = public.leave_balances.used + new.days;
    elsif old.status = 'approved' then
      update public.leave_balances
         set used = greatest(used - new.days, 0)
       where employee_id = new.employee_id
         and leave_type_id = new.leave_type_id
         and year = yr;
    end if;
  end if;
  return new;
end;
$$;

-- A unique key is required for the balance upsert above.
create unique index if not exists leave_balances_unique_key
  on public.leave_balances (employee_id, leave_type_id, year);

drop trigger if exists sync_leave_balance on public.leave_requests;
create trigger sync_leave_balance after update on public.leave_requests
for each row execute function public.sync_leave_balance();

create or replace function public.notify_leave_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requester_user uuid;
  manager_user uuid;
  requester_name text;
begin
  select e.user_id, e.first_name || ' ' || e.last_name into requester_user, requester_name
    from public.employees e where e.id = new.employee_id;

  if tg_op = 'INSERT' then
    select m.user_id into manager_user
      from public.employees e join public.employees m on m.id = e.manager_id
     where e.id = new.employee_id;
    if manager_user is not null then
      insert into public.notifications (user_id, title, body, category, link)
      values (manager_user,
              'Leave request awaiting your decision',
              coalesce(requester_name, 'An employee') || ' requested leave from ' || new.start_date || ' to ' || new.end_date,
              'leave', '/leave');
    end if;
  elsif new.status is distinct from old.status and requester_user is not null then
    insert into public.notifications (user_id, title, body, category, link)
    values (requester_user,
            'Your leave request was ' || new.status,
            'Dates ' || new.start_date || ' to ' || new.end_date ||
            coalesce(' — ' || new.decision_note, ''),
            'leave', '/leave');
  end if;
  return new;
end;
$$;

drop trigger if exists notify_leave_insert on public.leave_requests;
create trigger notify_leave_insert after insert on public.leave_requests
for each row execute function public.notify_leave_event();

drop trigger if exists notify_leave_decision on public.leave_requests;
create trigger notify_leave_decision after update on public.leave_requests
for each row execute function public.notify_leave_event();

create or replace function public.notify_ticket_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assignee_user uuid;
begin
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then
    select user_id into assignee_user from public.employees where id = new.assigned_to;
    if assignee_user is not null then
      insert into public.notifications (user_id, title, body, category, link)
      values (assignee_user, 'A helpdesk ticket was assigned to you',
              new.ticket_code || ': ' || new.subject, 'helpdesk', '/helpdesk');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_ticket_assignment on public.helpdesk_tickets;
create trigger notify_ticket_assignment after update on public.helpdesk_tickets
for each row execute function public.notify_ticket_assignment();

create or replace function public.notify_onboarding_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_user uuid;
begin
  if new.employee_id is not null then
    select user_id into target_user from public.employees where id = new.employee_id;
    if target_user is not null then
      insert into public.notifications (user_id, title, body, category, link)
      values (target_user, 'New onboarding task', new.title, 'onboarding', '/onboarding');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_onboarding_assignment on public.onboarding_tasks;
create trigger notify_onboarding_assignment after insert on public.onboarding_tasks
for each row execute function public.notify_onboarding_assignment();