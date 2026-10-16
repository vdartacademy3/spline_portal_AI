"""PostgREST-compatible table endpoint.

Serves `/api/v1/rest/{table}/` with the query dialect the `@supabase/supabase-js`
client already speaks, backed by the RLS policy engine:

  - GET    select=col[,embed(...)], filters `col=op.value`, `or=(...)`,
           `order=`, `limit=`, `offset=`, `Prefer: count=exact`,
           `Accept: application/vnd.pgrst.object+json` (single),
           `select=count`
  - POST   JSON object/array; `Prefer: return=representation`, `on_conflict=`,
           `Prefer: resolution=merge-duplicates|ignore-duplicates`
  - PATCH  filter-scoped update; RLS USING + WITH CHECK, trigger side effects
  - DELETE filter-scoped delete; RLS USING
  - HEAD   `Prefer: count=exact` -> Content-Range only

Every operation runs through `hr.policies` unless the caller is the service
role (which bypasses RLS exactly like PostgREST does).
"""

from __future__ import annotations

import datetime
import decimal
import json
import uuid

from django.db import models, transaction
from django.db.models import Q
from django.http import JsonResponse
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.renderers import JSONRenderer
from rest_framework.views import APIView

from hr.auth import BearerAuth
from hr.policies import get_policy
from hr.triggers import (
    guard_leave_self_update,
    notify_leave_event,
    notify_onboarding_assignment,
    notify_ticket_assignment,
    sync_leave_balance,
    validate_leave_request,
)

# ---------------------------------------------------------------------------
# PostgREST helpers
# ---------------------------------------------------------------------------

SINGLE_ACCEPT = "application/vnd.pgrst.object+json"


class _PgrstObjectRenderer(JSONRenderer):
    """Lets DRF content-negotiation accept the PostgREST `single` Accept type.

    Without this, DRF rejects `Accept: application/vnd.pgrst.object+json`
    with 406 before RestView.get ever runs.
    """

    media_type = SINGLE_ACCEPT
    format = "pgrst-object"


def _is_service(user) -> bool:
    return bool(getattr(user, "is_service_role", False))


def _prefer(request) -> str:
    return request.META.get("HTTP_PREFER", "")


def _prefer_flag(request, name: str) -> bool:
    return name in _prefer(request).replace(" ", "").split(",")


def _pgrst_error(message, code, http_status):
    """Raise a PostgREST-style error with the correct HTTP status code."""
    err = APIException(detail=message, code=str(code))
    err.status_code = int(http_status)
    raise err


def _deny_if_filtered_out(model, request, rows, is_service):
    """Reject a write the policy filtered away instead of reporting success.

    UPDATE/DELETE apply authorization as a queryset filter, so a denied row is
    indistinguishable from a target that matched nothing: both yield an empty
    result and a 204. When the policy removed rows that the request's own
    filters did match, the caller is not authorized -- that must surface as 403,
    not as a quiet success.
    """
    if is_service or rows:
        return
    visible = model.objects.all().filter(_collect_filters(request, model))
    if visible.exists():
        _pgrst_error(
            'permission denied for table', "42501", 403,
        )


def _content_range_response(data, offset, total):
    resp = JsonResponse(data, safe=False)
    if total is None:
        end = offset + len(data) - 1 if data else offset - 1
        resp["Content-Range"] = f"{offset}-{end}/*"
    else:
        end = offset + len(data) - 1 if data else offset - 1
        resp["Content-Range"] = f"{offset}-{end}/{total}"
    return resp


# ---------------------------------------------------------------------------
# column / value helpers
# ---------------------------------------------------------------------------

def _field_for_column(model, column):
    for f in list(model._meta.local_fields) + list(model._meta.local_many_to_many):
        if f.column == column or f.attname == column:
            return f
    return None


def _require_field(model, column):
    field = _field_for_column(model, column)
    if field is None:
        _pgrst_error(
            f'Could not find the "{column}" column in "{model._meta.db_table}" '
            'in the schema "public"',
            "PGRST205",
            400,
        )
    return field


