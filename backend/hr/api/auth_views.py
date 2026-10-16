"""Auth endpoints — standalone replacement for GoTrue/Supabase auth.

Serves the calls the frontend `supabase.auth.*` and `supabase.auth.admin.*`
make, with the exact result shape the Supabase JS client expects:

   POST /api/v1/auth/token            {grant_type:password} signInWithPassword
   POST /api/v1/auth/signup           signUp
   POST /api/v1/auth/logout           signOut
   POST /api/v1/auth/refresh          rotate refresh_token
   GET  /api/v1/auth/user             current user (Bearer)
   POST /api/v1/auth/claims           decode access token -> claims
   POST /api/v1/auth/reset-password   resetPasswordForEmail (dev: no-op ack)
   GET  /api/v1/auth/admin/users      service-role listUsers
   POST /api/v1/auth/admin/users      service-role createUser
   PUT  /api/v1/auth/admin/users/<id> service-role updateUserById

Sessions mirror the GoTrue response: `{access_token, refresh_token,
token_type, expires_in, expires_at, user}`.
"""

from __future__ import annotations

import datetime
import os
import uuid

import jwt as pyjwt
from django.contrib import auth as django_auth
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from hr import auth as hp
from hr.auth import BearerAuth, ServiceRoleUser
from hr.rbac import has_role
from hr.triggers import handle_new_user

ACCESS_TTL = int(os.getenv("ACCESS_TOKEN_TTL", "86400"))
REFRESH_TTL = int(os.getenv("REFRESH_TOKEN_TTL", "2592000"))

User = get_user_model()


def _user_json(user):
    meta = {}
    first = getattr(user, "first_name", None) or ""
    last = getattr(user, "last_name", None) or ""
    full = first if not last else f"{first} {last}".strip()
    if full:
        meta["full_name"] = full
    profile_full = None
    try:
        profile_full = user.profile.full_name if getattr(user, "profile", None) else None
    except Exception:  # noqa: BLE001
        profile_full = None
    if profile_full:
        meta["full_name"] = profile_full
    return {
        "id": str(user.pk),
        "aud": "authenticated",
        "role": "authenticated",
        "email": user.email,
        "email_confirmed_at": user.date_joined.isoformat() if user.date_joined else None,
        "phone": "",
        "confirmation_sent_at": None,
        "recovery_sent_at": None,
        "app_metadata": {"provider": "email", "providers": ["email"]},
        "user_metadata": meta,
        "identities": [
            {"identity_id": str(uuid.uuid4()), "id": str(user.pk), "user_id": str(user.pk),
             "provider": "email", "last_sign_in_at": None,
             "created_at": user.date_joined.isoformat() if user.date_joined else None,
             "updated_at": None}
        ],
        "created_at": user.date_joined.isoformat() if user.date_joined else None,
        "updated_at": None,
        "last_sign_in_at": getattr(user, "last_login", None).isoformat() if getattr(user, "last_login", None) else None,
    }


def _session_for(user):
    now = datetime.datetime.now(datetime.timezone.utc)
    access = hp.issue_access_token(user.pk)
    refresh = pyjwt.encode(
        {
            "sub": str(user.pk),
            "aud": hp.AUDIENCE,
            "type": "refresh",
            "iat": int(now.timestamp()),
            "exp": int((now + datetime.timedelta(seconds=REFRESH_TTL)).timestamp()),
        },
        hp._secret(),
        algorithm=hp.ALGORITHM,
    )
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": ACCESS_TTL,
        "expires_at": int((now + datetime.timedelta(seconds=ACCESS_TTL)).timestamp()),
        "user": _user_json(user),
    }


def _decode_refresh(token: str):
    try:
        claims = pyjwt.decode(
            token, hp._secret(), algorithms=[hp.ALGORITHM], audience=hp.AUDIENCE
        )
    except (pyjwt.ExpiredSignatureError, pyjwt.InvalidTokenError):
        return None
    return claims


def _ok(payload, http=status.HTTP_200_OK):
    return Response(payload, status=http)


def _err(message, http=status.HTTP_400_BAD_REQUEST, code="Auth_Error"):
    return Response({"message": message, "code": code, "details": None, "hint": None},
                    status=http)


class TokenView(APIView):
    """POST /api/v1/auth/token  (grant_type=password)"""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.data or {}
        grant_type = body.get("grant_type", "password")
        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        if not email or not password:
            return _err("Email and password are required")
        user = django_auth.authenticate(request, username=email, password=password)
        if user is None or not getattr(user, "is_active", True):
            return _err("Invalid login credentials", status.HTTP_401_UNAUTHORIZED)
        django_auth.login(request, user)
        return _ok(_session_for(user), status.HTTP_200_OK)


class RefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.data or {}
        token = body.get("refresh_token") or ""
        claims = _decode_refresh(token)
        if not claims or claims.get("type") != "refresh":
            return _err("Invalid Refresh Token: Token has expired or is invalid",
                        status.HTTP_401_UNAUTHORIZED)
        try:
            user = User.objects.get(pk=claims["sub"])
        except (User.DoesNotExist, ValueError):
            return _err("Invalid user", status.HTTP_401_UNAUTHORIZED)
        return _ok(_session_for(user))


