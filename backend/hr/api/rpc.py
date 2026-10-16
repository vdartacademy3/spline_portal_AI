"""RPC dispatcher — mirrors the `security definer` SQL functions.

Serves `/api/v1/rpc/{fn}/`. The functions the frontend calls (via
`supabase.rpc(...)`) are implemented 1:1 against `hr.rbac` and the models:

  has_role / has_permission / is_hr / is_admin / is_manager /
  is_self_employee / current_employee_id / current_organization_id /
  in_my_org / can_view_employee / can_manage_employee /
  can_place_employee / match_kb_chunks / notify_hr

As with PostgREST the `_user_id` argument is honoured, but only when it names
the caller (or an admin / the service role) to avoid privilege escalation.
"""

from __future__ import annotations

import re

from django.contrib.auth import get_user_model
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import APIException

import hr.rbac as rbac
from hr.auth import BearerAuth

# RPC functions the careers site calls without a session (like the SQL
# `security definer` functions were marked stable + no RLS for guests).
PUBLIC_RPCS = {"public_job_list", "public_job_detail"}


def _pgrst_error(message, code, http_status):
    err = APIException(detail=message, code=str(code))
    err.status_code = int(http_status)
    raise err


class RpcView(APIView):
    authentication_classes = [BearerAuth]

    def dispatch(self, request, *args, **kwargs):
        self._fn = kwargs.get("fn")
        if self._fn in PUBLIC_RPCS:
            self.permission_classes = [AllowAny]
        return super().dispatch(request, *args, **kwargs)

    def _claim(self, request, args):
        """Bound the acting user: honour the args only for the caller/admin/service."""
        user = request.user
        if getattr(user, "is_service_role", False):
            return None
        uid = args.get("_user_id") or args.get("user_id")
        if uid and str(uid) != str(user.pk):
            if not (rbac.is_admin(user) or rbac.has_role(user, "super_admin")):
                _pgrst_error(
                    "You must use your own user id for this operation", "42501", 403
                )
            User = get_user_model()
            try:
                return User.objects.get(pk=uid)
            except (User.DoesNotExist, ValueError):
                return None
        return user

    def post(self, request, fn):
        args = request.data or {}
        if not isinstance(args, dict):
            args = dict(request.data[0]) if request.data else {}

        return self._dispatch(request, fn, args)

    def get(self, request, fn):
        args = {k: v[0] for k, v in request.query_params.lists()}
        return self._dispatch(request, fn, args)

    def _dispatch(self, request, fn, args):
        handler = RPC_FUNCTIONS.get(fn)
        if handler is None:
            _pgrst_error(f'Could not find the function "{fn}"', "PGRST404", 404)
        acting = self._claim(request, args)
        result = handler(request, acting, args)
        return Response(result)


# ---------------------------------------------------------------------------
# function implementations
# ---------------------------------------------------------------------------

def _required(args, *names):
    missing = [n for n in names if args.get(n) is None]
    if missing:
        _pgrst_error(
            f'missing required argument: {", ".join(missing)}', "PGRST200", 400
        )


def _has_role(request, acting, args):
    _required(args, "_role")
    rh = _as_user(acting, args)
    return rbac.has_role(rh, args["_role"])


def _has_permission(request, acting, args):
    _required(args, "_code")
    rh = _as_user(acting, args)
    return rbac.has_permission(rh, args["_code"])


def _is_hr(request, acting, args):
    return rbac.is_hr(_as_user(acting, args))


def _is_admin(request, acting, args):
    return rbac.is_admin(_as_user(acting, args))


def _is_manager(request, acting, args):
    return rbac.is_manager(_as_user(acting, args))


def _current_employee_id(request, acting, args):
    rh = _as_user(acting, args)
    return rbac.current_employee_id(rh.pk if rh is not None else None)


def _current_employee(request, acting, args):
    rh = _as_user(acting, args)
    emp = rbac.current_employee(rh) if rh is not None else None
    if emp is None:
        return {"id": None}
    return {
        "id": str(emp.pk),
        "first_name": emp.first_name,
        "last_name": emp.last_name,
        "work_email": emp.work_email,
        "organization_id": str(emp.organization_id) if emp.organization_id else None,
        "legal_entity_id": str(emp.legal_entity_id) if emp.legal_entity_id else None,
        "location_id": str(emp.location_id) if emp.location_id else None,
        "department_id": str(emp.department_id) if emp.department_id else None,
        "designation": emp.designation,
        "department_name": emp.department.name if emp.department_id else None,
    }