def _coerce_raw(field, value):
    value = value.strip() if isinstance(value, str) else value
    if isinstance(field, models.DateTimeField):
        if isinstance(value, datetime.datetime):
            return value
        try:
            parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (ValueError, AttributeError) as exc:
            _pgrst_error(f"failed to parse timestamp '{value}'", "PGRST200", 400)
            raise exc
        return parsed
    if isinstance(field, models.DateField):
        if isinstance(value, datetime.datetime):
            return value.date()
        if isinstance(value, datetime.date):
            return value
        try:
            return datetime.date.fromisoformat(value[:10])
        except (ValueError, AttributeError):
            try:
                return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).date()
            except (ValueError, AttributeError) as exc:
                _pgrst_error(f"failed to parse date '{value}'", "PGRST200", 400)
                raise exc
    if isinstance(field, models.BooleanField):
        if isinstance(value, bool):
            return value
        low = str(value).lower()
        if low in ("true", "t", "1"):
            return True
        if low in ("false", "f", "0"):
            return False
        # Anything else must be rejected here. Left as a raw string it compiles
        # into a query PostgreSQL then refuses at execution time
        # (invalid input syntax for type boolean -> DataError -> HTTP 500).
        _pgrst_error(f"invalid input value for boolean: \"{value}\"", "22P02", 400)
    name = type(field).__name__
    if "Float" in name:
        try:
            return float(value)
        except (ValueError, TypeError) as exc:
            _pgrst_error(f"invalid input value for float: \"{value}\"", "22P02", 400)
            raise exc
    if isinstance(field, (models.ForeignKey, models.OneToOneField)):
        target = field.target_field
        if isinstance(target, models.UUIDField):
            try:
                return uuid.UUID(str(value)) if value else None
            except ValueError as exc:
                _pgrst_error(f"invalid input value for uuid: \"{value}\"", "22P02", 400)
                raise exc
        return _coerce_raw(target, value)
    name = type(field).__name__
    if name == "UUIDField":
        try:
            return uuid.UUID(str(value)) if value else None
        except ValueError as exc:
            _pgrst_error(f"invalid input value for uuid: \"{value}\"", "22P02", 400)
            raise exc
    if "Integer" in name:
        try:
            return int(value)
        except (ValueError, TypeError) as exc:
            _pgrst_error(f"invalid input value for integer: \"{value}\"", "22P02", 400)
            raise exc
    if "Decimal" in name:
        try:
            return decimal.Decimal(str(value))
        except decimal.InvalidOperation as exc:
            _pgrst_error(f"invalid input value for numeric: \"{value}\"", "22P02", 400)
            raise exc
    if isinstance(field, models.JSONField):
        return value
    return value


def _coerce_list(field, value):
    v = value.strip()
    if v.startswith("(") and v.endswith(")"):
        v = v[1:-1]
    return [
        _coerce_raw(field, item.strip()) for item in _split_top_level(v) if item.strip()
    ]


# ---------------------------------------------------------------------------
# filter parsing
# ---------------------------------------------------------------------------

_OPERATORS = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"}


def _split_top_level(text: str, sep=","):
    parts, depth, buf = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    return parts


def _pattern_q(qkey, value, mode):
    # PostgREST / supabase-js LIKE semantics: `*` is the multi-char wildcard
    # (and `_` a single char). Translate to Django/SQL `%` / `_` before matching.
    v = (value or "").replace("*", "%")
    ci = "i" in mode
    def lu(base):
        return base if ci else base
    if v.startswith("%") and v.endswith("%") and len(v) > 2:
        return Q(**{f"{qkey}__{'i' if ci else ''}contains": v[1:-1]})
    if v.endswith("%") and len(v) > 1:
        return Q(**{f"{qkey}__{'i' if ci else ''}startswith": v[:-1]})
    if v.startswith("%") and len(v) > 1:
        return Q(**{f"{qkey}__{'i' if ci else ''}endswith": v[1:]})
    if "%" not in v:
        return Q(**{f"{qkey}__{'i' if ci else ''}exact": v})
    return Q(**{f"{qkey}__{'i' if ci else ''}contains": v.strip("%")})


def _is_text_field(field):
    """True when LIKE/ILIKE is meaningful for this column.

    PostgreSQL has no `~~` operator for uuid/numeric/date columns, so building a
    pattern filter on one compiles fine and then fails at execution time with
    `operator does not exist: uuid ~~ unknown`, which surfaces as HTTP 500.
    """
    target = field
    if isinstance(field, (models.ForeignKey, models.OneToOneField)):
        target = field.target_field
    name = type(target).__name__
    if "Char" in name or "Text" in name:
        return True
    return False


def _reject_pattern_on_non_text(field, column, op):
    _pgrst_error(
        f'operator "{op}" is not supported for column "{column}" '
        "of a non-text type",
        "PGRST107",
        400,
    )


