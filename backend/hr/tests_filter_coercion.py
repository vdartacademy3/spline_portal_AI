"""Focused regression tests for filter coercion (defect 7).

Covers invalid values on typed columns, distinguishing a rejected parse (400)
from a valid value that merely matches zero rows. Pure parser-level tests:
no database writes, no DELETE, no authenticated requests, no storage access.

Run with:
    python manage.py test hr.tests_filter_coercion
"""

import os

from django.test import SimpleTestCase

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")

from hr.api import rest as rest_api  # noqa: E402
from hr.models import (  # noqa: E402
    Employee,
    LeavePolicy,
    LeaveRequest,
    Notification,
    Offer,
)


class InvalidValueCoercionTests(SimpleTestCase):
    """Invalid values on typed columns must produce a controlled 400."""

    def _build(self, model, column, op, value):
        with self.assertRaises(Exception) as ctx:
            rest_api._build_condition(model, column, op, value)
        return ctx.exception

    # ------------------------------------------------------------------
    # BooleanField: previously passed an unrecognized token straight into the
    # query, which PostgreSQL refused at execution (DataError -> HTTP 500).
    # ------------------------------------------------------------------

    def test_boolean_rejects_unrecognized_literal(self):
        exc = self._build(LeavePolicy, "requires_approval", "eq", "maybe")
        self.assertEqual(400, exc.status_code)

    def test_boolean_rejects_yes(self):
        exc = self._build(Notification, "read", "eq", "yes")
        self.assertEqual(400, exc.status_code)

    def test_boolean_rejects_empty_string(self):
        exc = self._build(Notification, "read", "eq", "")
        self.assertEqual(400, exc.status_code)

    # ------------------------------------------------------------------
    # Valid boolean tokens must still parse -- the guard must not overreach.
    # ------------------------------------------------------------------

    def test_boolean_accepts_true_tokens(self):
        for token in ("true", "t", "1", "TRUE"):
            self.assertIsNotNone(rest_api._build_condition(Notification, "read", "eq", token))

    def test_boolean_accepts_false_tokens(self):
        for token in ("false", "f", "0", "FALSE"):
            self.assertIsNotNone(rest_api._build_condition(Notification, "read", "eq", token))

    # ------------------------------------------------------------------
    # A *valid* value that matches no row must NOT be an error.
    # ------------------------------------------------------------------

    def test_valid_uuid_that_matches_no_row_is_not_an_error(self):
        q = rest_api._build_condition(
            Offer, "id", "eq", "11111111-1111-1111-1111-111111111111"
        )
        self.assertIsNotNone(q)

    def test_invalid_uuid_is_an_error(self):
        exc = self._build(Offer, "id", "eq", "not-a-uuid")
        self.assertEqual(400, exc.status_code)

    def test_invalid_uuid_inside_in_list_is_an_error(self):
        exc = self._build(
            Offer, "id", "in", "11111111-1111-1111-1111-111111111111,zzzz"
        )
        self.assertEqual(400, exc.status_code)

    def test_foreign_key_to_uuid_rejects_non_uuid(self):
        exc = self._build(Employee, "user_id", "eq", "zzzz")
        self.assertEqual(400, exc.status_code)

    # ------------------------------------------------------------------
    # Operators other than eq must validate consistently.
    # ------------------------------------------------------------------

    def test_neq_on_uuid_validates(self):
        exc = self._build(Employee, "user_id", "neq", "zzzz")
        self.assertEqual(400, exc.status_code)

    def test_gt_on_uuid_validates(self):
        exc = self._build(Employee, "user_id", "gt", "zzzz")
        self.assertEqual(400, exc.status_code)

    def test_negated_filter_validates(self):
        with self.assertRaises(Exception) as ctx:
            rest_api._parse_condition(Employee, "not.user_id.eq.zzzz")
        self.assertEqual(400, ctx.exception.status_code)

    # ------------------------------------------------------------------
    # Non-UUID columns must keep accepting arbitrary strings.
    # ------------------------------------------------------------------

    def test_text_column_accepts_arbitrary_value(self):
        self.assertIsNotNone(rest_api._build_condition(Employee, "first_name", "eq", "zzzz"))

    def test_half_day_flag_validates_like_the_other_booleans(self):
        exc = self._build(LeaveRequest, "is_half_day", "eq", "perhaps")
        self.assertEqual(400, exc.status_code)
