-- Helper: is the target employee the caller themselves?
create or replace function public.is_self_employee(_user_id uuid, _employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _employee_id is not null and _employee_id = public.current_employee_id(_user_id);
$$;

-- ============ LEAVE REQUESTS ============
drop policy if exists "lr approve" on public.leave_requests;
create policy "lr manage" on public.leave_requests for update to authenticated
using (
  (public.has_permission(auth.uid(),'manage_leave')
   and public.can_view_employee(auth.uid(), employee_id)
   and not public.is_self_employee(auth.uid(), employee_id))
  or public.is_self_employee(auth.uid(), employee_id)
)
with check (
  (public.has_permission(auth.uid(),'manage_leave')
   and public.can_view_employee(auth.uid(), employee_id)
   and not public.is_self_employee(auth.uid(), employee_id))
  or public.is_self_employee(auth.uid(), employee_id)
);

-- An employee may only withdraw their own request, never decide it.
create or replace function public.guard_leave_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.is_self_employee(auth.uid(), new.employee_id)
     and not public.has_permission(auth.uid(),'manage_leave') then
    if new.status is distinct from old.status and new.status <> 'cancelled' then
      raise exception 'You cannot decide your own leave request';
    end if;
    new.approver_id := old.approver_id;
    new.decided_at := old.decided_at;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_leave_self_update on public.leave_requests;
create trigger guard_leave_self_update before update on public.leave_requests
for each row execute function public.guard_leave_self_update();

-- ============ LEAVE BALANCES ============
drop policy if exists "lb hr write" on public.leave_balances;
create policy "lb manage" on public.leave_balances for all to authenticated
using (public.has_permission(auth.uid(),'manage_leave') and public.can_view_employee(auth.uid(), employee_id))
with check (public.has_permission(auth.uid(),'manage_leave') and public.can_view_employee(auth.uid(), employee_id));

-- ============ PERFORMANCE REVIEWS ============
drop policy if exists "review write" on public.performance_reviews;
create policy "review manage" on public.performance_reviews for all to authenticated
using (
  public.has_permission(auth.uid(),'manage_performance')
  and public.can_view_employee(auth.uid(), employee_id)
  and not public.is_self_employee(auth.uid(), employee_id)
)
with check (
  public.has_permission(auth.uid(),'manage_performance')
  and public.can_view_employee(auth.uid(), employee_id)
  and not public.is_self_employee(auth.uid(), employee_id)
);
drop policy if exists "review scoped read" on public.performance_reviews;
create policy "review scoped read" on public.performance_reviews for select to authenticated
using (
  public.is_self_employee(auth.uid(), employee_id)
  or (public.has_permission(auth.uid(),'view_performance') and public.can_view_employee(auth.uid(), employee_id))
);

-- ============ GOALS ============
drop policy if exists "goal write" on public.goals;
create policy "goal manage" on public.goals for all to authenticated
using (
  public.is_self_employee(auth.uid(), employee_id)
  or (public.has_permission(auth.uid(),'manage_performance') and public.can_view_employee(auth.uid(), employee_id))
)
with check (
  public.is_self_employee(auth.uid(), employee_id)
  or (public.has_permission(auth.uid(),'manage_performance') and public.can_view_employee(auth.uid(), employee_id))
);

-- ============ ONBOARDING ============
drop policy if exists "onb hr write" on public.onboarding_tasks;
create policy "onb manage" on public.onboarding_tasks for all to authenticated
using (
  public.has_permission(auth.uid(),'manage_onboarding')
  and (employee_id is null or public.can_view_employee(auth.uid(), employee_id))
)
with check (
  public.has_permission(auth.uid(),'manage_onboarding')
  and (employee_id is null or public.can_view_employee(auth.uid(), employee_id))
);
drop policy if exists "onb scoped read" on public.onboarding_tasks;
create policy "onb scoped read" on public.onboarding_tasks for select to authenticated
using (
  (employee_id is not null and public.can_view_employee(auth.uid(), employee_id))
  or (employee_id is null and public.has_permission(auth.uid(),'view_onboarding'))
);

-- ============ EMPLOYEE DOCUMENTS ============
drop policy if exists "docs hr write" on public.employee_documents;
create policy "docs manage" on public.employee_documents for all to authenticated
using (
  public.has_permission(auth.uid(),'manage_documents')
  and (employee_id is null or public.can_view_employee(auth.uid(), employee_id))
)
with check (
  public.has_permission(auth.uid(),'manage_documents')
  and (employee_id is null or public.can_view_employee(auth.uid(), employee_id))
);
drop policy if exists "docs scoped read" on public.employee_documents;
create policy "docs scoped read" on public.employee_documents for select to authenticated
using (
  (employee_id is not null and public.can_view_employee(auth.uid(), employee_id))
  or (employee_id is null and (uploaded_by = auth.uid() or public.has_permission(auth.uid(),'view_documents')))
);

-- ============ GENERATED DOCUMENTS ============
drop policy if exists "gendoc hr" on public.generated_documents;
create policy "gendoc manage" on public.generated_documents for all to authenticated
using (created_by = auth.uid() or public.has_permission(auth.uid(),'manage_documents'))
with check (created_by = auth.uid() or public.has_permission(auth.uid(),'manage_documents'));

-- ============ HELPDESK ============
drop policy if exists "ticket update" on public.helpdesk_tickets;
create policy "ticket update" on public.helpdesk_tickets for update to authenticated
using (
  public.has_permission(auth.uid(),'manage_helpdesk')
  or created_by = auth.uid()
  or (assigned_to is not null and assigned_to = public.current_employee_id(auth.uid()))
)
with check (
  public.has_permission(auth.uid(),'manage_helpdesk')
  or created_by = auth.uid()
  or (assigned_to is not null and assigned_to = public.current_employee_id(auth.uid()))
);
drop policy if exists "ticket read" on public.helpdesk_tickets;
create policy "ticket read" on public.helpdesk_tickets for select to authenticated
using (
  public.has_permission(auth.uid(),'manage_helpdesk')
  or created_by = auth.uid()
  or (assigned_to is not null and assigned_to = public.current_employee_id(auth.uid()))
  or (employee_id is not null and public.can_view_employee(auth.uid(), employee_id))
);
drop policy if exists "tc read" on public.ticket_comments;
create policy "tc read" on public.ticket_comments for select to authenticated
using (exists (select 1 from public.helpdesk_tickets t where t.id = ticket_comments.ticket_id));

-- ============ AI INSIGHTS ============
drop policy if exists "insight write" on public.ai_insights;
create policy "insight manage" on public.ai_insights for all to authenticated
using (public.has_permission(auth.uid(),'manage_ai'))
with check (public.has_permission(auth.uid(),'manage_ai'));
drop policy if exists "insight read" on public.ai_insights;
create policy "insight read" on public.ai_insights for select to authenticated
using (public.has_permission(auth.uid(),'view_analytics') or public.has_permission(auth.uid(),'view_employee'));

-- ============ KNOWLEDGE BASE ============
drop policy if exists "kb read" on public.kb_documents;
create policy "kb read" on public.kb_documents for select to authenticated
using (status = 'published' or public.has_permission(auth.uid(),'manage_knowledge'));

-- ============ PROFILES / ROLES ============
drop policy if exists "profile read" on public.profiles;
create policy "profile read" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.has_permission(auth.uid(),'manage_users')
  or exists (
    select 1 from public.employees e
    where e.user_id = profiles.id and public.can_view_employee(auth.uid(), e.id)
  )
);
drop policy if exists "roles self read" on public.user_roles;
create policy "roles self read" on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.has_permission(auth.uid(),'manage_users'));

-- ============ EMPLOYEES: scope-checked updates ============
drop policy if exists "emp scoped write" on public.employees;
create policy "emp insert" on public.employees for insert to authenticated
with check (public.has_permission(auth.uid(),'manage_employee'));
create policy "emp update" on public.employees for update to authenticated
using (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), id))
with check (public.has_permission(auth.uid(),'manage_employee'));
create policy "emp delete" on public.employees for delete to authenticated
using (public.has_permission(auth.uid(),'manage_employee') and public.can_view_employee(auth.uid(), id));