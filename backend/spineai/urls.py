"""URL configuration for spineai project.

The PostgREST-compatible surface used by the (unchanged) frontend:

   /api/v1/:schema/:table     RestView                (GET/POST/PATCH/DELETE/HEAD)
   /api/v1/rpc/:fn/           RPC functions           (has_role, match_kb_chunks, ...)
   /api/v1/auth/...           GoTrue-compatible auth
   /api/v1/storage/object/... Supabase-style storage

PostgREST / supabase-js clients never append a trailing slash, so every API
route is matched with an optional one (Django's APPEND_SLASH cannot redirect
POST/PATCH/DELETE, it only breaks them).
"""

from django.contrib import admin
from django.urls import path, re_path
from django.views.generic import RedirectView

from hr.api.auth_views import (
    AdminUserByIdView,
    AdminUsersView,
    ClaimsView,
    LogoutView,
    RefreshView,
    ResetPasswordView,
    SessionView,
    SignupView,
    TokenView,
)
from hr.api.rest import RestView
from hr.api.rpc import RpcView
from hr.api.storage_views import (
    StorageDeleteView,
    StorageObjectView,
    StorageSignView,
)

urlpatterns = []  # noqa: E701 -- populated below

# RPC (PostgREST shape): /api/v1/rpc/<function>   [optional trailing slash]
urlpatterns += [
    re_path(
        r"^api/v1/rpc/(?P<fn>[^/]+)/?$",
        RpcView.as_view(),
        name="rpc-function",
    ),
]

# Auth (GoTrue-compatible)   [optional trailing slash]
urlpatterns += [
    re_path(r"^api/v1/auth/token/?$", TokenView.as_view(), name="auth-token"),
    re_path(r"^api/v1/auth/signup/?$", SignupView.as_view(), name="auth-signup"),
    re_path(r"^api/v1/auth/logout/?$", LogoutView.as_view(), name="auth-logout"),
    re_path(r"^api/v1/auth/refresh/?$", RefreshView.as_view(), name="auth-refresh"),
    re_path(r"^api/v1/auth/user/?$", SessionView.as_view(), name="auth-user"),
    re_path(r"^api/v1/auth/claims/?$", ClaimsView.as_view(), name="auth-claims"),
    re_path(
        r"^api/v1/auth/reset-password/?$",
        ResetPasswordView.as_view(),
        name="auth-reset-password",
    ),
    re_path(
        r"^api/v1/auth/admin/users/?$",
        AdminUsersView.as_view(),
        name="auth-admin-users",
    ),
    re_path(
        r"^api/v1/auth/admin/users/(?P<user_id>[^/]+)/?$",
        AdminUserByIdView.as_view(),
        name="auth-admin-user",
    ),
]

# Storage (Supabase-style)   [optional trailing slash]
urlpatterns += [
    re_path(
        r"^api/v1/storage/object/sign/(?P<bucket>[^/]+)/(?P<path>.+)$",
        StorageSignView.as_view(),
        name="storage-sign",
    ),
    re_path(
        r"^api/v1/storage/object/(?P<bucket>[^/]+)/?$",
        StorageDeleteView.as_view(),
        name="storage-delete",
    ),
    re_path(
        r"^api/v1/storage/object/(?P<bucket>[^/]+)/(?P<path>.+)$",
        StorageObjectView.as_view(),
        name="storage-object",
    ),
]

# Tables (PostgREST shape): /api/v1/<schema>/<table>  [kept last: greedy, optional slash]
urlpatterns += [
    re_path(
        r"^api/v1/(?P<schema>[^/]+)/(?P<table>[^/]+)/?$",
        RestView.as_view(),
        name="rest-table",
    ),
]

# Fallback: the DRF browsable login page is not part of the API surface.
urlpatterns += [
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
]
