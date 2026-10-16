import uuid

from django.db import models

from hr.models.core import AppUser, Employee


class EmployeeDocument(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="employee_id",
        related_name="documents",
    )
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=64, default="other")
    file_url = models.TextField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    verification_status = models.CharField(max_length=32, default="pending")
    reviewer = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="reviewer_id",
        related_name="+",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_comment = models.TextField(null=True, blank=True)
    version = models.IntegerField(default=1)
    uploaded_by = models.UUIDField(null=True, blank=True)
    # See Employee.is_fixture. A seeded document is protected regardless of
    # which employee owns it, so storage guards do not depend on the owner.
    is_fixture = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employee_documents"


class DocumentVerification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        EmployeeDocument, on_delete=models.CASCADE, db_column="document_id"
    )
    action = models.CharField(max_length=64)
    reviewer = models.UUIDField(null=True, blank=True)
    comment = models.TextField(null=True, blank=True)
    previous_status = models.CharField(max_length=64, null=True, blank=True)
    new_status = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_verifications"


class GeneratedDocument(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.CharField(max_length=255, null=True, blank=True)
    title = models.CharField(max_length=255)
    body = models.TextField()
    employee = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="employee_id",
    )
    status = models.CharField(max_length=32, default="draft")
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "generated_documents"