def _build_condition(model, column, op, value):
    field = _require_field(model, column)
    qkey = field.attname

    if op in ("like", "ilike") and not _is_text_field(field):
        _reject_pattern_on_non_text(field, column, op)

    if op == "in":
        vals = _coerce_list(field, value)
        if not vals:
            return Q(pk=None)
        return Q(**{f"{qkey}__in": vals})
    if op == "is":
        low = str(value).strip().lower()
        if low == "null":
            return Q(**{f"{qkey}__isnull": True})
        if low == "true":
            return Q(**{f"{qkey}": True})
        if low == "false":
            return Q(**{f"{qkey}": False})
        return Q(**{f"{qkey}": _coerce_raw(field, value)})
    if op == "ilike":
        return _pattern_q(qkey, value, "i")
    if op == "like":
        return _pattern_q(qkey, value, "")
    if op == "neq":
        return ~Q(**{f"{qkey}": _coerce_raw(field, value)})
    coerced = _coerce_raw(field, value)
    if op == "eq":
        return Q(**{f"{qkey}": coerced})
    return Q(**{f"{qkey}__{op}": coerced})


def _parse_condition(model, token, negate=False):
    token = token.strip()
    if token.startswith("not."):
        return _parse_condition(model, token[len("not."):], negate=True)
    if token.startswith("and(") and token.endswith(")"):
        q = Q()
        for part in _split_top_level(token[len("and("):-1]):
            q &= _parse_condition(model, part)
        return ~q if negate else q
    if token.startswith("or(") and token.endswith(")"):
        q = Q()
        for part in _split_top_level(token[len("or("):-1]):
            q |= _parse_condition(model, part)
        return ~q if negate else q
    if token.count(".") >= 2:
        column, op, value = token.split(".", 2)
        q = _build_condition(model, column, op, value)
        return ~q if negate else q
    field = _require_field(model, token)
    q = Q(**{field.attname: _coerce_raw(field, token)})
    return ~q if negate else q


def _collect_filters(request, model) -> Q:
    q = Q()
    for key, raw_values in request.query_params.lists():
        if key in ("select", "order", "limit", "offset", "on_conflict"):
            continue
        if key in ("or", "and"):
            for chunk in raw_values:
                inner = chunk[1:-1] if chunk.startswith("(") else chunk
                for cond in _split_top_level(inner):
                    cond_q = _parse_condition(model, cond)
                    if key == "or":
                        q |= cond_q
                    else:
                        q &= cond_q
            continue
        for value in raw_values:
            if value.startswith("not."):
                inner = value[len("not."):]
                op, _, rest = inner.partition(".")
                if op in _OPERATORS:
                    q &= ~_build_condition(model, key, op, rest)
                else:
                    q &= ~_build_condition(model, key, "eq", inner)
            elif value.count(".") >= 1 and value.split(".", 1)[0] in _OPERATORS:
                op, val = value.split(".", 1)
                q &= _build_condition(model, key, op, val)
            else:
                q &= _build_condition(model, key, "eq", value)
    return q


def _parse_order(request, model):
    order = request.query_params.get("order")
    if not order:
        return []
    out = []
    for chunk in _split_top_level(order):
        segs = chunk.split(".")
        column = segs[0]
        _require_field(model, column)
        opts = segs[1:]
        prefix = "-" if "desc" in opts else ""
        out.append(f"{prefix}{column}")
    return out


# ---------------------------------------------------------------------------
# select / embedding
# ---------------------------------------------------------------------------

def _parse_select(model, select_str):
    if not select_str or select_str.strip() in ("*", ""):
        return None, []
    cols, embeds = [], []
    for token in _split_top_level(select_str):
        if "(" in token:
            name, rest = token.split("(", 1)
            embeds.append((name.strip(), rest.rsplit(")", 1)[0].strip() or "*"))
        else:
            cols.append(token.strip())
    return cols, embeds


