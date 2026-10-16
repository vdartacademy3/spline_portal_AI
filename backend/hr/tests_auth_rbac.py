"""Offline (no database, no network, no real request) unit tests for the
auth / RBAC / row-policy authorization layer.

Three live-verification passes could not exercise these paths because no
approved test identity or fixture set was available (see the Phase 8C
checkpoint).  These tests pin the *authorization logic itself* using mocks for
the ORM layer only:

  * access/refresh token validation (missing, malformed, bad signature,
    expired, missing subject, service-role markers);
  * default-deny for unconfigured tables and default Policy behaviour;
  * payroll (``manage_payroll``) gating;
  * permission combinator denial paths;
  * employee self-scope and manager report-scope recursion;
  * the auth.admin endpoint guard and login field validation.

They do NOT prove live authentication, PostgreSQL RLS, or cross-organization
isolation — those remain BLOCKED / NOT VERIFIED.  No business data is touched.

Run with:
    python manage.py test hr.tests_auth_rbac
"""

import os
from types import SimpleNamespace
from unittest import mock

import jwt as pyjwt
from django.test import SimpleTestCase

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")

from hr import auth as hp  # noqa: E402
from hr import policies  # noqa: E402
from hr import rbac  # noqa: E402
from hr.api import auth_views  # noqa: E402


# A policy that admits no rows is encoded as Q(pk=None); this is the sentinel
# for "denied" throughout the policy layer.
DENIED = [("pk", None)]


def _request(auth_header=None):
    meta = {"HTTP_AUTHORIZATION": auth_header} if auth_header is not None else {}
    return SimpleNamespace(META=meta)


def _children(q):
    return list(q.children)


# ---------------------------------------------------------------------------
# Token handling
# ---------------------------------------------------------------------------

class BearerTokenTests(SimpleTestCase):
    """hr.auth.BearerAuth + decode_access_token negative/service-role paths."""

    def setUp(self):
        from rest_framework import exceptions as exc

        self.AuthFailed = exc.AuthenticationFailed
        self.bearer = hp.BearerAuth()

    def test_missing_header_is_anonymous(self):
        self.assertIsNone(self.bearer.authenticate(_request()))

    def test_non_bearer_scheme_is_ignored(self):
        self.assertIsNone(self.bearer.authenticate(_request("Basic abc")))

    def test_malformed_header_is_rejected(self):
        with self.assertRaises(self.AuthFailed):
            self.bearer.authenticate(_request("Bearer"))

    def test_invalid_signature_is_rejected(self):
        from hr import auth as hp_mod

        token = pyjwt.encode(
            {"sub": "u1", "aud": hp_mod.AUDIENCE, "exp": 9999999999,
             "role": "authenticated"},
            "a-deliberately-wrong-signing-key-0123456789", algorithm=hp_mod.ALGORITHM,
        )
        with self.assertRaises(self.AuthFailed):
            self.bearer.authenticate(_request(f"Bearer {token}"))

    def test_expired_token_is_rejected(self):
        from hr import auth as hp_mod

        token = hp_mod.issue_access_token("u1", ttl=-10)
        with self.assertRaises(self.AuthFailed):
            self.bearer.authenticate(_request(f"Bearer {token}"))

    def test_token_without_subject_is_rejected(self):
        from hr import auth as hp_mod

        token = pyjwt.encode(
            {"aud": hp_mod.AUDIENCE, "exp": 9999999999, "role": "authenticated"},
            hp_mod._secret(), algorithm=hp_mod.ALGORITHM,
        )
        with self.assertRaises(self.AuthFailed):
            self.bearer.authenticate(_request(f"Bearer {token}"))

    def test_opaque_service_key_returns_service_principal(self):
        with mock.patch.dict(os.environ, {"SERVICE_ROLE_KEY": "svc-secret"}):
            result = self.bearer.authenticate(_request("Bearer svc-secret"))
        self.assertIsNotNone(result)
        self.assertTrue(result[0].is_service_role)

    def test_service_role_claim_returns_service_principal(self):
        from hr import auth as hp_mod

        token = pyjwt.encode(
            {"sub": "u1", "aud": hp_mod.AUDIENCE, "exp": 9999999999,
             "role": "service_role"},
            hp_mod._secret(), algorithm=hp_mod.ALGORITHM,
        )
        result = self.bearer.authenticate(_request(f"Bearer {token}"))
        self.assertTrue(result[0].is_service_role)

    def test_valid_token_resolves_active_user(self):
        user = mock.Mock(is_active=True)
        token = hp.issue_access_token("u1")
        with mock.patch.object(hp, "_load_user", return_value=user):
            result = self.bearer.authenticate(_request(f"Bearer {token}"))
        self.assertIs(result[0], user)

    def test_valid_token_for_inactive_user_is_rejected(self):
        user = mock.Mock(is_active=False)
        token = hp.issue_access_token("u1")
        with mock.patch.object(hp, "_load_user", return_value=user):
            with self.assertRaises(self.AuthFailed):
                self.bearer.authenticate(_request(f"Bearer {token}"))


# ---------------------------------------------------------------------------
# Default-deny authorization
# ---------------------------------------------------------------------------

