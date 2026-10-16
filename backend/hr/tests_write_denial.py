"""Authorization-denial semantics for UPDATE/DELETE on the REST layer.

Purely mock-based: no database connection, no storage access, no real request.
These tests pin the distinction between

  * an operation the policy *allowed* that matched zero rows, and
  * an operation the policy *denied*,

which the queryset-filter design would otherwise render indistinguishable.

Run with:
    python manage.py test hr.tests_write_denial
"""

import os
from unittest import mock

from django.test import SimpleTestCase

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")

from hr.api import rest as rest_api  # noqa: E402


class _Request:
    """Minimal stand-in for a DRF request."""

    def __init__(self, user, data=None, query_params=None):
        self.user = user
        self.data = data if data is not None else {}
        self.query_params = query_params if query_params is not None else {}
        self.META = {}


def _qs_returning(rows, exists=None):
    """A queryset double whose final resolved row set is `rows`.

    `exists` drives `.exists()` for the unfiltered probe used by the denial
    check; it defaults to "these rows exist".
    """
    qs = mock.MagicMock()
    qs.filter.return_value = qs
    qs.__iter__ = lambda s: iter(rows)
    qs.exists.return_value = bool(rows) if exists is None else exists
    return qs


class _Policy:
    """Policy double recording the Q that would be applied."""

    def __init__(self, model, allowed):
        self.model = model
        self._allowed = allowed

    def update_q(self, user):
        return self._allowed

    def delete_q(self, user):
        return self._allowed

    def check_ok(self, user, old, new):
        return True


def _run(method, rows, allowed, user, data=None, query_params=None, exists=None):
    """Invoke the view's method with a policy that admits `rows`."""
    model = mock.Mock()
    model.objects.all.return_value = _qs_returning(rows, exists=exists)
    policy = _Policy(model, allowed)

    with mock.patch.object(rest_api, "get_policy", return_value=policy), \
         mock.patch.object(rest_api, "_collect_filters", return_value=mock.MagicMock()), \
         mock.patch.object(rest_api, "JsonResponse") as resp:
        view = rest_api.RestView()
        try:
            getattr(view, method)(_Request(user, data=data, query_params=query_params),
                                  "public", "widgets")
        except Exception as exc:  # correct behaviour is to raise, not to return
            resp.side_effect = exc
            raise
    return resp


class WriteDenialTests(SimpleTestCase):
    """UPDATE and DELETE must not report a denial as an empty success."""

    def setUp(self):
        self.hr = mock.Mock(is_service_role=False, is_authenticated=True)

    # ------------------------------------------------------------------
    # DELETE
    # ------------------------------------------------------------------

    def test_denied_delete_reports_authorization_error(self):
        """Rows exist but the policy excluded them -> 403, never a quiet 204."""
        with self.assertRaises(Exception) as ctx:
            _run("delete", [], mock.MagicMock(), self.hr, exists=True)
        self.assertEqual(403, ctx.exception.status_code)

    def test_delete_with_no_matching_rows_is_not_an_error(self):
        """A genuinely empty target set must stay a quiet success."""
        resp = _run("delete", [], mock.MagicMock(), self.hr)
        resp.assert_called_once()
        _, kwargs = resp.call_args
        self.assertEqual(204, kwargs.get("status"))

    # ------------------------------------------------------------------
    # UPDATE
    # ------------------------------------------------------------------

    def test_denied_update_reports_authorization_error(self):
        with self.assertRaises(Exception) as ctx:
            _run("patch", [], mock.MagicMock(), self.hr, data={"name": "x"}, exists=True)
        self.assertEqual(403, ctx.exception.status_code)

    def test_service_role_is_not_treated_as_denied(self):
        """A service caller that simply matched nothing must stay a quiet 204."""
        service = mock.Mock(is_service_role=True, is_authenticated=True)
        resp = _run("delete", [], mock.MagicMock(), service, exists=True)
        resp.assert_called_once()
        _, kwargs = resp.call_args
        self.assertEqual(204, kwargs.get("status"))