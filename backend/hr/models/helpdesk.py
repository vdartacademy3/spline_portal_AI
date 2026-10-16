import uuid

from django.db import models

from hr.models.core import Department, Employee, Organization


class HelpdeskTicket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket_code = models.CharField(max_length=32, unique=True, null=True, blank=True)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="department_id",
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="employee_id",
        related_name="+",
    )
    created_by = models.UUIDField(null=True, blank=True)
    category = models.CharField(max_length=64, default="general")
    subject = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    priority = models.CharField(max_length=32, default="medium")
    status = models.CharField(max_length=32, default="open")
    assigned_to = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="assigned_to",
        related_name="+",
    )
    sla_due_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)
    escalation_level = models.IntegerField(default=0)
    resolution_summary = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "helpdesk_tickets"


class TicketComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(HelpdeskTicket, on_delete=models.CASCADE, db_column="ticket_id")
    author = models.UUIDField(null=True, blank=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ticket_comments"


class TicketStatusHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(HelpdeskTicket, on_delete=models.CASCADE, db_column="ticket_id")
    from_status = models.CharField(max_length=32, null=True, blank=True)
    to_status = models.CharField(max_length=32)
    changed_by = models.UUIDField(null=True, blank=True)
    note = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ticket_status_history"


class TicketInternalNote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(HelpdeskTicket, on_delete=models.CASCADE, db_column="ticket_id")
    author = models.UUIDField(null=True, blank=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ticket_internal_notes"


class TicketAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(HelpdeskTicket, on_delete=models.CASCADE, db_column="ticket_id")
    name = models.CharField(max_length=255)
    file_path = models.TextField()
    uploaded_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ticket_attachments"