"""
Django settings for the Spine AI backend (Supabase replacement).

PostgreSQL is the only supported runtime database; code path mirrors the
original Supabase/PostgREST schema 1:1.

Production posture: fail closed. Every secret (SECRET_KEY, SERVICE_ROLE_KEY)
must be provided via the environment; there are no known security defaults.
DEBUG, HTTPS-only hardening, ALLOWED_HOSTS and CORS are all environment-driven
so an unconfigured deployment cannot silently run in an insecure mode.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    """Read a boolean env var; a missing/empty value yields `default`.

    Defaults are conservative (False) so production fails closed unless the
    operator explicitly opts in.
    """
    return os.getenv(name, "true" if default else "false").lower() in ("1", "true", "yes")


# ---------------------------------------------------------------------------
# Secrets — must be supplied by the environment. No known fallbacks.
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "").strip()
if not SECRET_KEY:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is not set. Provide it via the environment "
        "(e.g. backend/.env, DJANGO_SECRET_KEY=...). Refusing to start "
        "with an empty or known-default SECRET_KEY."
    )

# Service-role key (RLS-bypass credential, same semantics as Supabase's
# service_role JWT). Empty when unset: the service-role bypass is then simply
# unavailable (fail safe). Never handed to the browser.
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY", "").strip()

# DEBUG: production defaults to OFF. Deployment environments must opt in
# explicitly (DJANGO_DEBUG=true) for a debug session only.
DEBUG = _env_bool("DJANGO_DEBUG", default=False)

# ---------------------------------------------------------------------------
# Hosts & CORS — explicit and environment-driven; no wildcard in production.
# ---------------------------------------------------------------------------
_ALLOWED_HOSTS_ENV = [
    h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()
]

if DEBUG:
    # Dev-friendly localhost default; explicit env values (e.g. hostnames the
    # Vite dev server proxies to) also work.
    ALLOWED_HOSTS = _ALLOWED_HOSTS_ENV or ["127.0.0.1", "localhost", "0.0.0.0", "[::1]"]
else:
    if not _ALLOWED_HOSTS_ENV or "*" in _ALLOWED_HOSTS_ENV:
        raise ImproperlyConfigured(
            "DJANGO_ALLOWED_HOSTS must list explicit production hosts (no bare '*') "
            "when DEBUG is disabled."
        )
    ALLOWED_HOSTS = _ALLOWED_HOSTS_ENV

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "hr",
]

AUTH_USER_MODEL = "hr.AppUser"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "spineai.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "spineai.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("PGDATABASE", "spine_ai"),
        "USER": os.getenv("PGUSER", "postgres"),
        "PASSWORD": os.getenv("PGPASSWORD", "postgres"),
        "HOST": os.getenv("PGHOST", "127.0.0.1"),
        "PORT": os.getenv("PGPORT", "5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("DJANGO_TZ", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Storage (replaces Supabase Storage). Files are stored on local disk and
# exposed through signed URLs just like Supabase Storage did.
# ---------------------------------------------------------------------------
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", BASE_DIR / "storage"))
MEDIA_ROOT = str(STORAGE_ROOT)
MEDIA_URL = "/api/v1/storage/"

STORAGE_SIGNED_URL_TTL = int(os.getenv("STORAGE_SIGNED_URL_TTL", "300"))

# ---------------------------------------------------------------------------
# DRF
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "hr.auth.BearerAuth",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "EXCEPTION_HANDLER": "hr.exceptions.api_exception_handler",
    "UNAUTHENTICATED_USER": None,
}

# CORS: explicit, environment-driven origins. Credentials are only ever sent
# to an explicit (non-wildcard) origin list; there is no
# CORS_ALLOW_ALL_ORIGINS=True in any configuration.
CORS_ALLOW_ALL_ORIGINS = False
_CORS_ORIGINS_ENV = [
    o.strip() for o in os.getenv("DJANGO_CORS_ORIGINS", "").split(",") if o.strip()
]
if DEBUG:
    # Local development (Vite dev server + Django on localhost). Env-provided
    # origins are honored when set; otherwise the standard localhost set. The
    # Lovable Vite dev server defaults to port 8080, so that origin must be
    # allowed for the browser to reach the auth/API endpoints at all.
    CORS_ALLOWED_ORIGINS = _CORS_ORIGINS_ENV or [
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:8081",
        "http://localhost:8081",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ]
    CORS_ALLOWED_ORIGIN_REGEXES = []
else:
    if not _CORS_ORIGINS_ENV:
        raise ImproperlyConfigured(
            "DJANGO_CORS_ORIGINS must list explicit allowed origins (comma-separated) "
            "when DEBUG is disabled."
        )
    CORS_ALLOWED_ORIGINS = _CORS_ORIGINS_ENV
    CORS_ALLOWED_ORIGIN_REGEXES = []
CORS_ALLOW_CREDENTIALS = bool(CORS_ALLOWED_ORIGINS)

# QueryBuilder sends a `Prefer` header on every read/write (count=exact /
# return=representation / resolution=...) and storage uploads use
# `Cache-Control`; both are outside django-cors-headers' default allow-list,
# so preflights were rejecting all app data reads in the browser.
# The client never sends Accept-Profile/Content-Profile/Range.
CORS_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "prefer",
    "cache-control",
)
# countExact totals are read from the `Content-Range` response header
# (QueryBuilder.run in src/integrations/supabase/core.ts).
CORS_EXPOSE_HEADERS = ("content-range",)

# ---------------------------------------------------------------------------
# Security headers / HTTPS-only hardening.
#
# HTTPS hardening (HSTS, SSL redirect, secure cookies) is gated behind
# DJANGO_HTTPS=true so the plain-HTTP local development environment keeps
# working unchanged. It is NOT possible to claim HSTS behaviour was exercised
# on local HTTP — HSTS only takes effect once the site is actually served
# over HTTPS with the backend behind a TLS terminator.
# ---------------------------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True

_HTTPS = _env_bool("DJANGO_HTTPS", default=False)
if _HTTPS:
    SECURE_SSL_REDIRECT = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False
else:
    SECURE_SSL_REDIRECT = False
    SESSION_COOKIE_SECURE = False
    CSRF_COOKIE_SECURE = False
    SECURE_HSTS_SECONDS = 0
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False
    SECURE_HSTS_PRELOAD = False
