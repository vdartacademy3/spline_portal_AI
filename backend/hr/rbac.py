"""RBAC / object-level authorization engine.

Mirrors the Supabase RLS functions (0000-0010 migrations) as a pure-Python
service so identical authorization happens server-side in Django:

  has_role / is_hr / is_admin / has_permission / user_scope /
  current_employee_id / current_organization_id / reports_of /
  can_view_employee / can_manage_employee / can_place_employee /
  in_my_org / is_manager / is_self_employee

Every public method takes the acting Django user and behaves exactly like the
corresponding `security definer` SQL function.
"""

from __future__ import annotations

from functools import lru_cache

from django.contrib.auth import get_user_model
from django.db.models import Q

from hr.models.core import AppRole, DataScope, Employee, RolePermission, UserRole

HR_ROLES = (AppRole.SUPER_ADMIN, AppRole.HR_ADMIN, AppRole.HR_STAFF)
ADMIN_ROLES = (AppRole.SUPER_ADMIN, AppRole.HR_ADMIN)
MANAGER_ROLES = (AppRole.SUPER_ADMIN, AppRole.HR_ADMIN, AppRole.HR_STAFF, AppRole.MANAGER)

# widest-first ordering mirrors the SQL `order by case scope ... desc`
_SCOPE_ORDER = {
    DataScope.GLOBAL: 7,
    DataScope.ORGANIZATION: 6,
    DataScope.LEGAL_ENTITY: 5,
    DataScope.LOCATION: 4,
    DataScope.DEPARTMENT: 3,
    DataScope.DIRECT_REPORTS: 2,
    DataScope.SELF: 1,
}


def has_role(user, role: str) -> bool:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    return UserRole.objects.filter(user_id=user.pk, role=role).exists()


def is_hr(user) -> bool:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    return UserRole.objects.filter(user_id=user.pk, role__in=HR_ROLES).exists()


def is_admin(user) -> bool:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    return UserRole.objects.filter(user_id=user.pk, role__in=ADMIN_ROLES).exists()


def is_manager(user) -> bool:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    return UserRole.objects.filter(user_id=user.pk, role__in=MANAGER_ROLES).exists()


@lru_cache(maxsize=256)
def _permission_codes(user_id) -> frozenset[str]:
    roles = list(UserRole.objects.filter(user_id=user_id).values_list("role", flat=True))
    if not roles:
        return frozenset()
    codes = RolePermission.objects.filter(role__in=roles).values_list(
        "permission_id", flat=True
    )
    return frozenset(codes)


def has_permission(user, code: str) -> bool:
    """super_admin is implicitly granted everything (mirrors RLS)."""
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    if has_role(user, AppRole.SUPER_ADMIN):
        return True
    return code in _permission_codes(user.pk)


def user_scope(user) -> str:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return DataScope.SELF
    scopes = list(
        UserRole.objects.filter(user_id=user.pk).values_list("scope", flat=True)
    )
    if not scopes:
        return DataScope.SELF
    return max(scopes, key=lambda s: _SCOPE_ORDER.get(s, 1))


def current_employee_id(user_id) -> str | None:
    emp = Employee.objects.filter(user_id=user_id).values_list("pk", flat=True).first()
    return str(emp) if emp else None


def current_employee(user) -> Employee | None:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return None
    return Employee.objects.filter(user_id=user.pk).first()


def current_organization_id(user) -> str | None:
    emp = current_employee(user)
    return str(emp.organization_id) if emp and emp.organization_id else None


def reports_of(manager_employee_id, _seen=None):
    """Recursive subordinates (direct + indirect reporting tree)."""
    if _seen is None:
        _seen = set()
    if not manager_employee_id or manager_employee_id in _seen:
        return []
    _seen.add(manager_employee_id)
    ids: list[str] = []
    direct = list(
        Employee.objects.filter(manager_id=manager_employee_id).values_list("pk", flat=True)
    )
    for rid in direct:
        ids.append(str(rid))
        ids.extend(reports_of(str(rid), _seen))
    return ids


