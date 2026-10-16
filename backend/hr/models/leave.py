import uuid

from django.db import models

from hr.models.core import Employee, Organization


class LeaveType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=32)
    annual_quota = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    paid = models.BooleanField(default=True)

    class Meta:
        db_table = "leave_types"


class LeavePolicy(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, db_column="leave_type_id")
    max_consecutive_days = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    carry_forward_max = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    accrual_period = models.CharField(max_length=32, default="annual")
    requires_approval = models.BooleanField(default=True)
    allow_half_day = models.BooleanField(default=False)
    allow_negative_balance = models.BooleanField(default=False)
    min_notice_days = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "leave_policies"
        constraints = [
            models.UniqueConstraint(
                fields=["leave_type"], name="leave_policies_leave_type_key"
            )
        ]


class CompanyHoliday(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    date = models.DateField()
    name = models.CharField(max_length=255, default="Holiday")
    optional = models.BooleanField(default=False)

    class Meta:
        db_table = "company_holidays"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "date"], name="company_holidays_org_date_key"
            )
        ]


class LeaveBalance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, db_column="leave_type_id")
    year = models.IntegerField()
    entitled = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    used = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        db_table = "leave_balances"
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "leave_type", "year"],
                name="leave_balances_unique_key",
            )
        ]


class LeaveRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    leave_type = models.ForeignKey(
        LeaveType, on_delete=models.RESTRICT, db_column="leave_type_id"
    )
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.DecimalField(max_digits=6, decimal_places=2, default=1)
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
    is_half_day = models.BooleanField(default=False)
    half_day_part = models.CharField(max_length=32, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "leave_requests"


class LeaveBalanceMovement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    leave_type = models.ForeignKey(
        LeaveType, on_delete=models.CASCADE, null=True, blank=True, db_column="leave_type_id"
    )
    year = models.IntegerField(null=True, blank=True)
    movement_type = models.CharField(max_length=32, default="adjustment")
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    note = models.TextField(null=True, blank=True)
    actor = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "leave_balance_movements"