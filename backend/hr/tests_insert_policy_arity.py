"""Offline regression tests for the previously reported INSERT policy defects.

These pin the *already-mitigated* arity / wiring behaviour in
``backend/hr/policies.py`` so it cannot silently regress:

  * ``org_check`` predicates (declared ``(user, old, new)``) used as ``insert=``;
  * ``perm_write`` used as ``insert=`` -- the permission *code*, not the INSERT
    payload, must reach ``perm()``;
  * ``_asset_assign_check`` (declared ``(user, old, new)``) used as ``insert=``;
  * every registered policy is invokable through ``insert_ok(user, data)`` and
    ``check_ok(user, old, new)`` without raising ``TypeError`` or an
    unhashable-dictionary error.

The ORM/RBAC leaf calls are mocked; no database, network, HTTP, storage or real
account is touched.  ``SimpleTestCase`` additionally forbids accidental database
access, so a missing mock fails loudly instead of opening a connection.

Run with:
    python manage.py test hr.tests_insert_policy_arity
"""

import os
from contextlib import ExitStack
from unittest import mock

from django.test import SimpleTestCase

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")

from hr import policies  # noqa: E402
from hr import rbac  # noqa: E402


# Tables whose INSERT policy is ``org_check("manage_recruitment")``.
_RECRUITMENT_ORG_TABLES = (
    "job_requisitions",
    "candidates",
    "applications",
    "interviews",
    "offers",
)

# Representative tables whose INSERT policy is ``perm_write(<code>)``.
_PERM_WRITE_INSERT_TABLES = (
    ("shifts", "manage_shifts"),
    ("leave_policies", "manage_leave"),
    ("company_assets", "manage_assets"),
    ("training_programs", "manage_training"),
    ("payroll_runs", "manage_payroll"),
)


def _plain_user(pk="u1"):
    """A non-anonymous, non-service user double (no ORM touched)."""
    return mock.Mock(pk=pk, is_anonymous=False, is_service_role=False)


# ---------------------------------------------------------------------------
# 1. org_check used as an INSERT policy
# ---------------------------------------------------------------------------

class OrgCheckInsertTests(SimpleTestCase):
    """``org_check`` as ``insert=`` enforces permission + organization scope."""

    def setUp(self):
        self.user = _plain_user()

    def _raw_insert(self, table, payload, permitted=True):
        """Call insert_ok with the real ``rbac.in_my_org`` logic (subcalls mocked)."""
        with mock.patch.object(policies, "perm", return_value=permitted), \
             mock.patch.object(rbac, "has_role", return_value=False), \
             mock.patch.object(rbac, "user_scope",
                               return_value=rbac.DataScope.ORGANIZATION), \
             mock.patch.object(rbac, "current_organization_id", return_value="org-1"):
            return policies.get_policy(table).insert_ok(self.user, payload)

    def _raw_check(self, table, payload, permitted=True):
        with mock.patch.object(policies, "perm", return_value=permitted), \
             mock.patch.object(rbac, "has_role", return_value=False), \
             mock.patch.object(rbac, "user_scope",
                               return_value=rbac.DataScope.ORGANIZATION), \
             mock.patch.object(rbac, "current_organization_id", return_value="org-1"):
            return policies.get_policy(table).check_ok(self.user, {}, payload)

    def test_predicate_exposes_three_arg_contract(self):
        """A ``(user, old, new)`` predicate is what ``_adapt_insert`` wraps."""
        self.assertEqual(3, policies._positional_arity(policies.org_check("manage_recruitment")))

    def test_insert_denies_without_permission(self):
        for table in _RECRUITMENT_ORG_TABLES:
            with self.subTest(table=table):
                policy = policies.get_policy(table)
                self.assertIsNotNone(policy)
                with mock.patch.object(policies, "perm", return_value=False) as perm, \
                     mock.patch.object(rbac, "in_my_org") as in_my_org:
                    result = policy.insert_ok(self.user, {"organization_id": "org-1"})
                self.assertIsInstance(result, bool)
                self.assertFalse(result)
                perm.assert_called_once_with(self.user, "manage_recruitment")
                in_my_org.assert_not_called()

    def test_insert_allows_same_organization(self):
        for table in _RECRUITMENT_ORG_TABLES:
            with self.subTest(table=table):
                result = self._raw_insert(table, {"organization_id": "org-1"})
                self.assertIsInstance(result, bool)
                self.assertTrue(result)

    def test_insert_denies_foreign_organization(self):
        for table in _RECRUITMENT_ORG_TABLES:
            with self.subTest(table=table):
                result = self._raw_insert(table, {"organization_id": "org-2"})
                self.assertIsInstance(result, bool)
                self.assertFalse(result)

    def test_insert_denies_missing_organization(self):
        """No organization on the row -> ``in_my_org(user, None)`` -> denied."""
        for table in _RECRUITMENT_ORG_TABLES:
            for payload in ({}, {"organization_id": None}, {"organization_id": ""}):
                with self.subTest(table=table, payload=payload):
                    result = self._raw_insert(table, payload)
                    self.assertIsInstance(result, bool)
                    self.assertFalse(result)

    def test_check_ok_matches_insert_organization_scope(self):
        for table in _RECRUITMENT_ORG_TABLES:
            with self.subTest(table=table):
                self.assertTrue(self._raw_check(table, {"organization_id": "org-1"}))
                self.assertFalse(self._raw_check(table, {"organization_id": "org-2"}))
                self.assertFalse(self._raw_check(table, {}))


