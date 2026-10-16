"""Row-level security policy engine (mirror of the Supabase RLS schema).

Policies are transcribed from `drizzle/migrations/0000..0010*.sql`, always
using the *latest* definition of each policy (0003/0006/0009 dropped and
re-created several). Each table gets a handful of callables:

  read(user)          -> django Q()  applied as a row filter on SELECT
  insert(user, data)  -> bool  (RLS WITH CHECK on the new row)
  update(user)        -> Q()   (RLS USING  — which existing rows may change)
  check(user, old,new)-> bool  (RLS WITH CHECK on the merged post-update row)
  delete(user)        -> Q()   (RLS USING for DELETE)

Semantics match PostgreSQL: `update()`/`delete()` answer *which rows* the
actor may touch; `insert()`/`check()` answer whether the actor is allowed to
produce the target row. When a table has no policy for an operation in the
schema, the operation is denied (the endpoint returns PGRST116-style 0 rows /
PGRST205 permission denied).
"""

from __future__ import annotations

import inspect
from typing import Callable

from django.db.models import Q

import hr.rbac as rbac
import hr.models as _models

for _name, _obj in vars(_models).items():
    if not _name.startswith("_") and isinstance(_obj, type):
        globals().setdefault(_name, _obj)
_Q = Q


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _user(user) -> bool:  # anonymous guard
    return user is not None and getattr(user, "is_anonymous", False) is False


def _positional_arity(check: Callable) -> int | None:
    """Count required positional params of a predicate.

    Returns ``None`` when the callable is opaque or variadic (``*args``), in
    which case callers must invoke it as-is because it accepts any arity.
    """
    try:
        sig = inspect.signature(check)
    except (TypeError, ValueError):
        return None
    n = 0
    for p in sig.parameters.values():
        if p.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ) and p.default is inspect.Parameter.empty:
            n += 1
        elif p.kind == inspect.Parameter.VAR_POSITIONAL:
            return None
    return n


def _adapt_check(check: Callable) -> Callable | None:
    """Normalise a WITH CHECK predicate onto the `(user, old, new)` contract.

    All check callables are invoked by ``Policy.check_ok`` with three
    arguments.  Simple INSERT-style predicates declared as ``(user, data)``
    (``_is_hr``, ``_is_admin``, ``perm_write(...)`` etc.) are used directly as
    a ``check=`` in several policies, so wrap them to receive the merged
    post-update row while leaving genuine 3-arg checks untouched.
    """
    if check is None:
        return None
    n = _positional_arity(check)
    if n is None:
        return check
    if n <= 2:
        base = check
        return lambda user, old, new: bool(base(user, new))
    return check


def _adapt_insert(insert: Callable) -> Callable | None:
    """Normalise an INSERT predicate onto the `(user, data)` contract.

    ``Policy.insert_ok`` invokes the INSERT predicate with two arguments,
    because an INSERT has no previous row.  Genuine 3-arg WITH CHECK predicates
    wired into ``insert=`` therefore have to be wrapped so the submitted
    payload arrives as the merged post-update row; calling them directly raises
    ``missing 1 required positional argument: 'new'``.  An empty ``old`` is
    passed, matching RLS, where INSERT evaluates WITH CHECK against the new row
    alone.
    """
    if insert is None:
        return None
    n = _positional_arity(insert)
    if n is None or n <= 2:
        return insert
    return lambda user, data: bool(insert(user, {}, data or {}))


def _emp_ids(user) -> list[str]:
    """PKs of every Employee the actor may view (RLS can_view_employee)."""
    if not _user(user):
        return []
    return list(
        Employee.objects.filter(rbac.can_view_employee_q(user)).values_list("pk", flat=True)
    )


def _self_emp(user):
    if not _user(user):
        return None
    return rbac.current_employee_id(user.pk)


def _s(value) -> str | None:
    return str(value) if value is not None else None


# ---------------------------------------------------------------------------
# factory combinators
# ---------------------------------------------------------------------------

def allow_all(user) -> Q:  # pragma: no cover - trivial passthrough
    return Q()

def deny_all(user) -> Q:
    return Q(pk=None)

def _deny_bool(user, data=False) -> bool:
    return False


def perm(user, code: str) -> bool:
    return rbac.has_permission(user, code)


def perm_read(code: str) -> Callable:
    """Read-all when the actor holds `code`, otherwise nothing."""
    return lambda user, code=code: Q() if perm(user, code) else Q(pk=None)


def perm_write(code: str) -> Callable:
    """Write predicate that only checks the permission (no row scope).

    3-arg signature so ``Policy.check_ok(user, old, new)`` (rest.py PATCH / this
    module's check writer) can pass the merged row data without confusing it for
    the permission ``code`` (fixes `cannot use 'dict' as a set element` on the
    update/advance/paid write path).
    """
    def check(user, old=None, new=None, code=code):
        return perm(user, code)
    return check


def scoped_read(field: str = "employee_id") -> Callable:
    """RLS `can_view_employee(uid, <field>)` as a Q filter."""
    def q(user, field=field):
        ids = _emp_ids(user)
        return Q(**{f"{field}__in": ids}) if ids else Q(pk=None)
    return q


def scoped_write(field: str = "employee_id", code: str = "") -> Callable:
    """manage_* AND can_view_employee(<field>) — the common USING filter."""
    def q(user, field=field, code=code):
        if not perm(user, code):
            return Q(pk=None)
        ids = _emp_ids(user)
        return Q(**{f"{field}__in": ids}) if ids else Q(pk=None)
    return q


def scoped_check(field: str = "employee_id", code: str = "") -> Callable:
    """WITH CHECK equivalent for scoped_write policies."""
    def ok(user, old, new, field=field, code=code):
        if not perm(user, code):
            return False
        eid = new.get(field)
        if eid is None:
            return True
        return rbac.can_view_employee(user, eid)
    return ok


