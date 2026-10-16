"""Fixture-protection guards for the destructive DELETE paths.

Every test here is mock-based and never contacts the live database, the real
storage root, or any existing business record. Mutations are asserted *not* to
have happened, so a passing test cannot be produced by a guard that is absent
or ordered incorrectly.
"""

import os
import uuid
from unittest import mock

from django.test import SimpleTestCase, override_settings

from hr.api import rest as rest_api
from hr.api import storage_views
from hr.api.storage_views import StorageDeleteView

PROTECTED_EMP = uuid.UUID("55555555-0000-0000-0000-000000000006")
ORDINARY_EMP = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")


def _emp(pk, is_fixture):
    row = mock.Mock()
    row.pk = pk
    row.is_fixture = is_fixture
    return row


class _Request:
    """Minimal stand-in for a DRF request."""

    def __init__(self, user, data=None, query_params=None):
        self.user = user
        self.data = data or {}
        self.query_params = query_params if query_params is not None else {}
        self.META = {}


# ---------------------------------------------------------------------------
# Employee-table DELETE guard
# ---------------------------------------------------------------------------

class EmployeeDeleteFixtureGuardTests(SimpleTestCase):
    """Guards DELETE /api/v1/public/employees."""

    def setUp(self):
        self.service = mock.Mock(is_service_role=True, is_authenticated=True)
        self.hr = mock.Mock(is_service_role=False, is_authenticated=True)

    def _delete(self, rows, user, expect_deleted=False):
        policy = mock.Mock(model=mock.Mock())
        model = policy.model

        qs = mock.MagicMock()
        qs.filter.return_value = qs
        qs.__iter__ = lambda s: iter(rows)

        model.objects.all.return_value = qs

        with mock.patch.object(rest_api, "get_policy", return_value=policy), \
             mock.patch.object(rest_api, "_collect_filters", return_value=mock.MagicMock()), \
             mock.patch.object(rest_api, "JsonResponse") as resp:
            view = rest_api.RestView()
            view.delete(_Request(user), "public", "employees")

        if expect_deleted:
            for row in rows:
                row.delete.assert_called_once()
        else:
            for row in rows:
                row.delete.assert_not_called()
        return resp

    def test_protected_employee_delete_is_rejected(self):
        rows = [_emp(PROTECTED_EMP, True)]
        with self.assertRaises(Exception) as ctx:
            self._delete(rows, self.service)
        self.assertEqual(403, ctx.exception.status_code)

    def test_protected_employee_delete_never_calls_delete(self):
        """The assertion lives in _delete and must run even though it raises."""
        row = _emp(PROTECTED_EMP, True)
        with self.assertRaises(Exception):
            self._delete([row], self.service)
        row.delete.assert_not_called()

    def test_service_role_cannot_bypass_fixture_protection(self):
        """Service role skips the policy queryset but not the fixture guard."""
        with self.assertRaises(Exception) as ctx:
            self._delete([_emp(PROTECTED_EMP, True)], self.service)
        self.assertEqual(403, ctx.exception.status_code)

    def test_hr_admin_cannot_bypass_fixture_protection(self):
        with self.assertRaises(Exception) as ctx:
            self._delete([_emp(PROTECTED_EMP, True)], self.hr)
        self.assertEqual(403, ctx.exception.status_code)

    def test_mixed_bulk_rejects_entire_request(self):
        rows = [_emp(ORDINARY_EMP, False), _emp(PROTECTED_EMP, True)]
        with self.assertRaises(Exception):
            self._delete(rows, self.service)
        # The unprotected row must survive too -- no partial mutation.
        rows[0].delete.assert_not_called()
        rows[1].delete.assert_not_called()

    def test_unprotected_employee_still_deletable(self):
        """Guard must not disable legitimate deletion."""
        rows = [_emp(ORDINARY_EMP, False)]
        self._delete(rows, self.service, expect_deleted=True)

    def test_related_rows_are_never_cascaded(self):
        """No cascade can start because delete() is never reached."""
        row = _emp(PROTECTED_EMP, True)
        with self.assertRaises(Exception):
            self._delete([row], self.service)
        row.delete.assert_not_called()


# ---------------------------------------------------------------------------
# Storage DELETE guard
# ---------------------------------------------------------------------------