# ---------------------------------------------------------------------------
# 2. perm_write used as an INSERT policy
# ---------------------------------------------------------------------------

class PermWriteInsertTests(SimpleTestCase):
    """``perm_write`` as ``insert=`` must bind the code, never the payload."""

    def setUp(self):
        self.user = _plain_user()

    def test_insert_denies_without_permission(self):
        for table, code in _PERM_WRITE_INSERT_TABLES:
            with self.subTest(table=table):
                with mock.patch.object(policies, "perm", return_value=False) as perm:
                    result = policies.get_policy(table).insert_ok(self.user, {"id": "x"})
                self.assertIsInstance(result, bool)
                self.assertFalse(result)
                perm.assert_called_once_with(self.user, code)

    def test_insert_allows_with_permission(self):
        for table, code in _PERM_WRITE_INSERT_TABLES:
            with self.subTest(table=table):
                with mock.patch.object(policies, "perm", return_value=True):
                    result = policies.get_policy(table).insert_ok(self.user, {"id": "x"})
                self.assertIsInstance(result, bool)
                self.assertTrue(result)

    def test_insert_binds_code_not_payload(self):
        """A payload keyed like the code must still pass the string code to perm().

        With the old two-argument factory the payload dict bound to ``code``,
        so ``perm(user, {...})`` raised ``unhashable type: 'dict'`` -> 500.
        """
        for table, code in _PERM_WRITE_INSERT_TABLES:
            with self.subTest(table=table):
                payload = {code: {"not": "a code"}, "id": "x"}
                with mock.patch.object(policies, "perm", return_value=True) as perm:
                    result = policies.get_policy(table).insert_ok(self.user, payload)
                self.assertIsInstance(result, bool)
                self.assertTrue(result)
                perm.assert_called_once_with(self.user, code)

    def test_raw_factory_accepts_insert_call_shape(self):
        """The factory itself tolerates the ``(user, data)`` call shape."""
        for _, code in _PERM_WRITE_INSERT_TABLES:
            with self.subTest(code=code):
                factory = policies.perm_write(code)
                with mock.patch.object(policies, "perm", return_value=True) as perm:
                    result = factory(self.user, {"id": "x"})
                self.assertIsInstance(result, bool)
                self.assertTrue(result)
                perm.assert_called_once_with(self.user, code)

    def test_check_ok_uses_permission_code(self):
        for table, code in _PERM_WRITE_INSERT_TABLES:
            with self.subTest(table=table):
                with mock.patch.object(policies, "perm", return_value=True) as perm:
                    result = policies.get_policy(table).check_ok(self.user, {}, {})
                self.assertIsInstance(result, bool)
                self.assertTrue(result)
                perm.assert_called_once_with(self.user, code)


# ---------------------------------------------------------------------------
# 3. _asset_assign_check used as an INSERT policy
# ---------------------------------------------------------------------------

class AssetAssignCheckInsertTests(SimpleTestCase):
    """``employee_asset_assignments`` INSERT uses ``_asset_assign_check``."""

    def setUp(self):
        self.user = _plain_user()
        self.policy = policies.get_policy("employee_asset_assignments")

    def test_policy_is_registered(self):
        self.assertIsNotNone(self.policy)

    def test_predicate_exposes_three_arg_contract(self):
        self.assertEqual(3, policies._positional_arity(policies._asset_assign_check))

    def test_insert_denies_without_permission(self):
        with mock.patch.object(policies, "perm", return_value=False) as perm, \
             mock.patch.object(rbac, "can_view_employee", return_value=True) as can_view:
            result = self.policy.insert_ok(self.user, {"employee_id": "e1"})
        self.assertIsInstance(result, bool)
        self.assertFalse(result)
        perm.assert_called_once_with(self.user, "manage_assets")
        can_view.assert_not_called()

    def test_insert_allows_when_no_employee_binding(self):
        with mock.patch.object(policies, "perm", return_value=True), \
             mock.patch.object(rbac, "can_view_employee", return_value=False) as can_view:
            result = self.policy.insert_ok(self.user, {})
        self.assertIsInstance(result, bool)
        self.assertTrue(result)
        can_view.assert_not_called()

    def test_insert_allows_visible_employee(self):
        with mock.patch.object(policies, "perm", return_value=True), \
             mock.patch.object(rbac, "can_view_employee", return_value=True) as can_view:
            result = self.policy.insert_ok(self.user, {"employee_id": "e1"})
        self.assertIsInstance(result, bool)
        self.assertTrue(result)
        can_view.assert_called_once_with(self.user, "e1")

    def test_insert_denies_invisible_employee(self):
        with mock.patch.object(policies, "perm", return_value=True), \
             mock.patch.object(rbac, "can_view_employee", return_value=False):
            result = self.policy.insert_ok(self.user, {"employee_id": "e9"})
        self.assertIsInstance(result, bool)
        self.assertFalse(result)

    def test_check_ok_uses_perm_write_manage_assets(self):
        """The *check* half of this table is ``perm_write("manage_assets")``."""
        with mock.patch.object(policies, "perm", return_value=True) as perm:
            result = self.policy.check_ok(self.user, {}, {"employee_id": "e1"})
        self.assertIsInstance(result, bool)
        self.assertTrue(result)
        perm.assert_called_once_with(self.user, "manage_assets")