def org_read(code: str, org_field: str = "organization_id") -> Callable:
    """performance/RLS `<code> and in_my_org(uid, organization_id)`."""
    def q(user, code=code, org_field=org_field):
        if not perm(user, code):
            return Q(pk=None)
        if rbac.has_role(user, AppRole.SUPER_ADMIN) or rbac.user_scope(user) == DataScope.GLOBAL:
            return Q()
        org_id = rbac.current_organization_id(user)
        if not org_id:
            return Q(pk=None)
        return Q(**{org_field: org_id})
    return q


def org_write(code: str, org_field: str = "organization_id") -> Callable:
    def q(user, code=code, org_field=org_field):
        if not perm(user, code):
            return Q(pk=None)
        if rbac.has_role(user, AppRole.SUPER_ADMIN) or rbac.user_scope(user) == DataScope.GLOBAL:
            return Q()
        org_id = rbac.current_organization_id(user)
        if not org_id:
            return Q(pk=None)
        return Q(**{org_field: org_id})
    return q


def org_check(code: str, org_field: str = "organization_id") -> Callable:
    def ok(user, old, new, code=code, org_field=org_field):
        if not perm(user, code):
            return False
        return rbac.in_my_org(user, _s(new.get(org_field)))
    return ok


def self_scope(field: str = "employee_id") -> Callable:
    """is_self_employee(uid, <field>) as Q."""
    def q(user, field=field):
        me = _self_emp(user)
        return Q(**{f"{field}": me}) if me else Q(pk=None)
    return q


# ---------------------------------------------------------------------------
# core policy object
# ---------------------------------------------------------------------------

class Policy:
    """One table's RLS behaviour."""

    def __init__(
        self,
        model,
        *,
        read: Callable = allow_all,
        insert: Callable = None,
        update: Callable = None,
        delete: Callable = None,
        check: Callable = None,
    ):
        self.model = model
        self.read = read
        self.insert = _adapt_insert(insert) or _deny_bool
        self.update = update or deny_all
        self.delete = delete if delete is not None else self.update
        self.check = _adapt_check(check)

    def insert_ok(self, user, data: dict) -> bool:
        return bool(self.insert(user, data))

    def update_q(self, user) -> Q:
        return self.update(user)

    def delete_q(self, user) -> Q:
        return self.delete(user)

    def read_q(self, user) -> Q:
        return self.read(user)

    def check_ok(self, user, old: dict, new: dict) -> bool:
        """WITH CHECK on the merged post-update row (falls back to insert)."""
        if self.check is not None:
            return bool(self.check(user, old, new))
        return bool(self.insert(user, new))


# ---------------------------------------------------------------------------
# procedural helpers reused by several policies
# ---------------------------------------------------------------------------

def ink_org_q(user):
    if rbac.has_role(user, AppRole.SUPER_ADMIN) or rbac.user_scope(user) == DataScope.GLOBAL:
        return Q()
    org_id = rbac.current_organization_id(user)
    return Q(organization_id=org_id) if org_id else Q(pk=None)


def _ticket_viewable(user) -> Q:  # which HelpdeskTickets the actor may see
    if perm(user, "manage_helpdesk"):
        return Q()
    q = Q(created_by=user.pk)
    me = _self_emp(user)
    if me:
        q |= Q(employee_id=me) | Q(assigned_to_id=me)
    return q


def _ticket_pks(user) -> list:
    from hr.models.helpdesk import HelpdeskTicket
    return list(
        HelpdeskTicket.objects.filter(_ticket_viewable(user)).values_list("pk", flat=True)
    )


def ticket_child_read(engage: bool = False, creator: bool = False) -> Callable:
    """Read for comment/history/note/attachment children.

    engage=True mirrors `manage_helpdesk OR assigned_to OR created_by` parent
    visibility; creator=True restricts further to `manage_helpdesk OR created_by`.
    """
    def q(user):
        from hr.models.helpdesk import HelpdeskTicket
        tickets = HelpdeskTicket.objects.all()
        if engage or creator:
            if perm(user, "manage_helpdesk"):
                pks = list(tickets.values_list("pk", flat=True))
            else:
                qq = Q(created_by=user.pk)
                if not creator:
                    me = _self_emp(user)
                    if me:
                        qq |= Q(assigned_to_id=me)
                pks = list(tickets.filter(qq).values_list("pk", flat=True))
        else:
            pks = list(tickets.values_list("pk", flat=True))
        return Q(ticket_id__in=pks) if pks else Q(pk=None)
    return q


def ticket_child_insert(created_by: bool = True,
                        assigned: bool = True) -> Callable:
    def ok(user, data):
        from hr.models.helpdesk import HelpdeskTicket
        tid = data.get("ticket_id")
        if not tid:
            return False
        if perm(user, "manage_helpdesk"):
            return HelpdeskTicket.objects.filter(pk=tid).exists()
        q = Q()
        if created_by:
            q |= Q(created_by=user.pk)
        me = _self_emp(user)
        if assigned and me:
            q |= Q(assigned_to_id=me)
        return HelpdeskTicket.objects.filter(q).filter(pk=tid).exists()
    return ok


# ---------------------------------------------------------------------------
# employees / org core
# ---------------------------------------------------------------------------

def _emp_insert(user, data) -> bool:
    return rbac.can_place_employee(
        user,
        data.get("organization_id"),
        data.get("legal_entity_id"),
        data.get("location_id"),
        data.get("department_id"),
    )


def _emp_update_q(user) -> Q:
    if not perm(user, "manage_employee"):
        return Q(pk=None)
    return rbac.can_view_employee_q(user)


def _emp_check(user, old, new) -> bool:
    return rbac.can_place_employee(
        user,
        new.get("organization_id"),
        new.get("legal_entity_id"),
        new.get("location_id"),
        new.get("department_id"),
    )