class DefaultDenyTests(SimpleTestCase):
    """Unconfigured tables and default Policy behaviour must deny, not allow."""

    def test_deny_all_matches_nothing(self):
        self.assertEqual(DENIED, _children(policies.deny_all(None)))

    def test_unregistered_table_has_no_policy(self):
        self.assertIsNone(policies.get_policy("no_such_table_xyz"))

    def test_employee_salaries_is_registered(self):
        self.assertIsNotNone(policies.get_policy("employee_salaries"))

    def test_default_policy_denies_update_and_delete(self):
        policy = policies.Policy(object())
        user = mock.Mock()
        self.assertEqual(DENIED, _children(policy.update_q(user)))
        self.assertEqual(DENIED, _children(policy.delete_q(user)))

    def test_default_policy_denies_insert_and_check(self):
        policy = policies.Policy(object())
        user = mock.Mock()
        self.assertFalse(policy.insert_ok(user, {}))
        self.assertFalse(policy.check_ok(user, {}, {}))


# ---------------------------------------------------------------------------
# Permission combinators and payroll gate
# ---------------------------------------------------------------------------

class PermissionCombinatorTests(SimpleTestCase):

    def test_perm_read_denies_without_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=False) as perm:
            q = policies.perm_read("view_employee")(user)
        perm.assert_called_once_with(user, "view_employee")
        self.assertEqual(DENIED, _children(q))

    def test_perm_read_allows_with_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=True) as perm:
            q = policies.perm_read("view_employee")(user)
        perm.assert_called_once_with(user, "view_employee")
        self.assertEqual([], _children(q))

    def test_scoped_write_denies_without_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=False) as perm:
            q = policies.scoped_write("employee_id", "manage_employee")(user)
        perm.assert_called_once_with(user, "manage_employee")
        self.assertEqual(DENIED, _children(q))

    def test_scoped_check_denies_without_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=False) as perm:
            ok = policies.scoped_check("employee_id", "manage_employee")(
                user, {}, {"employee_id": "e1"}
            )
        perm.assert_called_once_with(user, "manage_employee")
        self.assertFalse(ok)


class PayrollPermissionTests(SimpleTestCase):
    """employee_salaries read/write is gated on manage_payroll."""

    def test_sal_q_denies_without_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=False) as perm:
            q = policies._sal_q(user)
        perm.assert_called_once_with(user, "manage_payroll")
        self.assertEqual(DENIED, _children(q))

    def test_sal_check_denies_without_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=False) as perm:
            self.assertFalse(policies._sal_check(user, {}, {}))
        perm.assert_called_once_with(user, "manage_payroll")

    def test_sal_check_allows_with_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=True) as perm:
            self.assertTrue(policies._sal_check(user, {}, {}))
        perm.assert_called_once_with(user, "manage_payroll")

    def test_sal_q_admits_scoped_rows_with_permission(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=True) as perm, \
             mock.patch.object(policies, "_emp_ids", return_value=["e1", "e2"]) as emp_ids:
            q = policies._sal_q(user)
        perm.assert_called_once_with(user, "manage_payroll")
        emp_ids.assert_called_once_with(user)
        self.assertEqual([("employee_id__in", ["e1", "e2"])], _children(q))

    def test_sal_q_empty_scope_still_denies(self):
        user = mock.Mock()
        with mock.patch.object(policies, "perm", return_value=True), \
             mock.patch.object(policies, "_emp_ids", return_value=[]) as emp_ids:
            q = policies._sal_q(user)
        emp_ids.assert_called_once_with(user)
        self.assertEqual(DENIED, _children(q))

    def test_salary_delete_policy_denies_without_permission(self):
        user = mock.Mock()
        policy = policies.get_policy("employee_salaries")
        with mock.patch.object(policies, "perm", return_value=False) as perm:
            q = policy.delete_q(user)
        perm.assert_called_once_with(user, "manage_payroll")
        self.assertEqual(DENIED, _children(q))


# ---------------------------------------------------------------------------
# Object scope: self-ownership and manager reporting tree
# ---------------------------------------------------------------------------

class SelfScopeTests(SimpleTestCase):

    def test_is_self_employee_true_for_own_row(self):
        with mock.patch.object(rbac, "current_employee_id", return_value="e1"):
            self.assertTrue(rbac.is_self_employee(mock.Mock(), "e1"))

    def test_is_self_employee_false_for_other_row(self):
        with mock.patch.object(rbac, "current_employee_id", return_value="e1"):
            self.assertFalse(rbac.is_self_employee(mock.Mock(), "e2"))

    def test_is_self_employee_false_for_anonymous(self):
        self.assertFalse(rbac.is_self_employee(mock.Mock(is_anonymous=True), "e1"))

    def test_can_view_employee_q_without_view_permission_is_self_only(self):
        user = mock.Mock(pk="u1", is_anonymous=False)
        with mock.patch.object(rbac, "has_role", return_value=False), \
             mock.patch.object(rbac, "has_permission", return_value=False) as has_permission, \
             mock.patch.object(rbac, "current_employee", return_value=mock.Mock()):
            q = rbac.can_view_employee_q(user)
        has_permission.assert_called_once_with(user, "view_employee")
        self.assertEqual([("user_id", "u1")], _children(q))

    def test_can_view_employee_q_anonymous_matches_nothing(self):
        q = rbac.can_view_employee_q(mock.Mock(is_anonymous=True))
        self.assertEqual(DENIED, _children(q))