def _current_organization_id(request, acting, args):
    rh = _as_user(acting, args)
    return rbac.current_organization_id(rh) if rh is not None else None


def _in_my_org(request, acting, args):
    _required(args, "_organization_id")
    rh = _as_user(acting, args)
    return rbac.in_my_org(rh, args["_organization_id"])


def _is_self_employee(request, acting, args):
    _required(args, "_employee_id")
    rh = _as_user(acting, args)
    return rbac.is_self_employee(rh, args["_employee_id"])


def _can_view_employee(request, acting, args):
    _required(args, "_employee_id")
    rh = _as_user(acting, args)
    return rbac.can_view_employee(rh, args["_employee_id"])


def _can_manage_employee(request, acting, args):
    _required(args, "_employee_id")
    rh = _as_user(acting, args)
    return rbac.can_manage_employee(rh, args["_employee_id"])


def _can_place_employee(request, acting, args):
    rh = _as_user(acting, args)
    return rbac.can_place_employee(
        rh,
        args.get("_organization_id"),
        args.get("_legal_entity_id"),
        args.get("_location_id"),
        args.get("_department_id"),
    )


def _user_scope(request, acting, args):
    rh = _as_user(acting, args)
    return rbac.user_scope(rh)


def _reports_of(request, acting, args):
    _required(args, "_manager_employee_id")
    return rbac.reports_of(str(args["_manager_employee_id"]))


# ---------------------------------------------------------------------------
# public careers functions (anonymous, like the SQL `security definer` RPCs)
# ---------------------------------------------------------------------------

def _job_summary(r, detail=False):
    from hr.models.recruitment import JobRequisition  # noqa: F401

    loc = r.location
    out = {
        "slug": r.slug,
        "title": r.title,
        "department": r.department.name if r.department_id else None,
        "location": loc.name if loc else None,
        "city": getattr(loc, "city", None) if loc else None,
        "country": getattr(loc, "country", None) if loc else None,
        "employment_type": r.employment_type,
        "work_mode": r.work_mode,
        "experience_min": r.experience_min,
        "experience_max": r.experience_max,
        "skills": r.skills if r.skills else [],
        "description": r.description,
        "published_at": r.published_at.isoformat() if r.published_at else None,
    }
    if detail:
        out.update(
            {
                "responsibilities": r.responsibilities,
                "requirements": r.requirements,
                "qualifications": r.qualifications,
                "openings": r.openings,
            }
        )
    return out


def _public_job_list(request, acting, args):
    from hr.models.recruitment import JobRequisition

    rows = (
        JobRequisition.objects.filter(status="published", published_at__isnull=False)
        .select_related("department", "location")
        .order_by("-published_at")[:100]
    )
    return [_job_summary(r) for r in rows]


def _public_job_detail(request, acting, args):
    from hr.models.recruitment import JobRequisition

    slug = args.get("_slug")
    if not slug:
        return []
    row = (
        JobRequisition.objects.filter(slug=slug, status="published")
        .select_related("department", "location")
        .first()
    )
    if row is None:
        return []
    return [_job_summary(row, detail=True)]


# ---------------------------------------------------------------------------
# AI assistance / notifications
# ---------------------------------------------------------------------------