def _profile_read(user) -> Q:
    if perm(user, "manage_users"):
        return Q()
    q = Q(id=user.pk)
    ids = list(
        Employee.objects.filter(rbac.can_view_employee_q(user)).values_list("user_id", flat=True)
    )
    if ids:
        q |= Q(id__in=ids)
    return q


def _roleperm(user, _data) -> bool:
    return rbac.has_role(user, AppRole.SUPER_ADMIN)


def _is_hr(user, _data) -> bool:
    return rbac.is_hr(user)


def _is_admin(user, _data) -> bool:
    return rbac.is_admin(user)


def _is_admin_q(user) -> Q:
    return Q() if rbac.is_admin(user) else Q(pk=None)


def _super_admin_q(user) -> Q:
    return Q() if rbac.has_role(user, AppRole.SUPER_ADMIN) else Q(pk=None)


def _super_admin(user, _data) -> bool:
    return rbac.has_role(user, AppRole.SUPER_ADMIN)


# ---------------------------------------------------------------------------
# helpdesk
# ---------------------------------------------------------------------------

def _ticket_read(user) -> Q:
    return _ticket_viewable(user)


def _ticket_insert(user, data) -> bool:
    return _s(data.get("created_by")) == _s(user.pk) or rbac.is_hr(user)


def _ticket_update(user) -> Q:
    return _ticket_viewable(user)


def _ticket_check(user, old, new) -> bool:
    """RLS ticket update: same expression for USING and WITH CHECK."""
    if perm(user, "manage_helpdesk") or _s(new.get("created_by")) == _s(user.pk):
        return True
    me = _self_emp(user)
    value = new.get("assigned_to") or new.get("assigned_to_id")
    return bool(me and value and _s(value) == me)


def ai_conv_read(user) -> Q:
    return Q(user_id=user.pk)


def ai_msg_read(user) -> bool:
    return Q(conversation__user_id=user.pk)


# ---------------------------------------------------------------------------
# leaves
# ---------------------------------------------------------------------------

def _leave_self_or_hr(user, data) -> bool:
    me = _self_emp(user)
    if me and _s(data.get("employee_id")) == me:
        return True
    return rbac.is_hr(user)


def _leave_update_q(user) -> Q:
    me = _self_emp(user)
    base = Q(employee_id=me) if me else Q(pk=None)
    if perm(user, "manage_leave"):
        ids = _emp_ids(user)
        scoped = Q(employee_id__in=ids) if ids else Q(pk=None)
        if me:
            scoped = scoped & ~Q(employee_id=me)
        base = base | scoped
    return base


def _leave_check(user, old, new) -> bool:
    me = _self_emp(user)
    if me and _s(new.get("employee_id")) == me:
        return True
    if not perm(user, "manage_leave"):
        return False
    return rbac.can_view_employee(user, new.get("employee_id")) and _s(
        new.get("employee_id")
    ) != me


# ---------------------------------------------------------------------------
# performance
# ---------------------------------------------------------------------------

def _goal_read(user) -> Q:
    me = _self_emp(user)
    q = Q(employee_id=me) if me else Q(pk=None)
    if perm(user, "view_performance"):
        ids = _emp_ids(user)
        q |= Q(employee_id__in=ids) if ids else Q()
    return q


def _goal_write_q(user) -> Q:
    me = _self_emp(user)
    base = Q(employee_id=me) if me else Q(pk=None)
    if perm(user, "manage_performance"):
        ids = _emp_ids(user)
        base |= Q(employee_id__in=ids) if ids else Q()
    return base


def _goal_check(user, old, new) -> bool:
    eid = new.get("employee_id")
    if _s(eid) == _self_emp(user):
        return True
    return perm(user, "manage_performance") and rbac.can_view_employee(user, eid)


def _review_read(user) -> Q:
    me = _self_emp(user)
    q = Q(employee_id=me) if me else Q(pk=None)
    if perm(user, "view_performance"):
        ids = _emp_ids(user)
        q |= Q(employee_id__in=ids) if ids else Q()
    return q


def _review_write_q(user) -> Q:
    if not perm(user, "manage_performance"):
        return Q(pk=None)
    ids = _emp_ids(user)
    q = Q(employee_id__in=ids) if ids else Q(pk=None)
    me = _self_emp(user)
    if me:
        q = q & ~Q(employee_id=me)
    return q


def _review_check(user, old, new) -> bool:
    eid = new.get("employee_id")
    if not perm(user, "manage_performance"):
        return False
    return rbac.can_view_employee(user, eid) and _s(eid) != _self_emp(user)


# ---------------------------------------------------------------------------
# documents
# ---------------------------------------------------------------------------

def _doc_read(user) -> Q:
    ids = _emp_ids(user)
    scoped = Q(employee_id__in=ids) if ids else Q(pk=None)
    if perm(user, "view_documents"):
        null = Q(employee_id__isnull=True)
    else:
        null = Q(employee_id__isnull=True, uploaded_by=user.pk)
    return scoped | null


def _doc_write_q(user) -> Q:
    if not perm(user, "manage_documents"):
        return Q(pk=None)
    ids = _emp_ids(user)
    scoped = Q(employee_id__in=ids) if ids else Q(pk=None)
    return scoped | Q(employee_id__isnull=True)


def _doc_insert(user, data) -> bool:
    eid = data.get("employee_id")
    if eid is not None and _s(eid) == _self_emp(user):
        return True
    return _doc_check(user, {}, data)


def _doc_check(user, old, new) -> bool:
    if not perm(user, "manage_documents"):
        return False
    eid = new.get("employee_id")
    if eid is None:
        return True
    return rbac.can_view_employee(user, eid)


