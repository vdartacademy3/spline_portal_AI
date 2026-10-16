"""Durable fixture protection metadata.

Adds ``is_fixture`` to employees, employee_documents and candidates, then marks
only the rows whose ownership is proven by the authoritative seed definitions
in ``0002_seed_data``:

* employees    -- the exact ``pk`` values listed in ``emp_rows``.
* documents    -- the ``(employee, name)`` pairs listed in ``docs``, which is
                  the same natural key ``0002`` uses for ``get_or_create``.
                  (Those rows carry random UUIDs, so the PK cannot be known.)
* candidates   -- the ``(job, email)`` pairs listed in ``candidates``, the same
                  natural key ``0002`` uses for ``get_or_create``. Candidate PKs
                  are random, so PKs cannot be known either.

Both natural keys are exact values read from the seed source, not patterns.
Nothing is inferred from UUID ranges, names, emails, timestamps or filenames,
and no row is marked merely because it existed when the migration ran.

The operations are strictly additive: a boolean column defaulting to False,
plus an UPDATE confined to the boolean column of rows proven to be fixtures.
No row is created, deleted, re-keyed or overwritten, and no storage object is
touched. The reverse migration clears the flag and drops the columns; it does
not delete business records or files.
"""

from django.db import migrations, models

# --- exact values transcribed from backend/hr/migrations/0002_seed_data.py ---

SEED_EMPLOYEE_PKS = [
    "55555555-0000-0000-0000-000000000001",
    "55555555-0000-0000-0000-000000000002",
    "55555555-0000-0000-0000-000000000003",
    "55555555-0000-0000-0000-000000000004",
    "55555555-0000-0000-0000-000000000005",
    "55555555-0000-0000-0000-000000000006",
    "55555555-0000-0000-0000-000000000007",
    "55555555-0000-0000-0000-000000000008",
    "55555555-0000-0000-0000-000000000009",
    "55555555-0000-0000-0000-000000000010",
    "55555555-0000-0000-0000-000000000011",
    "55555555-0000-0000-0000-000000000012",
    "55555555-0000-0000-0000-000000000013",
    "55555555-0000-0000-0000-000000000014",
    "55555555-0000-0000-0000-000000000015",
]

# (employee pk, document name) -- the get_or_create lookup key in 0002.
SEED_DOCUMENTS = [
    ("55555555-0000-0000-0000-000000000006", "Employment Contract"),
    ("55555555-0000-0000-0000-000000000006", "Passport"),
    ("55555555-0000-0000-0000-000000000007", "Offer Letter"),
    ("55555555-0000-0000-0000-000000000008", "Background Verification"),
    ("55555555-0000-0000-0000-000000000009", "Work Visa"),
    ("55555555-0000-0000-0000-000000000014", "Work Permit"),
    ("55555555-0000-0000-0000-000000000010", "Policy Acknowledgement"),
    ("55555555-0000-0000-0000-000000000013", "Education Certificate"),
]

# (job requisition pk, candidate email) -- the get_or_create lookup key in 0002.
SEED_CANDIDATES = [
    ("77777777-0000-0000-0000-000000000001", "rohit.verma@example.com"),
    ("77777777-0000-0000-0000-000000000001", "emily.chen@example.com"),
    ("77777777-0000-0000-0000-000000000001", "sanjay.rao@example.com"),
    ("77777777-0000-0000-0000-000000000002", "laura.mendes@example.com"),
    ("77777777-0000-0000-0000-000000000002", "tanvi.shah@example.com"),
    ("77777777-0000-0000-0000-000000000003", "marcus.hall@example.com"),
    ("77777777-0000-0000-0000-000000000003", "aisha.bello@example.com"),
    ("77777777-0000-0000-0000-000000000004", "pooja.n@example.com"),
]


def mark_fixtures(apps, schema_editor):
    """Set is_fixture=True on exactly the seed-proven rows."""
    Employee = apps.get_model("hr", "Employee")
    EmployeeDocument = apps.get_model("hr", "EmployeeDocument")
    Candidate = apps.get_model("hr", "Candidate")

    Employee.objects.filter(pk__in=SEED_EMPLOYEE_PKS).update(is_fixture=True)

    for employee_pk, name in SEED_DOCUMENTS:
        EmployeeDocument.objects.filter(
            employee_id=employee_pk, name=name
        ).update(is_fixture=True)

    for job_pk, email in SEED_CANDIDATES:
        Candidate.objects.filter(job_id=job_pk, email=email).update(is_fixture=True)


def clear_fixtures(apps, schema_editor):
    """Reverse: clear the flag only. No business record or file is deleted."""
    for model_name in ("Employee", "EmployeeDocument", "Candidate"):
        apps.get_model("hr", model_name).all().update(is_fixture=False)


class Migration(migrations.Migration):

    dependencies = [("hr", "0008_shift_days_of_week_canonical")]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="is_fixture",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="employeedocument",
            name="is_fixture",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="candidate",
            name="is_fixture",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(mark_fixtures, clear_fixtures),
    ]