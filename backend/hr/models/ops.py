import uuid

from django.db import models

from hr.models.core import AppUser, Department, Employee, Location, Organization


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="user_id")
    title = models.CharField(max_length=255)
    body = models.TextField(null=True, blank=True)
    category = models.CharField(max_length=64, default="general")
    link = models.CharField(max_length=255, null=True, blank=True)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        AppUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="user_id",
        related_name="+",
    )
    action = models.CharField(max_length=255)
    entity = models.CharField(max_length=128, null=True, blank=True)
    entity_id = models.CharField(max_length=128, null=True, blank=True)
    previous_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=32, default="success")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_logs"


class ProfileChangeRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    field = models.CharField(max_length=64)
    current_value = models.TextField(null=True, blank=True)
    requested_value = models.TextField()
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
        db_table = "profile_change_requests"


class ExpenseRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    category = models.CharField(max_length=64, default="travel")
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="USD")
    expense_date = models.DateField(auto_now_add=True)
    description = models.TextField(null=True, blank=True)
    receipt_path = models.TextField(null=True, blank=True)
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
    reimbursed_at = models.DateTimeField(null=True, blank=True)
    reimbursed_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "expense_requests"


class ExpensePolicy(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    category = models.CharField(max_length=64)
    max_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=8, default="USD")
    requires_receipt = models.BooleanField(default=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "expense_policies"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "category"], name="expense_policy_org_cat_key"
            )
        ]


class EmployeeLetter(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    letter_type = models.CharField(max_length=64, default="appointment_letter")
    title = models.CharField(max_length=255)
    content = models.TextField()
    status = models.CharField(max_length=32, default="draft")
    issued_by = models.UUIDField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employee_letters"


class CompanyAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=64, default="laptop")
    asset_tag = models.CharField(max_length=128, null=True, blank=True)
    serial_number = models.CharField(max_length=128, null=True, blank=True)
    purchase_date = models.DateField(null=True, blank=True)
    purchase_value = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=32, default="available")
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "company_assets"


class EmployeeAssetAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    asset = models.ForeignKey(CompanyAsset, on_delete=models.CASCADE, db_column="asset_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    assigned_by = models.UUIDField(null=True, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    expected_return = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, default="active")
    return_note = models.TextField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employee_asset_assignments"
        constraints = [
            models.UniqueConstraint(
                fields=["asset"],
                condition=models.Q(status="active"),
                name="asset_assign_active_key",
            )
        ]


class TrainingProgram(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    category = models.CharField(max_length=64, default="technical")
    mode = models.CharField(max_length=32, default="self_paced")
    duration_hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    provider = models.CharField(max_length=255, null=True, blank=True)
    external_url = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=32, default="draft")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "training_programs"


class TrainingSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, db_column="program_id")
    title = models.CharField(max_length=255)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    instructor = models.CharField(max_length=255, null=True, blank=True)
    location = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "training_sessions"


class EmployeeTraining(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    program = models.ForeignKey(TrainingProgram, on_delete=models.CASCADE, db_column="program_id")
    session = models.ForeignKey(
        TrainingSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="session_id",
    )
    enrolled_by = models.UUIDField(null=True, blank=True)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=32, default="not_started")
    completed_at = models.DateTimeField(null=True, blank=True)
    certificate = models.TextField(null=True, blank=True)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "employee_trainings"


class ComplianceItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=64, default="labor")
    description = models.TextField(null=True, blank=True)
    recurrence = models.CharField(max_length=32, default="none")
    default_due_in_days = models.IntegerField(default=30)
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "compliance_items"


class EmployeeCompliance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(ComplianceItem, on_delete=models.CASCADE, db_column="item_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    status = models.CharField(max_length=32, default="due")
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    evidence_url = models.TextField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employee_compliance"
        constraints = [
            models.UniqueConstraint(
                fields=["item", "employee"], name="employee_compliance_key"
            )
        ]


class EmployeeSalary(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, db_column="employee_id")
    effective_from = models.DateField(auto_now_add=True)
    basic = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    allowances = models.JSONField(default=dict)
    deductions = models.JSONField(default=dict)
    currency = models.CharField(max_length=8, default="USD")
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employee_salaries"


class PayrollRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=32, default="draft")
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "payroll_runs"


class PayrollEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, db_column="run_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    basic = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    allowances = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    deductions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    gross = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    net = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    status = models.CharField(max_length=32, default="included")
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payroll_entries"
        constraints = [
            models.UniqueConstraint(
                fields=["run", "employee"], name="payroll_entry_run_emp_key"
            )
        ]