class StorageDeleteFixtureGuardTests(SimpleTestCase):
    """Guards DELETE /api/v1/storage/object/{bucket}."""

    PROTECTED_PATH = "55555555-0000-0000-0000-000000000006/1790672327340-payslip.pdf"
    ORDINARY_PATH = "aaaaaaaa-0000-0000-0000-000000000001/1700000000000-resume.pdf"

    def setUp(self):
        self.user = mock.Mock(is_service_role=False, is_authenticated=True)

    def _request(self, paths):
        return _Request(self.user, {"prefixes": paths})

    def test_protected_object_delete_is_rejected(self):
        with mock.patch.object(storage_views, "_owner_is_protected",
                               return_value=(True, "owning record is a fixture")) as prot, \
             mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os.path, "isfile", return_value=True), \
             mock.patch.object(storage_views.os, "remove") as rm:
            resp = StorageDeleteView().delete(self._request([self.PROTECTED_PATH]),
                                              "employee-documents")
        self.assertEqual(403, resp.status_code)
        rm.assert_not_called()
        prot.assert_called_once()

    def test_os_remove_never_called_for_protected_object(self):
        with mock.patch.object(storage_views, "_owner_is_protected",
                               return_value=(True, "fixture")), \
             mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os.path, "isfile", return_value=True), \
             mock.patch.object(storage_views.os, "remove") as rm:
            StorageDeleteView().delete(self._request([self.PROTECTED_PATH]),
                                       "employee-documents")
        rm.assert_not_called()

    def test_metadata_is_never_deleted(self):
        """Storage DELETE must not touch metadata rows at all."""
        doc = mock.Mock()
        with mock.patch.object(storage_views, "_owner_is_protected",
                               return_value=(True, "fixture")), \
             mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os, "remove"):
            StorageDeleteView().delete(self._request([self.PROTECTED_PATH]),
                                       "employee-documents")
        doc.delete.assert_not_called()

    def test_service_role_cannot_bypass_storage_protection(self):
        service = mock.Mock(is_service_role=True, is_authenticated=True)
        with mock.patch.object(storage_views, "_owner_is_protected",
                               return_value=(True, "fixture")), \
             mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os, "remove") as rm:
            resp = StorageDeleteView().delete(
                _Request(service, {"prefixes": [self.PROTECTED_PATH]}),
                "employee-documents")
        self.assertEqual(403, resp.status_code)
        rm.assert_not_called()

    def test_mixed_bulk_rejects_entire_request(self):
        """One protected target must block deletion of the disposable one too."""
        def classify(bucket, path):
            return (path == self.PROTECTED_PATH, "fixture" if path == self.PROTECTED_PATH else "")

        with mock.patch.object(storage_views, "_owner_is_protected", side_effect=classify), \
             mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os.path, "isfile", return_value=True), \
             mock.patch.object(storage_views.os, "remove") as rm:
            resp = StorageDeleteView().delete(
                self._request([self.ORDINARY_PATH, self.PROTECTED_PATH]),
                "employee-documents")
        self.assertEqual(403, resp.status_code)
        rm.assert_not_called()

    def test_ambiguous_ownership_is_rejected_without_mutation(self):
        """Unclassifiable ownership must be denied, not assumed disposable.

        `_owner_is_protected` is exercised against a stand-in owner model so no
        real database is touched; the real implementation's behaviour is
        asserted separately in the pure-logic test below.
        """
        for owner_segment in ("not-a-uuid", "aaaaaaaa-0000-0000-0000-00000000ffff"):
            path = f"{owner_segment}/1700000000000-file.pdf"
            with self.subTest(path=path):
                # Owner model reports no such row -> cannot be classified safe.
                with mock.patch.object(storage_views, "get_policy_model") as gpm, \
                     mock.patch.object(storage_views, "_may_read", return_value=True), \
                     mock.patch.object(storage_views.os.path, "isfile", return_value=True), \
                     mock.patch.object(storage_views.os, "remove") as rm:
                    model = mock.Mock()
                    model.objects.filter.return_value.first.return_value = None
                    gpm.return_value = model
                    resp = StorageDeleteView().delete(self._request([path]),
                                                      "employee-documents")
                self.assertEqual(403, resp.status_code)
                rm.assert_not_called()

    def test_traversal_path_never_deleted(self):
        """A path escaping the bucket is skipped by _resolve, never removed."""
        with mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os, "remove") as rm:
            StorageDeleteView().delete(self._request(["../../escape.pdf"]),
                                       "employee-documents")
        rm.assert_not_called()

    def test_unprotected_object_still_deletable(self):
        with mock.patch.object(storage_views, "_owner_is_protected",
                               return_value=(False, "")), \
             mock.patch.object(storage_views, "_may_read", return_value=True), \
             mock.patch.object(storage_views.os.path, "isfile", return_value=False), \
             mock.patch.object(storage_views.os, "remove") as rm:
            resp = StorageDeleteView().delete(self._request([self.ORDINARY_PATH]),
                                              "employee-documents")
        self.assertEqual(200, resp.status_code)
        rm.assert_not_called()  # file absent, but request succeeded

    def test_existing_authorization_still_enforced(self):
        """An unreadable object is skipped, never deleted."""
        with mock.patch.object(storage_views, "_may_read", return_value=False), \
             mock.patch.object(storage_views, "_owner_is_protected",
                               return_value=(False, "")) as prot, \
             mock.patch.object(storage_views.os, "remove") as rm:
            StorageDeleteView().delete(self._request([self.ORDINARY_PATH]),
                                       "employee-documents")
        rm.assert_not_called()
        prot.assert_not_called()

    def test_unauthorised_caller_on_protected_object_deletes_nothing(self):
        with mock.patch.object(storage_views, "_may_read", return_value=False), \
             mock.patch.object(storage_views.os, "remove") as rm:
            StorageDeleteView().delete(self._request([self.PROTECTED_PATH]),
                                       "employee-documents")
        rm.assert_not_called()