def _scope_matches(user, employee: Employee) -> bool:
    """Evaluates the data-scope branch of can_view_employee."""
    scope = user_scope(user)
    me = current_employee(user)

    if scope == DataScope.GLOBAL:
        return True
    if scope == DataScope.ORGANIZATION:
        return bool(
            me and me.organization_id is not None and me.organization_id == employee.organization_id
        )
    if scope == DataScope.LEGAL_ENTITY:
        return bool(
            me and me.legal_entity_id is not None and me.legal_entity_id == employee.legal_entity_id
        )
    if scope == DataScope.LOCATION:
        return bool(me and me.location_id is not None and me.location_id == employee.location_id)
    if scope == DataScope.DEPARTMENT:
        return bool(
            me and me.department_id is not None and me.department_id == employee.department_id
        )
    if scope == DataScope.DIRECT_REPORTS:
        if me is None:
            return False
        return str(employee.pk) in reports_of(str(me.pk))
    return False


def can_view_employee(user, employee_id) -> bool:
    """RLS `can_view_employee` — the core row-level read gate."""
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    try:
        employee = Employee.objects.get(pk=employee_id)
    except (Employee.DoesNotExist, ValueError):
        return False
    if str(employee.user_id) == str(user.pk):
        return True
    if has_role(user, AppRole.SUPER_ADMIN):
        return True
    if not has_permission(user, "view_employee"):
        return False
    return _scope_matches(user, employee)


def can_manage_employee(user, employee_id) -> bool:
    return has_permission(user, "manage_employee") and can_view_employee(user, employee_id)


def can_place_employee(user, organization_id, legal_entity_id, location_id, department_id) -> bool:
    """RLS `can_place_employee` — whether a target attribute tuple is inside scope."""
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    if has_role(user, AppRole.SUPER_ADMIN):
        return True
    if not has_permission(user, "manage_employee"):
        return False
    scope = user_scope(user)
    if scope == DataScope.GLOBAL:
        return True
    me = current_employee(user)
    if me is None:
        return False
    if scope == DataScope.ORGANIZATION:
        return bool(me.organization_id and me.organization_id == organization_id)
    if scope == DataScope.LEGAL_ENTITY:
        return bool(me.legal_entity_id and me.legal_entity_id == legal_entity_id)
    if scope == DataScope.LOCATION:
        return bool(me.location_id and me.location_id == location_id)
    if scope == DataScope.DEPARTMENT:
        return bool(me.department_id and me.department_id == department_id)
    return False


def in_my_org(user, organization_id) -> bool:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    if has_role(user, AppRole.SUPER_ADMIN):
        return True
    if user_scope(user) == DataScope.GLOBAL:
        return True
    if not organization_id:
        return False
    return organization_id == current_organization_id(user)


def is_self_employee(user, employee_id) -> bool:
    if user is None or getattr(user, "is_anonymous", False) is True:
        return False
    me = current_employee_id(user.pk)
    return bool(me and employee_id and me == str(employee_id))


def can_view_employee_q(user) -> Q:
    """A Django Q() that pre-filters `Employee` rows the user may view.

    Equivalent to the RLS `emp scoped read` policy, computed once per query
    instead of per row.
    """
    if user is None or getattr(user, "is_anonymous", False) is True:
        return Q(pk=None)
    me = current_employee(user)

    if has_role(user, AppRole.SUPER_ADMIN):
        return Q()

    self_cond = Q(user_id=user.pk)
    if not has_permission(user, "view_employee"):
        return self_cond

    scope = user_scope(user)
    if scope == DataScope.GLOBAL:
        return Q()
    if me is None:
        return self_cond

    if scope == DataScope.ORGANIZATION:
        scope_cond = Q(organization_id=me.organization_id)
    elif scope == DataScope.LEGAL_ENTITY:
        scope_cond = Q(legal_entity_id=me.legal_entity_id)
    elif scope == DataScope.LOCATION:
        scope_cond = Q(location_id=me.location_id)
    elif scope == DataScope.DEPARTMENT:
        scope_cond = Q(department_id=me.department_id)
    elif scope == DataScope.DIRECT_REPORTS:
        scope_cond = Q(pk__in=reports_of(str(me.pk)))
    else:
        scope_cond = Q(pk=None)

    return self_cond | scope_cond