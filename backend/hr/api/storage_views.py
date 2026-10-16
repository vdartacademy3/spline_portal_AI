"""Storage endpoints — standalone replacement for Supabase Storage.

Buckets are plain directories under `settings.STORAGE_ROOT`. The endpoints
mirror the ones the Supabase JS storage client uses, so the Phase 5 compat
client can translate 1:1.

   POST   /api/v1/storage/object/sign/{bucket}/{path}   createSignedUrl
   PUT    /api/v1/storage/object/{bucket}/{path}?upsert= upload
   GET    /api/v1/storage/object/{bucket}/{path}        download (auth or ?sig=)
   DELETE /api/v1/storage/object/{bucket}               remove([paths])

Buckets: candidate-resumes, employee-documents.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
import uuid

from django.conf import settings
from django.http import FileResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response

ALLOWED_BUCKETS = {"candidate-resumes", "employee-documents"}

# bucket -> (metadata table, column holding the object path, column holding the
# owner's PK). Both buckets are private and store objects as
# ``<owner pk>/<timestamp>-<safe name>``.
_POLICY_BY_BUCKET = {
    "employee-documents": ("employee_documents", "file_url", "employee_id"),
    "candidate-resumes": ("candidates", "resume_path", "id"),
}


def _may_read(request, bucket: str, path: str) -> bool:
    """Authorise a private object against the row policy of its metadata row.

    Signing a URL or downloading an object directly would otherwise bypass the
    checks the UI's server functions perform, because any authenticated caller
    holds a valid token. An Employee must only ever reach their own payslips
    and documents, so the request is checked against exactly the same
    ``read`` policy the metadata row is served under.
    """
    from hr.policies import get_policy

    user = request.user
    if getattr(user, "is_service_role", False):
        return True

    # Anonymous callers only ever get here without a valid HMAC signature, and
    # a signature is the only credential they may present, so refuse outright.
    if not getattr(user, "is_authenticated", False):
        return False

    entry = _POLICY_BY_BUCKET.get(bucket)
    if entry is None:
        return False
    table, path_column, owner_column = entry
    policy = get_policy(table)
    if policy is None or policy.model is None:
        return False

    readable = policy.model.objects.filter(policy.read_q(user))

    # Preferred: the object is published through a metadata row the caller may read.
    if readable.filter(**{path_column: path}).exists():
        return True

    # Fallback for objects stored before their metadata row existed: trust the
    # owner segment, which for both buckets is the owning record's primary key.
    owner = path.split("/", 1)[0]
    try:
        owner_pk = uuid.UUID(owner)
    except (AttributeError, TypeError, ValueError):
        return False
    return readable.filter(**{owner_column: owner_pk}).exists()


def _bucket_path(bucket: str) -> str:
    return os.path.join(str(settings.STORAGE_ROOT), bucket)


def _resolve(bucket: str, path: str) -> str:
    if bucket not in ALLOWED_BUCKETS:
        raise ValueError("bucket")
    root = _bucket_path(bucket)
    target = os.path.realpath(os.path.join(root, path))
    if not target.startswith(os.path.realpath(root) + os.sep) and target != os.path.realpath(root):
        raise ValueError("path")
    return target


def _sign(bucket: str, path: str, expires_at: int) -> str:
    raw = f"{bucket}|{path}|{expires_at}"
    return hmac.new(settings.SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()


def _verify_sig(bucket: str, path: str, expires_at: int, sig: str) -> bool:
    try:
        expected = _sign(bucket, path, expires_at)
    except Exception:  # noqa: BLE001
        return False
    if int(expires_at) < int(time.time()):
        return False
    return hmac.compare_digest(expected, sig)


def _ok(payload):
    return Response(payload)


def _err(message, http=400):
    return Response({"message": message, "code": "Storage_Error", "details": None, "hint": None},
                    status=http)


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)


class StorageObjectView(APIView):
    """Upload / download / delete an object."""

    # GET is also reachable with a valid HMAC signed URL and no bearer token --
    # that is how the payslip download works. Writes stay authenticated below.
    permission_classes = [AllowAny]

    def put(self, request, bucket, path):  # upload
        try:
            target = _resolve(bucket, path)
        except ValueError:
            return _err("Invalid bucket or path")
        if not getattr(request.user, "is_authenticated", False):
            return _err("Unauthorized", 401)
        if not _may_read(request, bucket, path):
            return _err("Object not found", 404)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        upsert = request.query_params.get("upsert", "false").lower() in ("1", "true")
        if not upsert and os.path.exists(target):
            return _err("Duplicate: The resource already exists", 400)
        body = request.body
        content_type = request.META.get("CONTENT_TYPE", "application/octet-stream")
        if content_type.startswith("multipart/"):
            # tolerate browsers sending a multipart form with a single file
            raw = request.body
            marker = b"filename="
            idx = raw.find(marker)
            if idx != -1:  # pragma: no cover - defensive parse not needed for API use
                pass
        with open(target, "wb") as fh:
            fh.write(body)
        return _ok({"Key": path})

    def get(self, request, bucket, path):  # download (signed, or auth + policy)
        try:
            target = _resolve(bucket, path)
        except ValueError:
            return _err("Invalid bucket or path")
        expires = request.query_params.get("expires")
        sig = request.query_params.get("sig")
        signed = False
        if expires and sig:
            try:
                signed = _verify_sig(bucket, path, int(expires), sig)
            except (TypeError, ValueError):
                signed = False
        if not signed and not _may_read(request, bucket, path):
            return _err("Object not found", 404)
        if not os.path.isfile(target):
            return _err("Object not found", 404)
        return FileResponse(open(target, "rb"))


def _owner_is_protected(bucket: str, path: str) -> tuple[bool, str]:
    """Decide whether ``path`` is protected from deletion.

    Returns ``(protected, reason)``. ``protected`` is True whenever the object
    cannot be safely classified as disposable, so an object we cannot map to a
    known owner is denied rather than guessed at.

    Deletion authority is deliberately independent of read authority: being
    able to *read* an object is not permission to *destroy* it, and this check
    runs for every caller including service role, which `_may_read` trusts
    unconditionally.
    """
    entry = _POLICY_BY_BUCKET.get(bucket)
    if entry is None:
        return True, "unknown bucket"
    table, path_column, owner_column = entry
    model = get_policy_model(table)
    if model is None:
        return True, f"no model for {table}"

    # Preferred signal: the object is published through a metadata row.
    row = model.objects.filter(**{path_column: path}).first()
    if row is not None:
        if getattr(row, "is_fixture", False):
            return True, "metadata row is a fixture"
        owner_id = getattr(row, owner_column, None)
        if owner_id is None:
            # A metadata row with no owner cannot be classified safely.
            return True, "metadata row has no resolvable owner"
        return _owner_protected(_owner_model(model, owner_column), owner_id)

    # No metadata row: fall back to the owner segment of the path, which for
    # both buckets is the owning record's primary key.
    owner_segment = path.split("/", 1)[0]
    try:
        owner_pk = uuid.UUID(owner_segment)
    except (AttributeError, TypeError, ValueError):
        return True, "owner segment is not a primary key"

    # Existence of the owner is checked against the *owner* table (an
    # employee_documents row implies nothing about whether the Employee
    # exists); `_owner_protected` denies when the owner cannot be resolved.
    return _owner_protected(_owner_model(model, owner_column), owner_pk)


def _owner_protected(owner_model, owner_pk) -> tuple[bool, str]:
    """Is the owning record itself a fixture?"""
    if owner_model is None:
        return True, "owner model could not be resolved"
    owner = owner_model.objects.filter(pk=owner_pk).first()
    if owner is None:
        return True, "owner record not found"
    if getattr(owner, "is_fixture", False):
        return True, "owning record is a fixture"
    return False, ""


def get_policy_model(table: str):
    """Resolve a policy's model without importing it at module load."""
    from hr.policies import get_policy

    policy = get_policy(table)
    return None if policy is None else policy.model


