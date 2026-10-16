"""Populate AttendanceRecord.work_minutes from stored timestamps and shift break.

Idempotent: only touches completed rows whose work_minutes is still NULL, so it
can be re-run safely and will never overwrite a freshly computed value.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from hr.models import AttendanceRecord, EmployeeShiftAssignment, Shift


class Command(BaseCommand):
    help = "Backfill attendance_records.work_minutes from check_in/check_out and the shift break."

    @transaction.atomic
    def handle(self, *args, **options):
        rows = list(
            AttendanceRecord.objects.filter(
                check_in__isnull=False, check_out__isnull=False, work_minutes__isnull=True
            ).select_related("employee")
        )
        self.stdout.write(f"completed rows needing work_minutes: {len(rows)}")
        if not rows:
            self.stdout.write("nothing to backfill")
            return

        # Cache the effective shift per employee, mirroring the application
        # logic in `loadShift`: active assignments, most recently effective wins.
        shift_cache: dict[str, Shift] = {}
        assignments = (
            EmployeeShiftAssignment.objects.filter(is_active=True)
            .select_related("shift")
            .order_by("effective_from", "created_at")
        )
        for a in assignments:
            shift_cache[str(a.employee_id)] = a.shift

        updated = 0
        for r in rows:
            elapsed = int(
                (r.check_out - r.check_in).total_seconds() // 60
            )
            shift = shift_cache.get(str(r.employee_id))
            # A missing shift means there is no configured unpaid break to deduct.
            break_minutes = int(shift.break_minutes or 0) if shift else 0
            work_minutes = max(0, elapsed - break_minutes)
            r.work_minutes = work_minutes
            # Keep the legacy decimal column consistent with the new authority.
            r.work_hours = round(work_minutes / 60, 2)
            r.save(update_fields=["work_minutes", "work_hours"])
            updated += 1
            self.stdout.write(
                f"  {r.work_date} {r.employee_id} elapsed={elapsed}m break={break_minutes}m "
                f"-> work_minutes={work_minutes}m ({r.work_hours}h)"
            )

        self.stdout.write(self.style.SUCCESS(f"backfilled {updated} rows"))
