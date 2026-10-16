"""JWT bearer authentication, replacing Supabase auth sessions.

The access token is a signed JWT that mimics the Supabase access-token shape
the frontend already understands: `sub` carries the user id. The rest of the
auth flow (login, signup, session, sign out) is exposed by the auth views.
"""

import os
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions as drf_exceptions

AUDIENCE = "spine-ai"
ALGORITHM = "HS256"


class AccessTokenError(Exception):
    pass


def _secret() -> str:
    if settings.DEBUG:
        return settings.SECRET_KEY
    return os.getenv("ACCESS_TOKEN_SECRET", settings.SECRET_KEY)


def _service_role_key() -> str:
    return os.getenv("SERVICE_ROLE_KEY", "")


class ServiceRoleUser:
    """Marker principal used when a request is authenticated with the service key.

    Mirrors PostgREST's `service_role` JWT role which bypasses RLS. Attribute
    surface is kept compatible with the Rbac helpers (is_anonymous False) and
    DRF's IsAuthenticated permission (is_authenticated True).
    """

    pk = None
    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_superuser = True
    is_service_role = True

    def __str__(self):  # pragma: no cover - debug helper
        return "service_role"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_access_token(user_id: str, ttl: int | None = None) -> str:
    ttl = ttl or int(os.getenv("ACCESS_TOKEN_TTL", "86400"))
    now = _now()
    payload = {
        "sub": str(user_id),
        "aud": AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "role": "authenticated",
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            _secret(),
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            options={"require": ["sub", "exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AccessTokenError("Token has expired or is invalid") from exc
    except jwt.InvalidTokenError as exc:
        raise AccessTokenError("Invalid token") from exc


class BearerAuth(authentication.BaseAuthentication):
    """Validates `Authorization: Bearer <jwt>` and resolves the AppUser."""

    keyword = "Bearer"

    def authenticate(self, request):  # noqa: ANN001
        header = request.META.get("HTTP_AUTHORIZATION", "")
        if not header:
            return None

        try:
            scheme, token = header.split(" ", 1)
        except ValueError as exc:
            raise drf_exceptions.AuthenticationFailed(
                "Invalid authorization header"
            ) from exc
        if scheme.lower() != self.keyword.lower():
            return None

        # Supabase-style service_role key: a raw opaque key bypasses RLS.
        if token.strip() == _service_role_key() and _service_role_key():
            return (ServiceRoleUser(), token.strip())

        try:
            claims = decode_access_token(token.strip())
        except AccessTokenError as exc:
            raise drf_exceptions.AuthenticationFailed(str(exc)) from exc
        if claims.get("role") == "service_role":
            return (ServiceRoleUser(), token.strip())

        user_id = claims.get("sub")
        if not user_id:
            raise drf_exceptions.AuthenticationFailed("No user ID found in token")

        try:
            user = settings.AUTH_USER_MODEL and _load_user(user_id)
        except Exception as exc:  # noqa: BLE001
            raise drf_exceptions.AuthenticationFailed(
                "Invalid user"
            ) from exc
        if user is None or getattr(user, "is_active", False) is False:
            raise drf_exceptions.AuthenticationFailed("Invalid user")

        request.jwt_claims = claims
        return (user, token)

    def authenticate_header(self, request):  # noqa: ANN001
        return self.keyword


def _load_user(user_id: str):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    try:
        return User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return None