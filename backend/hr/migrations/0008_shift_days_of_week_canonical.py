from django.db import migrations

"""Canonicalize Shift.days_of_week to 1-based, Monday-first (1=Mon .. 7=Sun).

The canonical convention is:
    1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday,
    5 = Friday, 6 = Saturday, 7 = Sunday

Legacy seed rows stored a 0-based, Monday-first variant (0=Mon .. 6=Sun). Those
are converted to the exact same real-world scheduled days, never via a blanket
arithmetic shift (a naive +1 on the 7-entry Night Shift array would incorrectly
turn Mon-Sat into Mon-Sun and add a Sunday). The two legacy shapes present in
the data are mapped explicitly; any other 0-based array falls back to a
documented Monday-first translation.

Reversibility note: on rollback, a canonical Mon-Fri `[1,2,3,4,5]` or Mon-Sat
`[1,2,3,4,5,6]` row is written back to the legacy 0-based form. A row that was
always canonical and happens to hold the same day-set (e.g. Genral, also
Mon-Fri) is therefore written in its legacy form too, which is purely
representational: `normalizeScheduledDays` parses both conventions to the same
weekday set, so overtime behaviour is unchanged. Re-applying this migration
restores every such row to canonical 1-based.
"""

# Legacy 0-based Monday-first -> canonical 1-based Monday-first.
LEGACY_TO_CANONICAL = {
    # General:      Mon-Fri  [0,1,2,3,4]   -> [1,2,3,4,5]
    (0, 1, 2, 3, 4): [1, 2, 3, 4, 5],
    # Night Shift:  Mon-Sat  [0,1,2,3,4,5,6] -> [1,2,3,4,5,6].
    # The legacy 7-entry array carried an extraneous Sunday (6, 0-based); the
    # shift was scheduled Mon-Sat, so the trailing Sunday is dropped here.
    (0, 1, 2, 3, 4, 5, 6): [1, 2, 3, 4, 5, 6],
}
CANONICAL_TO_LEGACY = {tuple(v): list(k) for k, v in LEGACY_TO_CANONICAL.items()}


def is_legacy_zero_based(days):
    return isinstance(days, list) and 0 in days


def forward(apps, schema_editor):
    Shift = apps.get_model("hr", "Shift")
    for shift in Shift.objects.all().iterator():
        days = shift.days_of_week
        if not is_legacy_zero_based(days):
            continue
        key = tuple(sorted(days))
        if key in LEGACY_TO_CANONICAL:
            shift.days_of_week = LEGACY_TO_CANONICAL[key]
        else:
            # No other legacy shape exists in the data. Fall back to a documented
            # Monday-first translation (0=Mon..6=Sun -> 1=Mon..7=Sun) rather than
            # corrupt an unforeseen row.
            shift.days_of_week = sorted({d + 1 for d in days if 0 <= d <= 6})
        shift.save(update_fields=["days_of_week", "updated_at"])


def backward(apps, schema_editor):
    Shift = apps.get_model("hr", "Shift")
    for shift in Shift.objects.all().iterator():
        days = shift.days_of_week
        if not isinstance(days, list):
            continue
        key = tuple(sorted(days))
        if key in CANONICAL_TO_LEGACY:
            shift.days_of_week = CANONICAL_TO_LEGACY[key]
            shift.save(update_fields=["days_of_week", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("hr", "0007_shift_weekly_overtime"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]