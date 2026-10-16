"""Procedural trigger parity (port of the plpgsql triggers).

Mirrors the `security definer` trigger functions from the drizzle migrations so
the Django REST endpoint reproduces identical side effects on writes:

  0003  guard_leave_self_update        (raise + field pinning)
  0004  sync_leave_balance             (approved -> consume / revert -> restore)
  0004  notify_leave_event             (to manager / to requester)
  0004  notify_ticket_assignment       (to new assignee)
  0004  notify_onboarding_assignment   (to target employee)
  0000  handle_new_user                (profile + employee role + email linking)
  0008  validate_leave_request         (day count / overlap / balance checks)
"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone


class BusinessError(Exception):
    """Raised shape that the REST layer turns into a Supabase-style error."""

    def __init__(self, message: str, code: str = "P0001", details=None, hint=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details
        self.hint = hint


# ---------------------------------------------------------------------------
# leave request validation (0008)
# ---------------------------------------------------------------------------

def _working_days(start, end) -> int:
    n = 0
    day = start
    while day <= end:
        if day.weekday() < 5:  # Mon-Fri
            n += 1
        day += timedelta(days=1)
    return n


def validate_leave_request(row: dict, is_insert: bool) -> None:
    """Sets `days` and raises on every condition the trigger checked."""
    from datetime import date

    from hr.models.leave import LeaveBalance, LeaveRequest, LeaveType

    start = row.get("start_date")
    end = row.get("end_date")
    if isinstance(start, str):
        start = date.fromisoformat(start[:10])
        row["start_date"] = start
    if isinstance(end, str):
        end = date.fromisoformat(end[:10])
        row["end_date"] = end
    if start and end and end < start:
        raise BusinessError("The end date cannot be before the start date")

    days = _working_days(start, end)
    if days == 0:
        raise BusinessError("The selected dates contain no working days")
    row["days"] = days

    employee_id = row.get("employee_id")
    leave_type_id = row.get("leave_type_id")

    if is_insert and employee_id:
        overlapping = LeaveRequest.objects.filter(
            employee_id=employee_id,
            start_date__lte=end,
            end_date__gte=start,
        ).exclude(status="cancelled")
        if overlapping.exists():
            raise BusinessError("You already have a leave request covering these dates")

        year = start.year if start else timezone.now().year
        quota = None
        if leave_type_id:
            quota = (
                LeaveType.objects.filter(pk=leave_type_id).values_list("annual_quota", flat=True).first()
            )
        balance = LeaveBalance.objects.filter(
            employee_id=employee_id, leave_type_id=leave_type_id, year=year
        ).first()
        entitled = balance.entitled if balance else 0
        used = balance.used if balance else 0
        if entitled and entitled > 0 and (used + days) > entitled:
            raise BusinessError(
                f"Insufficient leave balance: {int(entitled - used)} day(s) remaining"
            )


# ---------------------------------------------------------------------------
# guard_leave_self_update (0003)
# ---------------------------------------------------------------------------

def guard_leave_self_update(user, old: dict, new: dict) -> None:
    """An employee may withdraw their own request but never decide it."""
    import hr.rbac as rbac

    if user is None or getattr(user, "is_anonymous", False):
        return
    if not rbac.is_self_employee(user, new.get("employee_id")):
        return
    if rbac.has_permission(user, "manage_leave"):
        return
    if new.get("status") is not None and new.get("status") != old.get("status"):
        if new["status"] != "cancelled":
            raise BusinessError("You cannot decide your own leave request")
    new["approver_id"] = old.get("approver_id")
    new["decided_at"] = old.get("decided_at")


# ---------------------------------------------------------------------------
# sync_leave_balance (0004)
# ---------------------------------------------------------------------------

def sync_leave_balance(old_status, new: dict) -> None:
    from hr.models.leave import LeaveBalance, LeaveType

    if old_status == new.get("status"):
        return
    year = new.get("start_date").year if new.get("start_date") else timezone.now().year
    employee_id = new.get("employee_id")
    leave_type_id = new.get("leave_type_id")
    days = new.get("days") or 0
    if not employee_id or not leave_type_id:
        return

    if new["status"] == "approved":
        quota = (
            LeaveType.objects.filter(pk=leave_type_id).values_list("annual_quota", flat=True).first()
        )
        balance, created = LeaveBalance.objects.get_or_create(
            employee_id=employee_id,
            leave_type_id=leave_type_id,
            year=year,
            defaults={"entitled": quota or 0, "used": days},
        )
        if not created:
            balance.used = (balance.used or 0) + days
            balance.save(update_fields=["used"])
    elif old_status == "approved":
        balance = LeaveBalance.objects.filter(
            employee_id=employee_id, leave_type_id=leave_type_id, year=year
        ).first()
        if balance:
            balance.used = max((balance.used or 0) - days, 0)
            balance.save(update_fields=["used"])


# ---------------------------------------------------------------------------
# notify_leave_event (0004)
# ---------------------------------------------------------------------------

def notify_leave_event(user, is_insert: bool, old: dict, new: dict) -> None:
    from hr.models.core import Employee
    from hr.models.ops import Notification

    employee = None
    try:
        employee = Employee.objects.select_related("manager").get(pk=new.get("employee_id"))
    except Employee.DoesNotExist:
        employee = None

    name = ""
    if employee:
        name = f"{employee.first_name or ''} {employee.last_name or ''}".strip()

    link = "/leave"
    if is_insert:
        if employee and employee.manager_id:
            try:
                Notification.objects.create(
                    user_id=employee.manager.user_id,
                    title="Leave request awaiting your decision",
                    body=f"{(name or 'An employee')} requested leave from "
                    f"{new.get('start_date')} to {new.get('end_date')}",
                    category="leave",
                    link=link,
                )
            except Exception:  # noqa: BLE001 - manager may have no user row
                pass
        return

    if old.get("status") != new.get("status") and employee and employee.user_id:
        note = new.get("decision_note")
        body = f"Dates {new.get('start_date')} to {new.get('end_date')}"
        if note:
            body += f" \u2014 {note}"
        try:
            Notification.objects.create(
                user_id=employee.user_id,
                title=f"Your leave request was {new.get('status')}",
                body=body,
                category="leave",
                link=link,
            )
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# notification triggers (0004)
# ---------------------------------------------------------------------------

def notify_ticket_assignment(old: dict, new: dict) -> None:
    from hr.models.core import Employee
    from hr.models.ops import Notification

    if not new.get("assigned_to_id") and not new.get("assigned_to"):
        return
    assigned = new.get("assigned_to_id") or new.get("assigned_to")
    if str(assigned) == str(old.get("assigned_to_id") or old.get("assigned_to")):
        return
    try:
        employee = Employee.objects.get(pk=assigned)
    except Employee.DoesNotExist:
        return
    if not employee.user_id:
        return
    Notification.objects.create(
        user_id=employee.user_id,
        title="A helpdesk ticket was assigned to you",
        body=f"{new.get('ticket_code') or ''}: {new.get('subject') or ''}".strip(),
        category="helpdesk",
        link="/helpdesk",
    )


def notify_onboarding_assignment(user, new: dict) -> None:
    from hr.models.core import Employee
    from hr.models.ops import Notification

    employee_id = new.get("employee_id")
    if not employee_id:
        return
    try:
        employee = Employee.objects.get(pk=employee_id)
    except Employee.DoesNotExist:
        return
    if not employee.user_id:
        return
    Notification.objects.create(
        user_id=employee.user_id,
        title="New onboarding task",
        body=new.get("title") or "",
        category="onboarding",
        link="/onboarding",
    )


# ---------------------------------------------------------------------------
# handle_new_user (0000)
# ---------------------------------------------------------------------------

def handle_new_user(user) -> None:
    """Create the profile row, default employee role, and link by work email."""
    from hr.models.core import AppRole, DataScope, Employee, Profile, UserRole

    first = getattr(user, "first_name", "") or ""
    last = getattr(user, "last_name", "") or ""
    computed = f"{first} {last}".strip()
    full_name = computed or getattr(user, "full_name", "") or user.email
    Profile.objects.get_or_create(id=user, defaults={"email": user.email, "full_name": full_name})
    UserRole.objects.get_or_create(
        user=user, role=AppRole.EMPLOYEE, defaults={"scope": DataScope.SELF}
    )
    Employee.objects.filter(
        work_email__iexact=user.email, user_id__isnull=True
    ).update(user_id=user.pk)


# ---------------------------------------------------------------------------
# helpers for the REST layer
# ---------------------------------------------------------------------------

BUSINESS_QUERY_TO_RANGE = {
    "start_date__lte": "start_date",
    "end_date__gte": "end_date",
}


def conflicts_leave(args: dict) -> bool:
    """Used by the RPC layer when clients ask for overlap checks."""
    from hr.models.leave import LeaveRequest

    return LeaveRequest.objects.filter(
        employee_id=args.get("employee_id"),
        start_date__lte=args.get("end_date"),
        end_date__gte=args.get("start_date"),
    ).exclude(status="cancelled").exclude(pk=args.get("exclude_id")).exists()