class SignupView(APIView):
    """POST /api/v1/auth/signup  (dev: auto-confirm email)"""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.data or {}
        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        options = body.get("options") or {}
        if isinstance(options, dict) and options.get("data"):
            meta = options["data"]
        else:
            meta = body.get("user_metadata") or {}
        if not isinstance(meta, dict):
            meta = {}
        if not email or not password:
            return _err("Email and password are required")
        user, created = User.objects.get_or_create(email=email, defaults={"is_active": True})
        if not created:
            # An already-registered account must prove its password — signing up
            # must never mint a session for an existing email without one.
            authenticated = django_auth.authenticate(
                request, username=email, password=password
            )
            if authenticated is None or not getattr(authenticated, "is_active", True):
                return _err("Invalid login credentials", status.HTTP_401_UNAUTHORIZED)
            django_auth.login(request, authenticated)
            return _ok(_session_for(authenticated), status.HTTP_200_OK)
        user.set_password(password)
        if hasattr(user, "first_name") and meta.get("full_name"):
            names = str(meta["full_name"]).split(maxsplit=1)
            user.first_name = names[0]
            if len(names) > 1:
                user.last_name = names[1]
        user.save()
        handle_new_user(user)
        return _ok(_session_for(user), status.HTTP_200_OK)


class LogoutView(APIView):
    def post(self, request):
        return _ok({})


class SessionView(APIView):
    """GET/POST /api/v1/auth/user — the caller's user row."""

    def get(self, request):
        return _ok(_user_json(request.user))

    post = get


class ClaimsView(APIView):
    """POST /api/v1/auth/claims — decode an access token (getClaims)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.data or {}
        token = body.get("token") or ""
        header = request.META.get("HTTP_AUTHORIZATION", "")
        if not token and header.startswith("Bearer "):
            token = header[len("Bearer "):]
        try:
            claims = hp.decode_access_token(token)
        except hp.AccessTokenError:
            return _err("Invalid token", status.HTTP_401_UNAUTHORIZED)
        return _ok({"claims": claims})


class ResetPasswordView(APIView):
    """POST /api/v1/auth/reset-password — dev no-op ack."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        return _ok({"message": "If that email is registered, a reset link has been sent."})


# ---------------------------------------------------------------------------
# auth.admin (service role)
# ---------------------------------------------------------------------------

def _is_service(request):
    return isinstance(request.user, ServiceRoleUser) or getattr(request.user, "is_service_role", False)


class AdminUsersView(APIView):
    authentication_classes = [BearerAuth]

    def _guard(self, request):
        if not _is_service(request) and not has_role(request.user, "super_admin"):
            return _err("Only the service role can manage users", status.HTTP_401_UNAUTHORIZED)
        return None

    def get(self, request):
        guard = self._guard(request)
        if guard:
            return guard
        per = int(request.query_params.get("per_page", "50") or "50")
        page = int(request.query_params.get("page", "1") or "1")
        order = request.query_params.get("order") or "created_at.asc"
        descending = "desc" in order
        qs = User.objects.all().order_by(("-date_joined" if descending else "date_joined"))
        start = (page - 1) * per
        users = [ _user_json(u) for u in qs[start : start + per] ]
        return _ok({"users": users, "aud": "authenticated", "total": qs.count()})

    def post(self, request):
        guard = self._guard(request)
        if guard:
            return guard
        body = request.data or {}
        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        meta = body.get("user_metadata") or {}
        if not email:
            return _err("Email is required")
        user, created = User.objects.get_or_create(
            email=email, defaults={"is_active": True}
        )
        if password:
            user.set_password(password)
        if meta.get("full_name"):
            user.first_name = str(meta["full_name"]).split()[0]
        user.save()
        handle_new_user(user)
        return _ok({"user": _user_json(user)}, status.HTTP_201_CREATED)


class AdminUserByIdView(APIView):
    authentication_classes = [BearerAuth]

    def _guard(self, request):
        if not _is_service(request) and not has_role(request.user, "super_admin"):
            return _err("Only the service role can manage users", status.HTTP_401_UNAUTHORIZED)
        return None

    def put(self, request, user_id):
        guard = self._guard(request)
        if guard:
            return guard
        try:
            user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError):
            return _err("User not found", status.HTTP_404_NOT_FOUND)
        body = request.data or {}
        if body.get("email"):
            user.email = str(body["email"]).strip().lower()
        if body.get("password"):
            user.set_password(str(body["password"]))
        meta = body.get("user_metadata") or {}
        if meta.get("full_name"):
            parts = str(meta["full_name"]).split(maxsplit=1)
            user.first_name = parts[0]
            if len(parts) > 1:
                user.last_name = parts[1]
        if body.get("app_metadata") is not None:
            user.is_superuser = bool((body["app_metadata"] or {}).get("is_superuser", user.is_superuser))
        user.save()
        return _ok({"user": _user_json(user)})

    def delete(self, request, user_id):
        guard = self._guard(request)
        if guard:
            return guard
        try:
            user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError):
            return _err("User not found", status.HTTP_404_NOT_FOUND)
        user.delete()
        return _err("", status.HTTP_204_NO_CONTENT)