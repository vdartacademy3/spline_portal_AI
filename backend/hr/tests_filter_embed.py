"""Focused regression tests for two REST-layer defects.

1. LIKE / ILIKE filters on non-text columns (UUID, FK-to-UUID) compile into a
   SQL `~~` operator that PostgreSQL rejects with
   `operator does not exist: uuid ~~ unknown`, surfacing as HTTP 500.
   The handler must instead answer a controlled 400.

2. Reverse embedding by *child table name* (e.g. `interview_feedback(...)`
   on `interviews`) resolved to None and was silently dropped.

Pure model-metadata and parser checks: no database writes, no DELETE, no
authenticated requests, no storage access.

Run with:
    python manage.py test hr.tests_filter_embed
"""

import os

from django.test import SimpleTestCase

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")

from hr.api import rest as rest_api  # noqa: E402
from hr.models import Candidate, Employee, Interview, InterviewFeedback, Organization  # noqa: E402


class _Request:
    def __init__(self, data=None, query_params=None):
        self.data = data or {}
        self.query_params = query_params or {}
        self.META = {}


class _User:
    is_service_role = False
    is_authenticated = True


class PatternOnNonTextTests(SimpleTestCase):
    """Defect 5: LIKE/ILIKE on UUID or FK-to-UUID columns must 400, not 500."""

    def _build(self, model, column, op, value):
        with self.assertRaises(Exception) as ctx:
            rest_api._build_condition(model, column, op, value)
        return ctx.exception

    # ------------------------------------------------------------------
    # The fields these assertions target
    # ------------------------------------------------------------------

    def test_uuid_primary_key_like_is_rejected(self):
        exc = self._build(Employee, "id", "like", "*")
        self.assertEqual(400, exc.status_code)

    def test_uuid_primary_key_ilike_is_rejected(self):
        exc = self._build(Employee, "id", "ilike", "%a%")
        self.assertEqual(400, exc.status_code)

    def test_foreign_key_to_uuid_like_is_rejected(self):
        # employees.user_id is a FK to users.id (UUID).
        exc = self._build(Employee, "user_id", "like", "*")
        self.assertEqual(400, exc.status_code)

    def test_integer_column_like_is_rejected(self):
        exc = self._build(Organization, "id", "like", "*")
        self.assertEqual(400, exc.status_code)

    def test_negated_like_on_uuid_is_rejected(self):
        with self.assertRaises(Exception) as ctx:
            rest_api._parse_condition(Employee, "not.id.like.*")
        self.assertEqual(400, ctx.exception.status_code)

    def test_pattern_on_text_column_is_still_allowed(self):
        """CharField/TextField must keep working -- the guard must not overreach."""
        q = rest_api._build_condition(Employee, "first_name", "like", "An%")
        self.assertIsNotNone(q)
        q2 = rest_api._build_condition(Employee, "first_name", "ilike", "an%")
        self.assertIsNotNone(q2)

    def test_equality_on_uuid_is_unaffected(self):
        """eq coercion must keep its existing 400-on-invalid-uuid behaviour."""
        with self.assertRaises(Exception) as ctx:
            rest_api._build_condition(Employee, "id", "eq", "not-a-uuid")
        self.assertEqual(400, ctx.exception.status_code)

    def test_pattern_on_uuid_via_full_parse_condition(self):
        with self.assertRaises(Exception) as ctx:
            rest_api._parse_condition(Employee, "id.like.*")
        self.assertEqual(400, ctx.exception.status_code)


class ReverseEmbedTests(SimpleTestCase):
    """Defect 6: reverse embed by child table name must resolve, not be dropped."""

    def test_interview_feedback_embed_by_table_name_resolves(self):
        res = rest_api._embed_relation(Interview, "interview_feedback")
        self.assertIsNotNone(res)
        direction, _ref, model = res
        self.assertEqual("reverse", direction)
        self.assertIs(InterviewFeedback, model)

    def test_interview_feedback_embed_by_accessor_name_still_resolves(self):
        res = rest_api._embed_relation(Interview, "interviewfeedback_set")
        self.assertIsNotNone(res)
        direction, _ref, model = res
        self.assertEqual("reverse", direction)
        self.assertIs(InterviewFeedback, model)

    def test_forward_embed_by_target_table_name_still_resolves(self):
        """The pre-existing forward path (e.g. `candidates` on applications) must
        keep working."""
        from hr.models import Application
        res = rest_api._embed_relation(Application, "candidates")
        self.assertIsNotNone(res)
        direction, _ref, model = res
        self.assertEqual("forward", direction)
        self.assertIs(Candidate, model)

    def test_unknown_embed_name_returns_none(self):
        self.assertIsNone(rest_api._embed_relation(Interview, "no_such_table_xyz"))
        self.assertIsNone(rest_api._embed_relation(Organization, "interview_feedback"))

    def test_reverse_embed_is_reachable_from_serialize(self):
        """serialize_instance must actually embed the child rows rather than
        skipping the relation, once the embed name resolves."""
        from unittest import mock

        interview = mock.Mock(spec=Interview)
        for f in Interview._meta.local_fields:
            setattr(interview, f.attname, None)
        feedback = mock.Mock(spec=InterviewFeedback)
        for f in InterviewFeedback._meta.local_fields:
            setattr(feedback, f.attname, None)
        interview.interviewfeedback_set = mock.Mock()
        interview.interviewfeedback_set.all.return_value = [feedback]

        with mock.patch.object(rest_api, "get_policy", return_value=None):
            out = rest_api.serialize_instance(
                interview, None, [("interview_feedback", "*")], None
            )
        self.assertIn("interview_feedback", out)
        self.assertEqual(1, len(out["interview_feedback"]))
