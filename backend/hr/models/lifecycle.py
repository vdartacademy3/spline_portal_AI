import uuid

from django.db import models

from hr.models.core import Employee, Organization
from hr.models.recruitment import Candidate


class OnboardingTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "onboarding_templates"


class OnboardingTemplateTask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        OnboardingTemplate, on_delete=models.CASCADE, db_column="template_id"
    )
    title = models.CharField(max_length=255)
    owner = models.CharField(max_length=64, default="hr")
    due_in_days = models.IntegerField(default=0)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = "onboarding_template_tasks"


class OnboardingTask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="employee_id",
        related_name="onboarding_tasks",
    )
    candidate = models.ForeignKey(
        Candidate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="candidate_id",
        related_name="+",
    )
    title = models.CharField(max_length=255)
    owner = models.CharField(max_length=64, null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "onboarding_tasks"


class Offboarding(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    exit_type = models.CharField(max_length=32, default="resignation")
    reason = models.TextField(null=True, blank=True)
    notice_start_date = models.DateField(auto_now_add=True)
    last_working_day = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, default="initiated")
    exit_interview_notes = models.TextField(null=True, blank=True)
    final_settlement_note = models.TextField(null=True, blank=True)
    initiated_by = models.UUIDField(null=True, blank=True)
    completed_by = models.UUIDField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "offboardings"
        constraints = [models.UniqueConstraint(fields=["employee"], name="offboarding_emp_key")]


class ExitChecklistItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offboarding = models.ForeignKey(
        Offboarding, on_delete=models.CASCADE, db_column="offboarding_id"
    )
    category = models.CharField(max_length=64, default="hr")
    title = models.CharField(max_length=255)
    owner = models.CharField(max_length=64, default="hr")
    status = models.CharField(max_length=32, default="pending")
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exit_checklist_items"


class EmployeeLifecycleEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    event_type = models.CharField(max_length=64)
    effective_date = models.DateField(auto_now_add=True)
    previous_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    actor = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employee_lifecycle_events"