def _match_kb_chunks(request, acting, args):
    """Semantic-search fallback when no pgvector table is available.

    The real migration stored OpenAI embeddings in `kb_chunks.embedding`; the
    Django model keeps the column as JSON so keyword ranking is used instead.
    """
    from hr.models.knowledge import KbChunk

    limit = int(args.get("match_count") or 3)
    query = str(args.get("_query") or args.get("query") or "")
    embedding = args.get("query_embedding")

    qs = KbChunk.objects.filter(document__status="published").order_by("chunk_index")
    chunks = list(qs[:200])
    if not chunks:
        return []

    if embedding and not query:
        # cosine similarity against numeric embeddings when present
        try:
            vec = _parse_embedding(embedding)
            scored = []
            import math

            for c in chunks:
                e = _chunk_embedding(c)
                if not e:
                    continue
                sim = _cosine(vec, e)
                if sim is not None:
                    scored.append((sim, c))
            scored.sort(key=lambda item: item[0], reverse=True)
            return [
                _kb_row(c, s) for s, c in scored[:limit]
            ]
        except Exception:  # noqa: BLE001 - malformed embedding -> keyword path
            pass

    tokens = _tokens(query)
    if not tokens:
        # no query text/embedding: mirror `knowledge.ts` fallback (first chunks)
        return [_kb_row(c, None) for c in chunks[:limit]]
    scored = []
    for c in chunks:
        hay = f"{c.heading or ''} {c.content} {c.document.title or ''}"
        hits = sum(hay.lower().count(t) for t in tokens)
        if hits:
            scored.append((hits, c))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [_kb_row(c, None) for _, c in scored[:limit]]


def _parse_embedding(value):
    if isinstance(value, str):
        return [float(x) for x in re.findall(r"-?\d+\.?\d*(?:[eE][-+]?\d+)?", value)[:1536]]
    return [float(x) for x in value]


def _chunk_embedding(chunk):
    """Normalise the stored `kb_chunks.embedding` (list, dict or JSON string)."""
    import json

    e = chunk.embedding or []
    if isinstance(e, str):
        try:
            e = json.loads(e)
        except ValueError:
            return []
    if isinstance(e, dict):
        e = e.get("data") or []
    try:
        return [float(x) for x in e]
    except (TypeError, ValueError):
        return []


def _cosine(a, b):
    if len(a) != len(b) or not a:
        return None
    import math

    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return None
    return dot / (na * nb)


def _tokens(text: str):
    return [t.lower() for t in re.findall(r"[\w'-]+", text or "") if len(t) > 1]


def _kb_row(chunk, similarity):
    return {
        "id": str(chunk.pk),
        "document_id": str(chunk.document_id),
        "document_title": chunk.document.title,
        "heading": chunk.heading,
        "chunk_index": chunk.chunk_index,
        "content": chunk.content,
        "similarity": similarity,
    }


def _notify_hr(request, acting, args):
    """Broadcast a notification to every HR-role user."""
    from django.contrib.auth import get_user_model
    from hr.models.ops import Notification
    from hr.models.core import AppRole, UserRole

    if getattr(request.user, "is_service_role", False) is False and not rbac.is_hr(request.user):
        _pgrst_error("Only HR users may broadcast notifications", "42501", 403)

    title = args.get("_title") or "Notification"
    body = args.get("_body") or ""
    category = args.get("_category") or "general"
    link = args.get("_link") or "/"

    targets = list(
        UserRole.objects.filter(role__in=rbac.HR_ROLES).values_list("user_id", flat=True)
    )
    Notification.objects.bulk_create(
        [Notification(user_id=uid, title=title, body=body, category=category, link=link)
         for uid in targets]
    )
    return {"ok": True, "users": len(targets)}


# ---------------------------------------------------------------------------

def _as_user(acting, args):
    """Resolve the effective AppUser for the `_user_id` argument."""
    if acting is not None:
        return acting
    uid = args.get("_user_id") or args.get("user_id")
    if not uid:
        return None
    User = get_user_model()
    try:
        return User.objects.get(pk=uid)
    except (User.DoesNotExist, ValueError):
        return None


RPC_FUNCTIONS = {
    "has_role": _has_role,
    "has_permission": _has_permission,
    "is_hr": _is_hr,
    "is_admin": _is_admin,
    "is_manager": _is_manager,
    "current_employee_id": _current_employee_id,
    "current_employee": _current_employee,
    "current_organization_id": _current_organization_id,
    "in_my_org": _in_my_org,
    "is_self_employee": _is_self_employee,
    "can_view_employee": _can_view_employee,
    "can_manage_employee": _can_manage_employee,
    "can_place_employee": _can_place_employee,
    "user_scope": _user_scope,
    "reports_of": _reports_of,
    "match_kb_chunks": _match_kb_chunks,
    "notify_hr": _notify_hr,
    "public_job_list": _public_job_list,
    "public_job_detail": _public_job_detail,
}