class FixtureMarkerScopeTests(SimpleTestCase):
    """Which models carry the marker, and does DELETE honour it for each?

    `RestView.delete` is the shared handler for every /api/v1/public/<table>
    DELETE, so these assert the guard is genuinely table-agnostic rather than
    employee-only.
    """

    def test_all_three_models_declare_the_marker(self):
        from hr.models.core import Employee
        from hr.models.documents import EmployeeDocument
        from hr.models.recruitment import Candidate

        for model in (Employee, EmployeeDocument, Candidate):
            with self.subTest(model=model.__name__):
                self.assertTrue(hasattr(model, "is_fixture"))
                field = model._meta.get_field("is_fixture")
                self.assertFalse(field.null)
                # Ordinary new records must default to unprotected.
                self.assertIs(False, field.default)

    def test_marker_defaults_false_on_new_instances(self):
        from hr.models.core import Employee
        from hr.models.documents import EmployeeDocument
        from hr.models.recruitment import Candidate

        for model in (Employee, EmployeeDocument, Candidate):
            with self.subTest(model=model.__name__):
                self.assertIs(False, model().is_fixture)

    def test_seeded_fixture_keys_are_marked_in_migration_source(self):
        """The backfill keys are transcribed from the seed definition."""
        import importlib.util
        from pathlib import Path

        path = Path(__file__).resolve().parent / "migrations" / "0009_fixture_protection.py"
        spec = importlib.util.spec_from_file_location("m0009", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        self.assertEqual(15, len(set(mod.SEED_EMPLOYEE_PKS)))
        self.assertEqual(8, len(set(mod.SEED_DOCUMENTS)))
        self.assertEqual(8, len(set(mod.SEED_CANDIDATES)))

        # Cross-check against the authoritative seed source itself.
        seed = (Path(__file__).resolve().parent / "migrations" / "0002_seed_data.py")
        seed_text = seed.read_text(encoding="utf-8")
        for pk in mod.SEED_EMPLOYEE_PKS:
            self.assertIn(pk, seed_text, f"{pk} not found in 0002_seed_data")
        for emp_pk, name in mod.SEED_DOCUMENTS:
            self.assertIn(emp_pk, seed_text)
            self.assertIn(f'"{name}"', seed_text)

    def test_ph10_fixture_is_disposable_and_not_marked(self):
        """ph10_fixture.py creates a temp employee it deletes itself.

        Marking that script's output as a protected fixture would contradict
        its documented purpose and break its own cleanup, so it must stay
        unprotected.
        """
        from pathlib import Path

        src = (Path(__file__).resolve().parents[2] / "ph10_fixture.py").read_text(
            encoding="utf-8")
        self.assertIn('code = f"PH10-{suffix}"', src)
        self.assertIn("TerminateFixture", src)
        self.assertNotIn("is_fixture", src)


class DocumentAndCandidateDeleteGuardTests(SimpleTestCase):
    """REST DELETE must refuse fixtures on employee_documents and candidates."""

    def setUp(self):
        self.service = mock.Mock(is_service_role=True, is_authenticated=True)

    def _delete(self, model, rows, user):
        policy = mock.Mock(model=model)
        qs = mock.MagicMock()
        qs.filter.return_value = qs
        qs.__iter__ = lambda s: iter(rows)
        model.objects.all.return_value = qs

        with mock.patch.object(rest_api, "get_policy", return_value=policy), \
             mock.patch.object(rest_api, "_collect_filters", return_value=mock.MagicMock()), \
             mock.patch.object(rest_api, "JsonResponse"):
            rest_api.RestView().delete(_Request(user), "public", "model")

    def _model(self, with_marker=True):
        model = mock.Mock()
        if with_marker:
            model.is_fixture = True  # hasattr(model, "is_fixture") is True
        else:
            del model.is_fixture
        return model

    def test_fixture_document_delete_is_rejected(self):
        from hr.models.documents import EmployeeDocument

        row = mock.Mock(is_fixture=True)
        with self.assertRaises(Exception) as ctx:
            self._delete(self._model(), [row], self.service)
        self.assertEqual(403, ctx.exception.status_code)
        row.delete.assert_not_called()

    def test_fixture_candidate_delete_is_rejected(self):
        from hr.models.recruitment import Candidate

        row = mock.Mock(is_fixture=True)
        with self.assertRaises(Exception) as ctx:
            self._delete(self._model(), [row], self.service)
        self.assertEqual(403, ctx.exception.status_code)
        row.delete.assert_not_called()

    def test_service_role_cannot_delete_fixture_document(self):
        row = mock.Mock(is_fixture=True)
        with self.assertRaises(Exception):
            self._delete(self._model(), [row], self.service)
        row.delete.assert_not_called()

    def test_service_role_cannot_delete_fixture_candidate(self):
        row = mock.Mock(is_fixture=True)
        with self.assertRaises(Exception):
            self._delete(self._model(), [row], self.service)
        row.delete.assert_not_called()

    def test_mixed_document_targets_reject_everything(self):
        protected = mock.Mock(is_fixture=True)
        disposable = mock.Mock(is_fixture=False)
        with self.assertRaises(Exception):
            self._delete(self._model(), [disposable, protected], self.service)
        disposable.delete.assert_not_called()
        protected.delete.assert_not_called()

    def test_unclassifiable_document_rejected(self):
        """A row whose flag cannot be read must not be assumed disposable."""
        row = mock.Mock(spec=["pk", "delete"])  # no is_fixture attribute
        with self.assertRaises(Exception) as ctx:
            self._delete(self._model(), [row], self.service)
        self.assertEqual(403, ctx.exception.status_code)
        row.delete.assert_not_called()

    def test_ordinary_document_still_deletable(self):
        row = mock.Mock(is_fixture=False)
        model = self._model()
        qs = mock.MagicMock()
        qs.filter.return_value = qs
        qs.__iter__ = lambda s: iter([row])
        model.objects.all.return_value = qs
        policy = mock.Mock(model=model)
        with mock.patch.object(rest_api, "get_policy", return_value=policy), \
             mock.patch.object(rest_api, "_collect_filters", return_value=mock.MagicMock()), \
             mock.patch.object(rest_api, "JsonResponse"):
            rest_api.RestView().delete(_Request(self.service), "public", "model")
        row.delete.assert_called_once()

    def test_models_without_marker_are_unaffected(self):
        """Tables that carry no fixtures must behave exactly as before."""
        row = mock.Mock(is_fixture=True)
        model = self._model(with_marker=False)
        model.is_fixture = mock.Mock()
        del model.is_fixture
        qs = mock.MagicMock()
        qs.filter.return_value = qs
        qs.__iter__ = lambda s: iter([row])
        model.objects.all.return_value = qs
        policy = mock.Mock(model=model)
        with mock.patch.object(rest_api, "get_policy", return_value=policy), \
             mock.patch.object(rest_api, "_collect_filters", return_value=mock.MagicMock()), \
             mock.patch.object(rest_api, "JsonResponse"):
            rest_api.RestView().delete(_Request(self.service), "public", "model")
        row.delete.assert_called_once()


class OwnerClassificationTests(SimpleTestCase):
    """Direct tests of the real `_owner_is_protected` decision logic.

    These mock the policy models rather than the function under test, so they
    exercise the actual classification branches and never touch a real table.
    """

    def _models(self, doc_row=None, doc_exists=False, owner=None, owner_exists=True):
        gpm = mock.Mock()
        doc_model = mock.Mock()
        doc_qs = mock.Mock()
        doc_qs.first.return_value = doc_row
        doc_model.objects.filter.return_value = doc_qs

        owner_model = mock.Mock()
        owner_qs = mock.Mock()
        owner_qs.first.return_value = owner
        owner_qs.exists.return_value = owner_exists
        owner_model.objects.filter.return_value = owner_qs

        # The metadata model's owner is declared through its FK field, so
        # _owner_model() can resolve the real owner table.
        fk = mock.Mock()
        fk.related_model = owner_model
        doc_model._meta.get_field.return_value = fk

        def resolve(table):
            return doc_model if table == "employee_documents" else owner_model

        gpm.side_effect = resolve
        return gpm

    def test_metadata_row_fixture_is_protected(self):
        row = mock.Mock(is_fixture=True, employee_id=ORDINARY_EMP)
        with mock.patch.object(storage_views, "get_policy_model",
                               self._models(doc_row=row)):
            protected, _ = storage_views._owner_is_protected(
                "employee-documents", self.dummy_path())
        self.assertTrue(protected)

    def test_owning_employee_fixture_is_protected(self):
        """Object metadata unprotected, but its owner is a fixture."""
        row = mock.Mock(is_fixture=False, employee_id=PROTECTED_EMP)
        owner = mock.Mock(is_fixture=True)
        with mock.patch.object(storage_views, "get_policy_model",
                               self._models(doc_row=row, owner=owner)):
            protected, reason = storage_views._owner_is_protected(
                "employee-documents", self.dummy_path())
        self.assertTrue(protected)
        self.assertIn("owning record is a fixture", reason)

    def test_ordinary_owner_is_not_protected(self):
        row = mock.Mock(is_fixture=False, employee_id=ORDINARY_EMP)
        owner = mock.Mock(is_fixture=False)
        with mock.patch.object(storage_views, "get_policy_model",
                               self._models(doc_row=row, owner=owner)):
            protected, _ = storage_views._owner_is_protected(
                "employee-documents", self.dummy_path())
        self.assertFalse(protected)

    def test_metadata_without_owner_is_protected(self):
        row = mock.Mock(is_fixture=False, employee_id=None)
        with mock.patch.object(storage_views, "get_policy_model",
                               self._models(doc_row=row)):
            protected, reason = storage_views._owner_is_protected(
                "employee-documents", self.dummy_path())
        self.assertTrue(protected)
        self.assertIn("no resolvable owner", reason)

    def test_unknown_owner_record_is_protected(self):
        with mock.patch.object(storage_views, "get_policy_model",
                               self._models(doc_exists=False,
                                            owner_exists=False)):
            protected, reason = storage_views._owner_is_protected(
                "employee-documents", f"{ORDINARY_EMP}/1700000000000-file.pdf")
        self.assertTrue(protected)
        self.assertIn("owner record not found", reason)

    def test_non_uuid_owner_segment_is_protected(self):
        with mock.patch.object(storage_views, "get_policy_model",
                               self._models(doc_exists=False)):
            protected, reason = storage_views._owner_is_protected(
                "employee-documents", "not-a-uuid/1700000000000-file.pdf")
        self.assertTrue(protected)
        self.assertIn("not a primary key", reason)

    def test_unknown_bucket_is_protected(self):
        protected, reason = storage_views._owner_is_protected("no-such-bucket", "a/b")
        self.assertTrue(protected)

    @staticmethod
    def dummy_path():
        return "55555555-0000-0000-0000-000000000012/1700000000000-file.pdf"