class ManagerScopeTests(SimpleTestCase):

    def test_reports_of_walks_direct_and_indirect_tree(self):
        tree = {"m1": ["d1", "d2"], "d1": ["g1"], "d2": [], "g1": []}

        def fake_filter(manager_id=None):
            qs = mock.Mock()
            qs.values_list.return_value = tree.get(manager_id, [])
            return qs

        with mock.patch.object(rbac, "Employee") as employee:
            employee.objects.filter.side_effect = fake_filter
            ids = rbac.reports_of("m1")
        self.assertEqual({"d1", "d2", "g1"}, set(ids))
        self.assertEqual(3, len(ids))

    def test_reports_of_empty_for_missing_manager(self):
        self.assertEqual([], rbac.reports_of(None))
        self.assertEqual([], rbac.reports_of(""))

    def test_scope_matches_direct_reports(self):
        me = mock.Mock(pk="m1")
        report = mock.Mock(pk="r1")
        outsider = mock.Mock(pk="r9")
        with mock.patch.object(rbac, "user_scope", return_value=rbac.DataScope.DIRECT_REPORTS), \
             mock.patch.object(rbac, "current_employee", return_value=me), \
             mock.patch.object(rbac, "reports_of", return_value=["r1"]):
            self.assertTrue(rbac._scope_matches(mock.Mock(), report))
            self.assertFalse(rbac._scope_matches(mock.Mock(), outsider))

    def test_scope_matches_organization(self):
        me = mock.Mock(organization_id="org1")
        same = mock.Mock(organization_id="org1")
        other = mock.Mock(organization_id="org2")
        with mock.patch.object(rbac, "user_scope", return_value=rbac.DataScope.ORGANIZATION), \
             mock.patch.object(rbac, "current_employee", return_value=me):
            self.assertTrue(rbac._scope_matches(mock.Mock(), same))
            self.assertFalse(rbac._scope_matches(mock.Mock(), other))

    def test_scope_matches_location(self):
        me = mock.Mock(location_id="loc1")
        same = mock.Mock(location_id="loc1")
        other = mock.Mock(location_id="loc2")
        with mock.patch.object(rbac, "user_scope", return_value=rbac.DataScope.LOCATION), \
             mock.patch.object(rbac, "current_employee", return_value=me):
            self.assertTrue(rbac._scope_matches(mock.Mock(), same))
            self.assertFalse(rbac._scope_matches(mock.Mock(), other))


# ---------------------------------------------------------------------------
# Admin endpoint guard + login validation
# ---------------------------------------------------------------------------

class AdminGuardTests(SimpleTestCase):

    def test_is_service_true_for_service_principal(self):
        self.assertTrue(auth_views._is_service(SimpleNamespace(user=hp.ServiceRoleUser())))

    def test_is_service_true_for_service_marker(self):
        self.assertTrue(
            auth_views._is_service(SimpleNamespace(user=SimpleNamespace(is_service_role=True)))
        )

    def test_is_service_false_for_regular_user(self):
        self.assertFalse(
            auth_views._is_service(SimpleNamespace(user=SimpleNamespace(is_service_role=False)))
        )

    def test_admin_users_guard_rejects_non_admin(self):
        request = SimpleNamespace(user=object())
        with mock.patch.object(auth_views, "has_role", return_value=False) as has_role:
            resp = auth_views.AdminUsersView()._guard(request)
        has_role.assert_called_once_with(request.user, "super_admin")
        self.assertEqual(401, resp.status_code)

    def test_admin_users_guard_allows_super_admin(self):
        request = SimpleNamespace(user=object())
        with mock.patch.object(auth_views, "has_role", return_value=True) as has_role:
            resp = auth_views.AdminUsersView()._guard(request)
        has_role.assert_called_once_with(request.user, "super_admin")
        self.assertIsNone(resp)

    def test_admin_user_by_id_guard_rejects_non_admin(self):
        request = SimpleNamespace(user=object())
        with mock.patch.object(auth_views, "has_role", return_value=False) as has_role:
            resp = auth_views.AdminUserByIdView()._guard(request)
        has_role.assert_called_once_with(request.user, "super_admin")
        self.assertEqual(401, resp.status_code)


class LoginValidationTests(SimpleTestCase):

    def test_missing_email_and_password_is_400(self):
        resp = auth_views.TokenView().post(SimpleNamespace(data={}))
        self.assertEqual(400, resp.status_code)

    def test_missing_password_is_400(self):
        resp = auth_views.TokenView().post(SimpleNamespace(data={"email": "a@b.c"}))
        self.assertEqual(400, resp.status_code)

    def test_blank_email_is_400(self):
        resp = auth_views.TokenView().post(
            SimpleNamespace(data={"email": "   ", "password": "x"})
        )
        self.assertEqual(400, resp.status_code)
