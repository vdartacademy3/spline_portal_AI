"""Global DRF exception handler that returns Supabase/postgrest-style errors.

Frontend code calls `supabase.from(...)` and inspects `error.message`,
`error.details`, `error.hint` and `error.code`; this handler keeps those
contracts intact.
"""

import logging

from django.db import IntegrityError
from django.http import JsonResponse
from rest_framework import status
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)

# Safe, stable client text for a database constraint failure. Deliberately says
# nothing about which table, column or constraint was involved.
INTEGRITY_ERROR_MESSAGE = "The request conflicts with existing data."


def _supabase_flags(code: str) -> tuple[str, str]:
    """(hint, details) to echo the RLS/auth error texts the UI expects."""
    mapping = {
        "PGRST301": ("", "suppress RLS? skip the before insert? RLS is on the table"),
        "22P02": ("", "invalid input value"),
        "42501": ("", "permission denied"),
    }
    return mapping.get(code, ("", ""))


def api_exception_handler(exc, context):  # noqa: ANN001
    # A database constraint failure is a client-input problem, but the driver
    # message embeds SQLSTATE plus the whole failing row (column order, column
    # names and the submitted values). Log it for operators, answer the client
    # with a fixed 400 that reveals none of it.
    if isinstance(exc, IntegrityError):
        request = (context or {}).get("request")
        logger.exception(
            "Database integrity error handling %s %s",
            getattr(request, "method", "?"),
            getattr(request, "path", "?"),
        )
        return JsonResponse(
            {
                "message": INTEGRITY_ERROR_MESSAGE,
                "code": str(status.HTTP_400_BAD_REQUEST),
                "details": None,
                "hint": None,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    response = drf_exception_handler(exc, context)
    if response is None:
        # Unhandled -> 500 shaped the same way.
        return JsonResponse(
            {
                "message": str(exc),
                "code": "500",
                "details": None,
                "hint": None,
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    detail = response.data
    message = ""
    codes = []
    if isinstance(detail, dict):
        message = detail.pop("detail", detail.get("message", ""))
        for key, value in detail.items():
            if isinstance(value, (list, tuple)):
                for item in value:
                    if isinstance(item, dict) and "code" in item:
                        codes.append(item["code"])
            elif isinstance(value, dict) and "message" in value:
                message = str(value["message"])
    elif isinstance(detail, (list, tuple)) and detail:
        message = str(detail[0])

    code = codes[0] if codes else str(response.status_code)
    hint, details = _supabase_flags(code)
    if not message and isinstance(exc, Exception):
        message = str(exc)

    return JsonResponse(
        {
            "message": message or "Request failed",
            "code": code,
            "details": details or None,
            "hint": hint or None,
        },
        status=response.status_code,
    )