def _gen_doc_q(user) -> Q:
    if perm(user, "manage_documents"):
        return Q()
    return Q(created_by=user.pk)


def _gen_doc(user, data) -> bool:
    return _s(data.get("created_by")) == _s(user.pk) or perm(user, "manage_documents")


def _dv_read(user) -> Q:
    ids = _emp_ids(user)
    q = Q(document__employee_id__isnull=True)
    if ids:
        q |= Q(document__employee_id__in=ids)
    return q


# ---------------------------------------------------------------------------
# onboarding / offboarding
# ---------------------------------------------------------------------------

def _onb_read(user) -> Q:
    ids = _emp_ids(user)
    scoped = Q(employee_id__in=ids) if ids else Q(pk=None)
    if perm(user, "view_onboarding"):
        null = Q(employee_id__isnull=True)
    else:
        null = Q(pk=None)
    return scoped | null


def _onb_write_q(user) -> Q:
    if not perm(user, "manage_onboarding"):
        return Q(pk=None)
    ids = _emp_ids(user)
    scoped = Q(employee_id__in=ids) if ids else Q(pk=None)
    return scoped | Q(employee_id__isnull=True)


def _onb_check(user, old, new) -> bool:
    if not perm(user, "manage_onboarding"):
        return False
    eid = new.get("employee_id")
    if eid is None:
        return True
    return rbac.can_view_employee(user, eid)


