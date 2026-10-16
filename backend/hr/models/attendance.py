import uuid

from django.db import models

from hr.models.core import Employee, Organization


class Shift(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64)
    start_time = models.TimeField()
    end_time = models.TimeField()
    break_minutes = models.IntegerField(default=60)
    grace_minutes = models.IntegerField(default=30)
    overtime_after_minutes = models.IntegerField(default=0)
    # Weekly counterpart of `overtime_after_minutes`: the weekly overtime
    # qualifies only once the week's net working time exceeds the sum of the
    # scheduled days' required hours by more than this amount. The threshold
    # qualifies but is never subtracted from the excess.
    weekly_overtime_after_minutes = models.IntegerField(default=0)
    minimum_hours = models.DecimalField(max_digits=6, decimal_places=2, default=8)
    half_day_hours = models.DecimalField(max_digits=6, decimal_places=2, default=4)
    overnight = models.BooleanField(default=False)
    # Canonical 1-based, Monday-first weekday set: 1=Mon .. 7=Sun. The UI always
    # writes this form and a data migration (0008) canonicalized the legacy
    # 0-based Monday-first seeds (0=Mon .. 6=Sun). `src/lib/overtime.ts`
    # `normalizeScheduledDays` still parses a lingering 0-based array
    # defensively, but all new/updated rows must be stored 1-based.
    days_of_week = models.JSONField(default=list)
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "shifts"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="shifts_org_code_key"
            )
        ]


class EmployeeShiftAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    shift = models.ForeignKey(Shift, on_delete=models.CASCADE, db_column="shift_id")
    effective_from = models.DateField(auto_now_add=True)
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    assigned_by = models.UUIDField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employee_shift_assignments"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(is_active=False) | models.Q(effective_to__isnull=True),
                name="shift_assign_active_end",
            )
        ]


class AttendanceRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    work_date = models.DateField()
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=32, default="present")
    late_minutes = models.IntegerField(default=0)
    early_login_minutes = models.IntegerField(default=0)
    overtime_minutes = models.IntegerField(default=0)
    late_logout_minutes = models.IntegerField(default=0)
    early_departure_minutes = models.IntegerField(default=0)
    # Authoritative attendance duration in whole minutes, after the shift's
    # unpaid break is deducted exactly once. `work_hours` is kept in sync for
    # backward compatibility with existing decimal-hour consumers.
    work_minutes = models.IntegerField(null=True, blank=True)
    work_hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    is_half_day = models.BooleanField(default=False)
    source = models.CharField(max_length=32, default="manual")
    note = models.TextField(null=True, blank=True)
    updated_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "attendance_records"
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "work_date"], name="attendance_emp_date_key"
            )
        ]


class AttendanceCorrection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    work_date = models.DateField()
    attendance = models.ForeignKey(
        AttendanceRecord,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="attendance_id",
    )
    requested_check_in = models.DateTimeField(null=True, blank=True)
    requested_check_out = models.DateTimeField(null=True, blank=True)
    requested_status = models.CharField(max_length=32, null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=32, default="pending")
    approver = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="approver_id",
        related_name="+",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "attendance_corrections"