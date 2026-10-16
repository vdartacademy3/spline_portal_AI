create or replace function public.validate_leave_request()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  computed numeric;
  bal_entitled numeric;
  bal_used numeric;
  quota numeric;
  yr integer;
begin
  if new.end_date < new.start_date then
    raise exception 'The end date cannot be before the start date';
  end if;

  -- Server-side day count: inclusive calendar days excluding Saturday and Sunday
  select count(*) into computed
    from generate_series(new.start_date, new.end_date, interval '1 day') d
   where extract(isodow from d) < 6;
  if computed = 0 then
    raise exception 'The selected dates contain no working days';
  end if;
  new.days := computed;

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

    yr := extract(year from new.start_date)::int;
    select annual_quota into quota from public.leave_types where id = new.leave_type_id;
    select entitled, used into bal_entitled, bal_used
      from public.leave_balances
     where employee_id = new.employee_id and leave_type_id = new.leave_type_id and year = yr;
    bal_entitled := coalesce(bal_entitled, quota, 0);
    bal_used := coalesce(bal_used, 0);
    if bal_entitled > 0 and (bal_used + computed) > bal_entitled then
      raise exception 'Insufficient leave balance: % day(s) remaining', bal_entitled - bal_used;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_leave_request on public.leave_requests;
create trigger validate_leave_request before insert or update of start_date, end_date on public.leave_requests
  for each row execute function public.validate_leave_request();

-- Reversal must use the days recorded on the request being reversed
create or replace function public.sync_leave_balance()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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
         set used = greatest(used - old.days, 0)
       where employee_id = new.employee_id
         and leave_type_id = new.leave_type_id
         and year = yr;
    end if;
  end if;
  return new;
end;
$$;