def _off_read(user) -> Q:
    if not perm(user, "view_offboarding"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _off_write_q(user) -> Q:
    if not perm(user, "manage_offboarding"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _exit_read(user) -> Q:
    if not perm(user, "view_offboarding"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(offboarding__employee_id__in=ids) if ids else Q(pk=None)


# ---------------------------------------------------------------------------
# attendance (shifts / corrections)
# ---------------------------------------------------------------------------

def _sas_read(user) -> Q:
    if perm(user, "manage_shifts"):
        return Q()
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _sas_write_q(user) -> Q:
    if not perm(user, "manage_shifts"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _acorr_insert(user, data) -> bool:
    eid = data.get("employee_id")
    if _s(eid) == _self_emp(user):
        return True
    return perm(user, "manage_attendance") and rbac.can_view_employee(user, eid)


def _acorr_update_q(user) -> Q:
    ids = _emp_ids(user)
    scoped = Q(employee_id__in=ids) if ids else Q(pk=None)
    if perm(user, "manage_attendance"):
        return scoped
    if rbac.is_manager(user):
        me = _self_emp(user)
        if me:
            scoped = scoped & ~Q(employee_id=me)
        return scoped
    return Q(pk=None)


def _acorr_check(user, old, new) -> bool:
    eid = new.get("employee_id")
    if perm(user, "manage_attendance") and rbac.can_view_employee(user, eid):
        return True
    return rbac.is_manager(user) and rbac.can_view_employee(user, eid) and _s(eid) != _self_emp(user)


# ---------------------------------------------------------------------------
# recruitment
# ---------------------------------------------------------------------------

def _panel_read(user) -> Q:
    if perm(user, "view_recruitment"):
        return Q()
    me = _self_emp(user)
    return Q(employee_id=me) if me else Q(pk=None)


def _recruit_write_q(user) -> Q:  # manage_recruitment only (no org scope on the row)
    return Q() if perm(user, "manage_recruitment") else Q(pk=None)


def _recruit_write(user, data) -> bool:
    return perm(user, "manage_recruitment")


def _fb_read(user) -> Q:
    if perm(user, "view_recruitment"):
        return Q()
    me = _self_emp(user)
    return Q(reviewer_id=me) if me else Q(pk=None)


def _fb_write(user, data) -> bool:
    if perm(user, "manage_recruitment"):
        return True
    return _s(data.get("reviewer_id")) == _self_emp(user)


def _fb_delete(user) -> Q:
    return Q() if perm(user, "manage_recruitment") else Q(pk=None)


# ---------------------------------------------------------------------------
# expense / profile change
# ---------------------------------------------------------------------------

def _exp_request_insert(user, data) -> bool:
    eid = data.get("employee_id")
    if _s(eid) == _self_emp(user):
        return True
    return perm(user, "manage_employee") and rbac.can_view_employee(user, eid)


def _exp_request_update_q(user) -> Q:
    me = _self_emp(user)
    base = Q(employee_id=me) if me else Q(pk=None)
    if perm(user, "manage_employee"):
        ids = _emp_ids(user)
        base |= Q(employee_id__in=ids) if ids else Q()
    return base


def _exp_request_check(user, old, new) -> bool:
    eid = new.get("employee_id")
    if _s(eid) == _self_emp(user):
        return True
    return perm(user, "manage_employee") and rbac.can_view_employee(user, eid)


def _pcr_read(user) -> Q:
    me = _self_emp(user)
    base = Q(employee_id=me) if me else Q(pk=None)
    ids = _emp_ids(user)
    base |= Q(employee_id__in=ids) if ids else Q()
    return base


def _pcr_insert(user, data) -> bool:
    return _s(data.get("employee_id")) == _self_emp(user)


def _pcr_update_q(user) -> Q:
    me = _self_emp(user)
    base = Q(employee_id=me) if me else Q(pk=None)
    if perm(user, "manage_employee"):
        ids = _emp_ids(user)
        base |= Q(employee_id__in=ids) if ids else Q()
    return base


def _pcr_check(user, old, new) -> bool:
    eid = new.get("employee_id")
    if _s(eid) == _self_emp(user):
        return True
    return perm(user, "manage_employee")


# ---------------------------------------------------------------------------
# payroll / assets / training / compliance / letters
# ---------------------------------------------------------------------------

def _sal_read(user) -> Q:
    if perm(user, "view_payroll"):
        return Q()
    me = _self_emp(user)
    return Q(employee_id=me) if me else Q(pk=None)


def _pe_read(user) -> Q:
    if perm(user, "view_payroll"):
        return Q()
    me = _self_emp(user)
    if not me:
        return Q(pk=None)
    from hr.models.ops import PayrollRun
    paid = PayrollRun.objects.filter(status="paid").values_list("pk", flat=True)
    return Q(run_id__in=paid, employee_id=me)


def _payroll_run_read(user) -> Q:
    """Runs are org-wide payroll metadata, so only `view_payroll` sees them all.

    Anyone else (an Employee on self-service) sees just the runs that contain
    one of *their own paid* entries — the same rows ``_pe_read`` hands them — so
    they can resolve their own pay period and payment status without ever
    reaching another employee's payroll or the organisation's run list.
    """
    if perm(user, "view_payroll"):
        return Q()
    me = _self_emp(user)
    if not me:
        return Q(pk=None)
    from hr.models.ops import PayrollEntry
    run_ids = list(
        PayrollEntry.objects.filter(employee_id=me, run__status="paid").values_list(
            "run_id", flat=True
        )
    )
    return Q(pk__in=run_ids) if run_ids else Q(pk=None)


def _asset_read(user) -> Q:
    if perm(user, "view_assets") or rbac.is_hr(user):
        return Q()
    me = _self_emp(user)
    if not me:
        return Q(pk=None)
    from hr.models.ops import EmployeeAssetAssignment
    ids = list(
        EmployeeAssetAssignment.objects.filter(status="active", employee_id=me).values_list(
            "asset_id", flat=True
        )
    )
    return Q(pk__in=ids) if ids else Q(pk=None)


def _kbc_read(user) -> Q:
    if perm(user, "manage_knowledge"):
        return Q()
    return Q(document__status="published")


def _tt_read(user) -> Q:
    if perm(user, "view_onboarding") or perm(user, "manage_onboarding"):
        return Q()
    return Q(pk=None)


# ---------------------------------------------------------------------------
# POLICY REGISTRY (table -> Policy)
# ---------------------------------------------------------------------------

def build_registry():
    from hr.models import (  # noqa: WPS433 - local import keeps registry lazy
        AiAction, AiConversation, AiInsight, AiMessage,
        Application, AttendanceCorrection, AttendanceRecord,
        AuditLog, Candidate, CandidateScreening, CompanyAsset,
        CompanyHoliday, ComplianceItem, Department, DocumentVerification,
        Employee, EmployeeAssetAssignment, EmployeeCompliance,
        EmployeeDocument, EmployeeLetter, EmployeeLifecycleEvent,
        EmployeeSalary, EmployeeShiftAssignment, EmployeeTraining,
        ExitChecklistItem, ExpensePolicy, ExpenseRequest, GeneratedDocument,
        Goal, HelpdeskTicket, Interview, InterviewFeedback, InterviewPanel,
        JobRequisition, KbChunk, KbDocument, LeaveBalance,
        LeaveBalanceMovement, LeavePolicy, LeaveRequest, LeaveType,
        LegalEntity, Location, Notification, Offer, Offboarding,
        OnboardingTask, OnboardingTemplate, OnboardingTemplateTask,
        PayrollEntry, PayrollRun, PerformanceCycle, PerformanceReview,
        Permission, Profile, ProfileChangeRequest, RolePermission,
        Shift, TicketAttachment, TicketComment, TicketInternalNote,
        TicketStatusHistory, TrainingProgram, TrainingSession, UserRole,
    )

    id_field = {"employee_id": "employee_id", "reviewer_id": "reviewer_id"}

    p = {}
    p["organizations"] = Policy(Organization, read=allow_all, insert=_is_admin,
                                update=_is_admin_q, check=_is_admin, delete=_is_admin_q)
    p["legal_entities"] = Policy(LegalEntity, read=allow_all, insert=_is_admin,
                                 update=_is_admin_q, check=_is_admin, delete=_is_admin_q)
    p["locations"] = Policy(Location, read=allow_all, insert=_is_admin,
                            update=_is_admin_q, check=_is_admin, delete=_is_admin_q)
    p["departments"] = Policy(Department, read=allow_all, insert=_is_admin,
                              update=_is_admin_q, check=_is_admin, delete=_is_admin_q)
    p["profiles"] = Policy(Profile, read=_profile_read, insert=_deny_bool,
                           update=lambda user: Q(id=user.pk),
                           check=lambda user, old, new: _s(new.get("id")) == _s(user.pk),
                           delete=deny_all)
    p["user_roles"] = Policy(UserRole,
                             read=lambda user: Q() if perm(user, "manage_users") else Q(user_id=user.pk),
                             update=_super_admin_q, insert=_super_admin,
                             check=_super_admin, delete=_super_admin_q)
    p["employees"] = Policy(Employee, read=rbac.can_view_employee_q,
                            insert=_emp_insert, update=_emp_update_q,
                            delete=_emp_update_q, check=_emp_check)
    p["permissions"] = Policy(Permission, read=allow_all, insert=_super_admin,
                              update=_super_admin_q, check=_super_admin, delete=_super_admin_q)
    p["role_permissions"] = Policy(RolePermission, read=allow_all, insert=_super_admin,
                                   update=_super_admin_q, check=_super_admin,
                                   delete=_super_admin_q)

    p["shifts"] = Policy(Shift, read=allow_all, insert=perm_write("manage_shifts"),
                         update=_perm_q("manage_shifts"), check=perm_write("manage_shifts"),
                         delete=_perm_q("manage_shifts"))
    p["employee_shift_assignments"] = Policy(
        EmployeeShiftAssignment, read=_sas_read, insert=_sas_bool, update=_sas_write_q,
        check=_sas_check, delete=_sas_write_q)
    p["attendance_records"] = Policy(AttendanceRecord, read=scoped_read("employee_id"),
                                     insert=_is_hr, update=_is_hr_q, check=_is_hr, delete=_is_hr_q)
    p["attendance_corrections"] = Policy(
        AttendanceCorrection, read=scoped_read("employee_id"), insert=_acorr_insert,
        update=_acorr_update_q, check=_acorr_check, delete=_acorr_manage_q)

    p["leave_types"] = Policy(LeaveType, read=allow_all, insert=_is_admin,
                              update=_is_admin_q, check=_is_admin, delete=_is_admin_q)
    p["leave_policies"] = Policy(LeavePolicy, read=allow_all, insert=perm_write("manage_leave"),
                                 update=_perm_q("manage_leave"), check=perm_write("manage_leave"),
                                 delete=_perm_q("manage_leave"))
    p["company_holidays"] = Policy(
        CompanyHoliday, read=allow_all,
        insert=_or_perm("manage_leave", "manage_organization"),
        update=_or_perm_q("manage_leave", "manage_organization"),
        check=_or_perm("manage_leave", "manage_organization"),
        delete=_or_perm_q("manage_leave", "manage_organization"))
    p["leave_balances"] = Policy(LeaveBalance, read=scoped_read("employee_id"),
                                 insert=_lb_bool, update=_lb_q, check=_lb_bool, delete=_lb_q)
    p["leave_requests"] = Policy(LeaveRequest, read=scoped_read("employee_id"),
                                 insert=_leave_self_or_hr, update=_leave_update_q,
                                 check=_leave_check, delete=deny_all)
    p["leave_balance_movements"] = Policy(
        LeaveBalanceMovement, read=scoped_read("employee_id"),
        insert=_lb_bool, update=_lb_q, check=perm_write("manage_leave"), delete=_lb_q)

    p["performance_cycles"] = Policy(PerformanceCycle, read=allow_all,
                                     insert=perm_write("manage_performance"),
                                     update=_perm_q("manage_performance"),
                                     check=perm_write("manage_performance"),
                                     delete=_perm_q("manage_performance"))
    p["goals"] = Policy(Goal, read=_goal_read, insert=_goal_check,
                        update=_goal_write_q, check=_goal_check, delete=_goal_write_q)
    p["performance_reviews"] = Policy(PerformanceReview, read=_review_read,
                                      insert=_review_check, update=_review_write_q,
                                      check=_review_check, delete=_review_write_q)

    p["employee_documents"] = Policy(EmployeeDocument, read=_doc_read, insert=_doc_insert,
                                     update=_doc_write_q, check=_doc_check, delete=_doc_write_q)
    p["document_verifications"] = Policy(DocumentVerification, read=_dv_read,
                                         insert=perm_write("manage_documents"),
                                         update=_perm_q("manage_documents"),
                                         check=perm_write("manage_documents"),
                                         delete=_perm_q("manage_documents"))
    p["generated_documents"] = Policy(GeneratedDocument, read=_gen_doc_q, insert=_gen_doc,
                                      update=_gen_doc_q, check=_gen_doc, delete=_gen_doc_q)

    p["onboarding_templates"] = Policy(
        OnboardingTemplate, read=_ottempl_read,
        insert=perm_write("manage_onboarding"), update=_perm_q("manage_onboarding"),
        check=perm_write("manage_onboarding"), delete=_perm_q("manage_onboarding"))
    p["onboarding_template_tasks"] = Policy(
        OnboardingTemplateTask, read=_tt_read, insert=perm_write("manage_onboarding"),
        update=_perm_q("manage_onboarding"), check=perm_write("manage_onboarding"),
        delete=_perm_q("manage_onboarding"))
    p["onboarding_tasks"] = Policy(OnboardingTask, read=_onb_read, insert=_onb_check,
                                   update=_onb_write_q, check=_onb_check, delete=_onb_write_q)
    p["offboardings"] = Policy(Offboarding, read=_off_read, insert=_off_check,
                               update=_off_write_q, check=_off_check, delete=_off_write_q)
    p["exit_checklist_items"] = Policy(
        ExitChecklistItem, read=_exit_read, insert=perm_write("manage_offboarding"),
        update=_perm_q("manage_offboarding"), check=perm_write("manage_offboarding"),
        delete=_perm_q("manage_offboarding"))
    p["employee_lifecycle_events"] = Policy(
        EmployeeLifecycleEvent, read=scoped_read("employee_id"),
        insert=_life_check, update=scoped_write("employee_id", "manage_employee"),
        check=_life_check, delete=scoped_write("employee_id", "manage_employee"))

    p["helpdesk_tickets"] = Policy(HelpdeskTicket, read=_ticket_read, insert=_ticket_insert,
                                   update=_ticket_update, check=_ticket_check, delete=_ticket_update)
    p["ticket_comments"] = Policy(TicketComment, read=ticket_child_read(),
                                  insert=ticket_child_insert(created_by=True, assigned=True),
                                  update=deny_all, delete=deny_all,
                                  check=ticket_child_insert(created_by=True, assigned=True))
    p["ticket_status_history"] = Policy(
        TicketStatusHistory, read=allow_all,
        insert=ticket_child_insert(created_by=True, assigned=True),
        update=deny_all, delete=deny_all,
        check=ticket_child_insert(created_by=True, assigned=True))
    p["ticket_internal_notes"] = Policy(
        TicketInternalNote, read=ticket_child_read(engage=True),
        insert=ticket_child_insert(created_by=True, assigned=True),
        update=deny_all, delete=deny_all,
        check=ticket_child_insert(created_by=True, assigned=True))
    p["ticket_attachments"] = Policy(
        TicketAttachment, read=ticket_child_read(creator=True),
        insert=ticket_child_insert(created_by=True, assigned=False),
        update=deny_all, delete=deny_all,
        check=ticket_child_insert(created_by=True, assigned=False))

    p["kb_documents"] = Policy(KbDocument,
                               read=lambda user: Q() if perm(user, "manage_knowledge") else Q(status="published"),
                               insert=perm_write("manage_knowledge"),
                               update=_perm_q("manage_knowledge"),
                               check=perm_write("manage_knowledge"),
                               delete=_perm_q("manage_knowledge"))
    p["kb_chunks"] = Policy(KbChunk, read=_kbc_read, insert=perm_write("manage_knowledge"),
                            update=_perm_q("manage_knowledge"),
                            check=perm_write("manage_knowledge"),
                            delete=_perm_q("manage_knowledge"))

    p["ai_conversations"] = Policy(AiConversation, read=ai_conv_read, insert=_ai_user,
                                   update=_ai_conv_q, check=_ai_user, delete=_ai_conv_q)
    p["ai_messages"] = Policy(AiMessage, read=_ai_msg_q, insert=_ai_msg_bool,
                              update=_ai_msg_q, check=_ai_msg_bool, delete=_ai_msg_q)
    p["ai_actions"] = Policy(AiAction,
                             read=lambda user: Q() if rbac.is_hr(user) else Q(requested_by=user.pk),
                             insert=lambda user, data: _s(data.get("requested_by")) == _s(user.pk),
                             update=_is_admin_q, check=_is_admin, delete=deny_all)
    p["ai_insights"] = Policy(
        AiInsight,
        read=lambda user: Q() if perm(user, "view_analytics") or perm(user, "view_employee") else Q(pk=None),
        insert=perm_write("manage_ai"), update=_perm_q("manage_ai"),
        check=perm_write("manage_ai"), delete=_perm_q("manage_ai"))

    p["notifications"] = Policy(Notification, read=ai_conv_read, insert=_ai_user,
                                update=_ai_conv_q, check=_ai_user, delete=_ai_conv_q)
    p["audit_logs"] = Policy(AuditLog, read=_is_admin_q,
                             insert=lambda user, data: _s(data.get("user_id")) == _s(user.pk),
                             update=deny_all, delete=deny_all,
                             check=lambda user, old, new: _s(new.get("user_id")) == _s(user.pk))

    p["job_requisitions"] = Policy(
        JobRequisition, read=org_read("view_recruitment"), insert=org_check("manage_recruitment"),
        update=org_write("manage_recruitment"), check=org_check("manage_recruitment"),
        delete=org_write("manage_recruitment"))
    p["candidates"] = Policy(Candidate, read=org_read("view_recruitment"),
                             insert=org_check("manage_recruitment"),
                             update=org_write("manage_recruitment"),
                             check=org_check("manage_recruitment"),
                             delete=org_write("manage_recruitment"))
    p["applications"] = Policy(Application, read=org_read("view_recruitment"),
                               insert=org_check("manage_recruitment"),
                               update=org_write("manage_recruitment"),
                               check=org_check("manage_recruitment"),
                               delete=org_write("manage_recruitment"))
    p["interviews"] = Policy(Interview, read=org_read("view_recruitment"),
                             insert=org_check("manage_recruitment"),
                             update=org_write("manage_recruitment"),
                             check=org_check("manage_recruitment"),
                             delete=org_write("manage_recruitment"))
    p["offers"] = Policy(Offer, read=org_read("view_recruitment"),
                         insert=org_check("manage_recruitment"),
                         update=org_write("manage_recruitment"),
                         check=org_check("manage_recruitment"),
                         delete=org_write("manage_recruitment"))
    p["interview_panel"] = Policy(InterviewPanel, read=_panel_read,
                                  insert=_recruit_write, update=_recruit_write_q,
                                  check=_recruit_write, delete=_recruit_write_q)
    p["interview_feedback"] = Policy(InterviewFeedback, read=_fb_read, insert=_fb_write,
                                     update=_fb_write_q, check=_fb_write, delete=_fb_delete)
    p["candidate_screenings"] = Policy(CandidateScreening, read=perm_read("view_recruitment"),
                                       insert=perm_write("manage_recruitment"),
                                       update=_perm_q("manage_recruitment"),
                                       check=perm_write("manage_recruitment"),
                                       delete=_perm_q("manage_recruitment"))

    p["expense_requests"] = Policy(ExpenseRequest, read=scoped_read("employee_id"),
                                   insert=_exp_request_insert, update=_exp_request_update_q,
                                   check=_exp_request_check, delete=deny_all)
    p["expense_policies"] = Policy(
        ExpensePolicy, read=allow_all,
        insert=_or_perm("manage_employee", "manage_payroll"),
        update=_or_perm_q("manage_employee", "manage_payroll"),
        check=_or_perm("manage_employee", "manage_payroll"),
        delete=_or_perm_q("manage_employee", "manage_payroll"))
    p["profile_change_requests"] = Policy(ProfileChangeRequest, read=_pcr_read,
                                          insert=_pcr_insert, update=_pcr_update_q,
                                          check=_pcr_check, delete=deny_all)

    p["employee_letters"] = Policy(EmployeeLetter, read=scoped_read("employee_id"),
                                   insert=_letters_check, update=_letters_q,
                                   check=perm_write("manage_letters"), delete=_letters_q)
    p["company_assets"] = Policy(CompanyAsset, read=_asset_read,
                                 insert=perm_write("manage_assets"),
                                 update=_perm_q("manage_assets"),
                                 check=perm_write("manage_assets"),
                                 delete=_perm_q("manage_assets"))
    p["employee_asset_assignments"] = Policy(
        EmployeeAssetAssignment, read=_asset_assign_read, insert=_asset_assign_check,
        update=_asset_assign_q, check=perm_write("manage_assets"), delete=_asset_assign_q)
    p["training_programs"] = Policy(TrainingProgram, read=allow_all,
                                    insert=perm_write("manage_training"),
                                    update=_perm_q("manage_training"),
                                    check=perm_write("manage_training"),
                                    delete=_perm_q("manage_training"))
    p["training_sessions"] = Policy(TrainingSession, read=allow_all,
                                    insert=perm_write("manage_training"),
                                    update=_perm_q("manage_training"),
                                    check=perm_write("manage_training"),
                                    delete=_perm_q("manage_training"))
    p["employee_trainings"] = Policy(EmployeeTraining, read=scoped_read("employee_id"),
                                     insert=_training_check, update=_training_q,
                                     check=perm_write("manage_training"), delete=_training_q)
    p["compliance_items"] = Policy(
        ComplianceItem, read=allow_all,
        insert=_or_perm("manage_compliance", "manage_organization"),
        update=_or_perm_q("manage_compliance", "manage_organization"),
        check=_or_perm("manage_compliance", "manage_organization"),
        delete=_or_perm_q("manage_compliance", "manage_organization"))
    p["employee_compliance"] = Policy(EmployeeCompliance, read=scoped_read("employee_id"),
                                      insert=_compliance_check, update=_compliance_q,
                                      check=perm_write("manage_compliance"),
                                      delete=_compliance_q)
    p["employee_salaries"] = Policy(EmployeeSalary, read=_sal_read,
                                    insert=_sal_check, update=_sal_q,
                                    check=perm_write("manage_payroll"), delete=_sal_q)
    p["payroll_runs"] = Policy(PayrollRun, read=_payroll_run_read,
                               insert=perm_write("manage_payroll"),
                               update=_perm_q("manage_payroll"),
                               check=perm_write("manage_payroll"),
                               delete=_perm_q("manage_payroll"))
    p["payroll_entries"] = Policy(PayrollEntry, read=_pe_read,
                                  insert=perm_write("manage_payroll"),
                                  update=_perm_q("manage_payroll"),
                                  check=perm_write("manage_payroll"),
                                  delete=_perm_q("manage_payroll"))

    return p


# ---------------------------------------------------------------------------
# small support predicates referenced by the registry builders above
# ---------------------------------------------------------------------------

def _perm_q(code):
    return lambda user: Q() if perm(user, code) else Q(pk=None)


def _or_perm(*codes):
    def ok(user, data):
        return any(perm(user, c) for c in codes)
    return ok


def _or_perm_q(*codes):
    def q(user):
        return Q() if any(perm(user, c) for c in codes) else Q(pk=None)
    return q


def _is_hr_q(user) -> Q:
    return Q() if rbac.is_hr(user) else Q(pk=None)


def _scoped_bool(field, code):
    def ok(user, data):
        if not perm(user, code):
            return False
        eid = data.get(field)
        return eid is None or rbac.can_view_employee(user, eid)
    return ok


def scoped_write_bool(field, code):
    return _scoped_bool(field, code)


def _lb_bool(user, data):
    if not perm(user, "manage_leave"):
        return False
    eid = data.get("employee_id")
    return eid is None or rbac.can_view_employee(user, eid)


def _lb_q(user):
    if not perm(user, "manage_leave"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _ai_user(user, data):
    return _s(data.get("user_id")) == _s(user.pk)


def _ai_conv_q(user):
    return Q(user_id=user.pk)


def _ai_msg_q(user):
    return Q(conversation__user_id=user.pk)


def _ai_msg_bool(user, data):
    from hr.models.ai import AiConversation
    cid = data.get("conversation_id")
    return bool(cid) and AiConversation.objects.filter(pk=cid, user_id=user.pk).exists()


def _ottempl_read(user):
    if perm(user, "view_onboarding") or perm(user, "manage_onboarding"):
        return Q()
    return Q(pk=None)


def _life_check(user, old, new):
    return perm(user, "manage_employee") and rbac.can_view_employee(user, new.get("employee_id"))


def _off_check(user, old, new):
    if not perm(user, "manage_offboarding"):
        return False
    return rbac.can_view_employee(user, new.get("employee_id"))


def _fb_write_q(user):
    return Q() if perm(user, "manage_recruitment") else Q(reviewer_id=None)


def _sas_bool(user, data):
    if not perm(user, "manage_shifts"):
        return False
    eid = data.get("employee_id")
    return eid is None or rbac.can_view_employee(user, eid)


def _sas_check(user, old, new):
    return perm(user, "manage_shifts")


def _acorr_manage_q(user):
    if not perm(user, "manage_attendance"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _letters_q(user):
    if not perm(user, "manage_letters"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _letters_check(user, old, new):
    if not perm(user, "manage_letters"):
        return False
    return rbac.can_view_employee(user, new.get("employee_id"))


def _asset_assign_q(user):
    if not perm(user, "manage_assets"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _asset_assign_read(user):
    if perm(user, "view_assets"):
        return Q()
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _asset_assign_check(user, old, new):
    return _scoped_bool("employee_id", "manage_assets")(user, new)


def _training_q(user):
    if not perm(user, "manage_training"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _training_check(user, old, new):
    if not perm(user, "manage_training"):
        return False
    return rbac.can_view_employee(user, new.get("employee_id"))


def _compliance_q(user):
    if not perm(user, "manage_compliance"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _compliance_check(user, old, new):
    if not perm(user, "manage_compliance"):
        return False
    return rbac.can_view_employee(user, new.get("employee_id"))


def _sal_q(user):
    if not perm(user, "manage_payroll"):
        return Q(pk=None)
    ids = _emp_ids(user)
    return Q(employee_id__in=ids) if ids else Q(pk=None)


def _sal_check(user, old, new):
    return perm(user, "manage_payroll")


POLICIES = build_registry()


def get_policy(table: str) -> Policy | None:
    return POLICIES.get(table)