# ---------------------------------------------------------------------------
# 4. Tenant-isolation contract behind org_check (real rbac.in_my_org)
# ---------------------------------------------------------------------------

class TenantIsolationTests(SimpleTestCase):
    """``rbac.in_my_org`` denies missing/foreign organizations for scoped users."""

    def setUp(self):
        self.user = _plain_user()

    def _in_my_org(self, org, current="org-1", super_admin=False):
        with mock.patch.object(rbac, "has_role", return_value=super_admin), \
             mock.patch.object(rbac, "user_scope",
                               return_value=rbac.DataScope.ORGANIZATION), \
             mock.patch.object(rbac, "current_organization_id", return_value=current):
            return rbac.in_my_org(self.user, org)

    def test_same_organization_allowed(self):
        self.assertTrue(self._in_my_org("org-1"))

    def test_foreign_organization_denied(self):
        self.assertFalse(self._in_my_org("org-2"))

    def test_missing_organization_denied(self):
        for org in (None, ""):
            with self.subTest(org=org):
                self.assertFalse(self._in_my_org(org))

    def test_super_admin_allowed_without_organization(self):
        self.assertTrue(self._in_my_org(None, super_admin=True))

    def test_anonymous_denied(self):
        anon = mock.Mock(pk="anon", is_anonymous=True)
        self.assertFalse(rbac.in_my_org(anon, "org-1"))


# ---------------------------------------------------------------------------
# 5. Consistent invocation across the whole registry
# ---------------------------------------------------------------------------

class InsertContractSweepTests(SimpleTestCase):
    """Every registered policy must accept insert_ok / check_ok without arity errors."""

    def _permissive_stack(self):
        """Patch every ORM/RBAC leaf so no predicate reaches the database."""
        stack = ExitStack()
        stack.enter_context(mock.patch.object(policies, "perm", return_value=True))
        stack.enter_context(mock.patch.object(policies, "_self_emp", return_value=None))
        stack.enter_context(mock.patch.object(policies, "_emp_ids", return_value=[]))
        for name, value in (
            ("has_role", False),
            ("has_permission", True),
            ("is_hr", False),
            ("is_admin", False),
            ("is_manager", False),
            ("user_scope", rbac.DataScope.ORGANIZATION),
            ("current_organization_id", "org-1"),
            ("current_employee_id", None),
            ("current_employee", None),
            ("in_my_org", True),
            ("can_view_employee", True),
            ("can_place_employee", True),
            ("reports_of", []),
        ):
            stack.enter_context(mock.patch.object(rbac, name, return_value=value))
        return stack

    def test_insert_ok_and_check_ok_return_bool_for_every_policy(self):
        user = _plain_user()
        payloads = (
            {},
            {
                "organization_id": "org-1",
                "employee_id": "e1",
                "created_by": user.pk,
                "reviewer_id": "e1",
            },
        )
        with self._permissive_stack():
            for table, policy in sorted(policies.POLICIES.items()):
                for payload in payloads:
                    with self.subTest(table=table, payload=payload):
                        ins = policy.insert_ok(user, dict(payload))
                        self.assertIsInstance(ins, bool, f"{table}.insert_ok must return bool")
                        chk = policy.check_ok(user, {}, dict(payload))
                        self.assertIsInstance(chk, bool, f"{table}.check_ok must return bool")

    def test_org_check_and_perm_write_tables_are_present(self):
        for table in _RECRUITMENT_ORG_TABLES:
            self.assertIsNotNone(policies.get_policy(table), table)
        for table, _ in _PERM_WRITE_INSERT_TABLES:
            self.assertIsNotNone(policies.get_policy(table), table)
        self.assertIsNotNone(policies.get_policy("employee_asset_assignments"))
