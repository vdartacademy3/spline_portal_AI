import uuid

from django.db import models

from hr.models.core import AppUser


class AiConversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="user_id")
    title = models.CharField(max_length=255, default="New conversation")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_conversations"


class AiMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        AiConversation, on_delete=models.CASCADE, db_column="conversation_id"
    )
    role = models.CharField(max_length=32)
    content = models.TextField()
    payload = models.JSONField(null=True, blank=True)
    sources = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_messages"


class AiAction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action_type = models.CharField(max_length=128)
    title = models.CharField(max_length=255)
    reason = models.TextField(null=True, blank=True)
    target_summary = models.TextField(null=True, blank=True)
    proposed_payload = models.JSONField(null=True, blank=True)
    risk_level = models.CharField(max_length=32, default="low")
    status = models.CharField(max_length=32, default="pending")
    requested_by = models.UUIDField(null=True, blank=True)
    approved_by = models.UUIDField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_actions"


class AiInsight(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    detail = models.TextField(null=True, blank=True)
    severity = models.CharField(max_length=32, default="info")
    recommended_action = models.TextField(null=True, blank=True)
    link = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ai_insights"