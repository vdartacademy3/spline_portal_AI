import uuid

from django.db import models

from hr.models.core import Employee, Organization


class PerformanceCycle(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    name = models.CharField(max_length=255)
    period = models.CharField(max_length=64)
    start_date = models.DateField(auto_now_add=True)
    end_date = models.DateField(null=True, blank=True)
    review_start_date = models.DateField(null=True, blank=True)
    review_end_date = models.DateField(null=True, blank=True)
    self_review_required = models.BooleanField(default=True)
    status = models.CharField(max_length=32, default="draft")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "performance_cycles"


class Goal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    cycle = models.ForeignKey(
        PerformanceCycle,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="cycle_id",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    progress = models.IntegerField(default=0)
    status = models.CharField(max_length=32, default="in_progress")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "goals"


class PerformanceReview(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    reviewer = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="reviewer_id",
        related_name="+",
    )
    cycle = models.ForeignKey(
        PerformanceCycle,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="cycle_id",
    )
    period = models.CharField(max_length=64)
    rating = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    strengths = models.TextField(null=True, blank=True)
    improvements = models.TextField(null=True, blank=True)
    summary = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=32, default="draft")
    self_rating = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    self_strengths = models.TextField(null=True, blank=True)
    self_improvements = models.TextField(null=True, blank=True)
    self_summary = models.TextField(null=True, blank=True)
    self_submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    finalized_at = models.DateTimeField(null=True, blank=True)
    finalized_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "performance_reviews"