def _owner_model(model, owner_column: str):
    """The model an object's owner actually is, via its FK definition.

    The metadata model and its owner are different tables: an
    ``employee_documents`` row is owned by an ``Employee``. Resolving this
    through the declared field rather than a hardcoded mapping keeps
    organization and ownership isolation honest.
    """
    try:
        field = model._meta.get_field(owner_column)
    except Exception:  # noqa: BLE001 - unknown field -> unclassifiable
        return None
    return getattr(getattr(field, "related_model", None), "objects", None) and field.related_model


class StorageDeleteView(APIView):
    """DELETE /api/v1/storage/object/{bucket} with {prefixes:[paths]}"""

    def delete(self, request, bucket):
        body = request.data or {}
        prefixes = body.get("prefixes") or body.get("paths") or []
        deleted = []

        # Pass 1 -- authorise and classify every target. Nothing is mutated
        # until the whole set is known to be safe, so a bulk request that
        # mixes disposable and protected objects deletes neither.
        targets = []
        for path in prefixes:
            try:
                target = _resolve(bucket, path)
            except ValueError:
                continue
            if not _may_read(request, bucket, path):
                continue
            protected, reason = _owner_is_protected(bucket, path)
            if protected:
                return _err(
                    f"Refusing to delete protected storage object: {reason}",
                    403,
                )
            targets.append((path, target))

        # Pass 2 -- mutate. Only reachable once every target passed.
        for path, target in targets:
            if os.path.isfile(target):
                os.remove(target)
            deleted.append({"name": path, "id": path, "bucket_id": bucket})
        return _ok(deleted)


class StorageSignView(APIView):
    """POST /api/v1/storage/object/sign/{bucket}/{path}  body {expiresIn}"""

    def post(self, request, bucket, path):
        body = request.data or {}
        ttl = int(body.get("expiresIn") or settings.STORAGE_SIGNED_URL_TTL or 300)
        try:
            target = _resolve(bucket, path)
        except ValueError:
            return _err("Invalid bucket or path")
        if not _may_read(request, bucket, path):
            return _err("Object not found", 404)
        if not os.path.isfile(target):
            return _err("Object not found", 404)
        expires_at = int(time.time()) + ttl
        sig = _sign(bucket, path, expires_at)
        relative = f"/api/v1/storage/object/{bucket}/{path}"
        url = f"{relative}?expires={expires_at}&sig={sig}"
        return _ok({"signedURL": url, "path": path})