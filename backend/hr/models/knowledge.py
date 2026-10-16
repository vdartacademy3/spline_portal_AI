import uuid

from django.db import models


class KbDocument(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=64, default="policy")
    content = models.TextField()
    version = models.CharField(max_length=16, default="v1")
    status = models.CharField(max_length=32, default="published")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "kb_documents"


class KbChunk(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(KbDocument, on_delete=models.CASCADE, db_column="document_id")
    chunk_index = models.IntegerField(default=0)
    heading = models.CharField(max_length=255, null=True, blank=True)
    content = models.TextField()
    embedding = models.JSONField(null=True, blank=True)
    embedding_model = models.CharField(max_length=128, null=True, blank=True)
    content_hash = models.CharField(max_length=128, null=True, blank=True)
    embedded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "kb_chunks"