def _embed_relation(model, name):
    try:
        field = model._meta.get_field(name)
        if isinstance(field, (models.ForeignKey, models.OneToOneField)):
            return "forward", field, field.related_model
    except Exception:  # noqa: BLE001 - not a forward field
        pass
    for rel in model._meta.related_objects:
        if rel.get_accessor_name() == name:
            return "reverse", rel, rel.related_model
    # PostgREST semantics: an embed can name the FK target table (e.g. the
    # `candidates(...)` projection used on `applications`). Resolve it from the
    # related model's db_table when it is unambiguous.
    matches = [
        f
        for f in model._meta.local_fields
        if isinstance(f, (models.ForeignKey, models.OneToOneField))
        and f.related_model is not None
        and f.related_model._meta.db_table == name
    ]
    if len(matches) == 1:
        field = matches[0]
        return "forward", field, field.related_model
    # The same rule in the reverse direction: a parent projection naming a
    # child table (e.g. `interview_feedback(...)` on `interviews`) resolves
    # through related_objects rather than a local FK. Without this the embed
    # resolved to None and serialize_instance skipped it silently.
    rev_matches = [
        rel for rel in model._meta.related_objects
        if rel.related_model is not None and rel.related_model._meta.db_table == name
    ]
    if len(rev_matches) == 1:
        rel = rev_matches[0]
        return "reverse", rel, rel.related_model
    return None


def _to_json_value(field, value):
    if value is None:
        return None
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (dict, list, bool, int, float, str)):
        return value
    return str(value)


def serialize_instance(instance, cols, embed_specs=None, user=None, _depth=0):
    model = instance.__class__
    out = {}
    for f in model._meta.local_fields:
        column = f.column
        if cols is not None and column not in cols:
            continue
        out[column] = _to_json_value(f, getattr(instance, f.attname))
    if embed_specs and _depth < 2:
        for relname, inner in embed_specs:
            res = _embed_relation(model, relname)
            if res is None:
                continue
            direction, ref, cmodel = res
            inner_cols, inner_embeds = _parse_select(cmodel, inner)
            if direction == "forward":
                fk_id = getattr(instance, ref.attname)
                if fk_id is None:
                    out[relname] = None
                    continue
                qs = cmodel.objects.filter(pk=fk_id)
                if user is not None and not _is_service(user):
                    policy = get_policy(cmodel._meta.db_table)
                    if policy is not None:
                        qs = qs.filter(policy.read_q(user))
                related = qs.first()
                out[relname] = (
                    serialize_instance(related, inner_cols, inner_embeds, user, _depth + 1)
                    if related is not None
                    else None
                )
            else:
                accessor = ref.get_accessor_name()
                qs = getattr(instance, accessor).all()
                if user is not None and not _is_service(user):
                    policy = get_policy(cmodel._meta.db_table)
                    if policy is not None:
                        qs = qs.filter(policy.read_q(user))
                out[relname] = [
                    serialize_instance(row, inner_cols, inner_embeds, user, _depth + 1)
                    for row in qs[:50]
                ]
    return out


# ---------------------------------------------------------------------------
# triggers
# ---------------------------------------------------------------------------

def _merge_snapshot(instance):
    return {
        f.column: getattr(instance, f.attname) for f in instance.__class__._meta.local_fields
    }


def _apply_payload(instance, payload):
    model = instance.__class__
    for key, value in payload.items():
        field = _require_field(model, key)
        if value is None:
            setattr(instance, field.attname, None)
        elif isinstance(field, models.JSONField) or isinstance(value, (dict, list, bool)):
            setattr(instance, field.attname, value)
        else:
            try:
                setattr(instance, field.attname, _coerce_raw(field, value))
            except TypeError:
                setattr(instance, field.attname, value)


def _pre_write_triggers(table, user, is_insert, old, new, changed=None):
    # The recruitment pipeline is application-driven, so a candidate with no
    # requisition would never appear in it. Every legitimate creation path
    # (recruitment UI, public careers site) supplies job_id, so reject the
    # orphaned candidate at the API boundary instead of storing one.
    if table == "candidates" and is_insert and not new.get("job_id"):
        _pgrst_error(
            "A requisition is required to add a candidate to the recruitment pipeline.",
            "P0001",
            400,
        )
    if table != "leave_requests":
        return
    if is_insert:
        validate_leave_request(new, is_insert=True)
    else:
        guard_leave_self_update(user, old, new)
        if changed and (changed & {"start_date", "end_date"}):
            validate_leave_request(new, is_insert=False)


# ---------------------------------------------------------------------------
# view
# ---------------------------------------------------------------------------

class RestView(APIView):
    authentication_classes = [BearerAuth]
    renderer_classes = [JSONRenderer, _PgrstObjectRenderer]

    def get(self, request, schema, table):
        policy = get_policy(table)
        if policy is None or policy.model is None:
            _pgrst_error(f'Cannot find table "{table}" in schema "public"', "PGRST404", 404)
        model = policy.model
        extra_q = _collect_filters(request, model)

        qs = model.objects.all()
        if not _is_service(request.user):
            qs = qs.filter(policy.read_q(request.user))
        qs = qs.filter(extra_q)

        select_arg = request.query_params.get("select", "*")
        if select_arg == "count":
            return JsonResponse([{"count": qs.count()}], safe=False)

        cols, embeds = _parse_select(model, select_arg)

        order = _parse_order(request, model)
        if order:
            qs = qs.order_by(*order)

        total = qs.count() if _prefer_flag(request, "count=exact") else None

        offset_raw = request.query_params.get("offset", "0") or "0"
        try:
            offset = int(offset_raw)
        except (TypeError, ValueError):
            _pgrst_error("Invalid offset parameter", "PGRST100", 400)
        if offset < 0:
            offset = 0
        limit_raw = request.query_params.get("limit")
        if limit_raw in (None, ""):
            limit = None
        else:
            try:
                limit = int(limit_raw)
            except (TypeError, ValueError):
                _pgrst_error("Invalid limit parameter", "PGRST100", 400)
            if limit < 0:
                _pgrst_error("Invalid limit parameter", "PGRST100", 400)
        if limit == 0:
            page = []
        else:
            page = list((qs[offset : offset + (limit if limit is not None else None)] if limit is not None else qs[offset:])[:5000])

        data = [serialize_instance(row, cols, embeds, request.user) for row in page]

        if SINGLE_ACCEPT in request.META.get("HTTP_ACCEPT", ""):
            if len(data) != 1:
                _pgrst_error(
                    "JSON object requested, multiple (or no) rows returned", "PGRST116", 406
                )
            return JsonResponse(data[0], safe=False)

        return _content_range_response(data, offset, total)

    def head(self, request, schema, table):
        policy = get_policy(table)
        if policy is None or policy.model is None:
            _pgrst_error(f'Cannot find table "{table}" in schema "public"', "PGRST404", 404)
        model = policy.model
        qs = model.objects.all()
        if not _is_service(request.user):
            qs = qs.filter(policy.read_q(request.user))
        qs = qs.filter(_collect_filters(request, model))
        total = qs.count()
        resp = JsonResponse([], safe=False)
        resp["Content-Range"] = f"*/{total}"
        return resp

    def post(self, request, schema, table):
        policy = get_policy(table)
        if policy is None or policy.model is None:
            _pgrst_error(f'Cannot find table "{table}" in schema "public"', "PGRST404", 404)
        model = policy.model

        body = request.data
        if body is None and request.body:
            try:
                body = json.loads(request.body)
            except ValueError as exc:
                _pgrst_error("JSON object requested, failed to parse body", "PGRST200", 400)
                raise exc
        records = body if isinstance(body, list) else [body]
        if not records or records == [None]:
            records = [{}]

        on_conflict = request.query_params.get("on_conflict")
        ignore = _prefer_flag(request, "resolution=ignore-duplicates")
        created = []

        for payload in records:
            payload = dict(payload or {})
            if not _is_service(request.user) and not policy.insert_ok(request.user, payload):
                _pgrst_error(
                    f'new row violates row-level security policy for table "{table}"',
                    "42501",
                    401,
                )

            instance = self._create_or_resolve(
                model, policy, payload, on_conflict, ignore, request
            )
            if instance is None:
                continue
            new = _merge_snapshot(instance)
            _post_write_triggers(table, request.user, is_insert=True, old={}, new=new)
            created.append(instance)

        if _prefer_flag(request, "return=representation"):
            cols, embeds = _parse_select(model, request.query_params.get("select", "*"))
            out = [serialize_instance(i, cols, embeds, request.user) for i in created]
            return JsonResponse(out, safe=False, status=status.HTTP_201_CREATED)
        return JsonResponse({}, safe=False, status=status.HTTP_204_NO_CONTENT)

    def _create_or_resolve(self, model, policy, payload, on_conflict, ignore, request):
        user = request.user

        if on_conflict:
            keys = [k.strip() for k in on_conflict.split(",") if k.strip()]
            lookup = {k: payload[k] for k in keys if k in payload}
            existing = model.objects.filter(**lookup).first() if lookup else None
            if existing is not None:
                if ignore:
                    return None
                old = _merge_snapshot(existing)
                new = {**old, **payload}
                if not _is_service(user) and not policy.check_ok(user, old, new):
                    _pgrst_error(
                        f'existing row violates row-level security policy for table '
                        f'"{model._meta.db_table}"',
                        "42501",
                        401,
                    )
                _pre_write_triggers(model._meta.db_table, user, False, old, new, set(payload))
                with transaction.atomic():
                    _apply_payload(existing, payload)
                    existing.save()
                    _post_write_triggers(
                        model._meta.db_table, user, False, old, _merge_snapshot(existing)
                    )
                return existing

        new = dict(payload)
        _pre_write_triggers(model._meta.db_table, user, True, {}, new)
        with transaction.atomic():
            instance = model()
            _apply_payload(instance, new)
            instance.save()
        return instance

    def patch(self, request, schema, table):
        policy = get_policy(table)
        if policy is None or policy.model is None:
            _pgrst_error(f'Cannot find table "{table}" in schema "public"', "PGRST404", 404)
        model = policy.model

        qs = model.objects.all()
        if not _is_service(request.user):
            qs = qs.filter(policy.update_q(request.user))
        qs = qs.filter(_collect_filters(request, model))
        rows = list(qs)
        _deny_if_filtered_out(model, request, rows, _is_service(request.user))

        payload = request.data or {}
        if isinstance(payload, list):
            payload = dict(payload[0]) if payload else {}
        payload = dict(payload or {})
        changed = set(payload)

        merged = []
        for row in rows:
            old = _merge_snapshot(row)
            new = {**old, **payload}
            if not _is_service(request.user) and not policy.check_ok(request.user, old, new):
                _pgrst_error(
                    f'new row violates row-level security policy for table "{table}"',
                    "42501",
                    401,
                )
            merged.append((row, old, new))

        updated = []
        for row, old, new in merged:
            _pre_write_triggers(table, request.user, False, old, new, changed)
            with transaction.atomic():
                _apply_payload(row, payload)
                row.save()
                _post_write_triggers(table, request.user, False, old, _merge_snapshot(row))
            updated.append(row)

        if _prefer_flag(request, "return=representation"):
            cols, embeds = _parse_select(model, request.query_params.get("select", "*"))
            out = [serialize_instance(i, cols, embeds, request.user) for i in updated]
            return JsonResponse(out, safe=False)
        return JsonResponse({}, safe=False, status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, schema, table):
        policy = get_policy(table)
        if policy is None or policy.model is None:
            _pgrst_error(f'Cannot find table "{table}" in schema "public"', "PGRST404", 404)
        model = policy.model

        qs = model.objects.all()
        if not _is_service(request.user):
            qs = qs.filter(policy.delete_q(request.user))
        qs = qs.filter(_collect_filters(request, model))
        rows = list(qs)
        _deny_if_filtered_out(model, request, rows, _is_service(request.user))

        # Fixture protection. Evaluated over the whole resolved target set
        # *before* any delete(), so a cascade can never start. This runs for
        # service-role callers too: `_is_service` above deliberately skips the
        # policy queryset, but a fixture is not a permission question. Filters
        # cannot evade it because the flag is read off the resolved rows.
        #
        # Applies to every table that carries the marker (employees,
        # employee_documents, candidates). A row whose flag is anything other
        # than an explicit False -- protected, or unreadable/unclassifiable --
        # rejects the whole request rather than being treated as disposable.
        if hasattr(model, "is_fixture"):
            if any(getattr(row, "is_fixture", None) is not False for row in rows):
                _pgrst_error(
                    "Refusing to delete fixture records. Seeded/fixture data is "
                    "protected from deletion.",
                    "FIXTURE_PROTECTED",
                    403,
                )

        out = None
        if _prefer_flag(request, "return=representation"):
            cols, embeds = _parse_select(model, request.query_params.get("select", "*"))
            out = [serialize_instance(i, cols, embeds, request.user) for i in rows]
        for row in rows:
            row.delete()
        if out is not None:
            return JsonResponse(out, safe=False)
        return JsonResponse({}, safe=False, status=status.HTTP_204_NO_CONTENT)


def _post_write_triggers(table, user, is_insert, old, new):
    if table == "leave_requests":
        if is_insert:
            notify_leave_event(user, True, old, new)
        else:
            sync_leave_balance(old.get("status"), new)
            notify_leave_event(user, False, old, new)
    if table == "onboarding_tasks" and is_insert:
        notify_onboarding_assignment(user, new)
    if table == "helpdesk_tickets" and not is_insert:
        notify_ticket_assignment(old, new)