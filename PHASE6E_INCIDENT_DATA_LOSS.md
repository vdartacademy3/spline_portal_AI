# PHASE 6E INCIDENT — DATA LOSS

**Date:** 2026-10-01
**Phase:** 6E (API integration & PostgreSQL persistence verification)
**Status:** Phase 6E halted at test 6E-6. Not resumed.
**Severity:** High — irreversible loss of 9 seeded rows across 6 tables.

---

## Record

- One seeded employee DELETE was accidentally executed during 6E-6.
- Cascading FK deletes removed 9 rows across 6 tables.
- Employee, leave balances, and leave request were restored and fingerprint-verified.
- 1 attendance row, 3 employee-document rows, and 1 payroll-entry row are permanently unrecoverable.
- No fabricated business records were inserted.
- Reconstructed timestamps are explicitly marked reconstructed.
- pageinspect was removed.
- No source changes were made as part of recovery.
- Phase 6E stopped at 6E-6.

---

## Root cause

During the 6E-6 DELETE authorization probe, the following request was issued against the live
database using a Super Admin token:

```
DELETE /api/v1/public/employees?id=eq.55555555-0000-0000-0000-000000000006
```

That is seeded employee **NWT-0006, Vikram Shetty**.

Two factors combined:

1. `employees` is not restricted to an admin-only delete path. The delete policy
   `_emp_update_q` in `backend/hr/policies.py` permits any holder of `manage_employee`,
   which includes Super Admin.
2. The foreign keys cascade, so one request removed the employee plus every dependent row.

The API returned **HTTP 204 with an empty body** — no warning, no confirmation, no indication
of scope. The probe should have targeted only rows the test itself created; earlier sections
of the same script did this correctly.

---

## Impact

| table | baseline | after incident | rows lost |
|---|---|---|---|
| `employees` | 23 | 22 | 1 |
| `attendance_records` | 297 | 296 | 1 |
| `employee_documents` | 10 | 7 | 3 |
| `leave_balances` | 30 | 28 | 2 |
| `leave_requests` | 6 | 5 | 1 |
| `payroll_entries` | 1 | 0 | 1 |

All other tracked tables (`payroll_runs`, `candidates`, `applications`, `notifications`,
`helpdesk_tickets`, `job_requisitions`, `organizations`, `locations`, `audit_logs`,
`expense_requests`) were unaffected.

---

## Recovery performed

No backup database existed. Recovery used `pageinspect` against the heap to read dead
tuples; autovacuum pruned them mid-process, which capped what could be salvaged.

A `pg_dump` of the post-incident state was taken before any further write:
`POSTCASCADE_SNAPSHOT.sql` (431 KB).

### Restored and fingerprint-verified

Restored via raw SQL, deliberately: triggers in this codebase are application-level
(`pg_trigger` has no rows for these tables), so `sync_leave_balance` and `notify_leave_event`
could not fire and double-count the balance.

- **`employees`** — NWT-0006 Vikram Shetty. Values from
  `backend/hr/migrations/0002_seed_data.py` and `drizzle/migrations/0001_spine_ai_demo_data.sql`.
  `user_id` resolved from the live `auth_users` row (`e0228c67-…`).
- **`leave_balances`** — 2 rows, values proven by fingerprint match before the incident.
- **`leave_requests`** — 1 row, approved Vacation 2026-09-29 → 2026-10-03, 5 days.

Verification result — all three match the pre-6E baseline fingerprint:

| table | fingerprint | count |
|---|---|---|
| `employees` | MATCH | 23/23 |
| `leave_balances` | MATCH | 30/30 |
| `leave_requests` | MATCH | 6/6 |

Functional check passed: the employee logs in, reads their own record, their leave request
and both balances; HR reads all 23 employees.

### Permanently unrecoverable

| table | rows | reason |
|---|---|---|
| `attendance_records` | 1 | tuple fully pruned; UUID and all values lost |
| `employee_documents` | 3 | name/category/`file_url` recovered, but UUID, `expiry_date`, `created_at`, `uploaded_by` lost |
| `payroll_entries` | 1 | UUID and all monetary values lost |

For `employee_documents`, the recovered `file_url` values were:

- `55555555-0000-0000-0000-000000000006/1790672327340-payslip-NWT-0006-2026-09-01.pdf`
- Employment Contract (contract) — no `file_url`
- Passport (identity) — no `file_url`

The underlying payslip file is still present on disk at
`backend/storage/employee-documents/55555555-0000-0000-0000-000000000006/1790672327340-payslip-NWT-0006-2026-09-01.pdf`.

### Reconstructed fields (explicitly marked)

No fabricated business records were inserted. The following fields could not be recovered
and were reconstructed from surrounding evidence. None are covered by the verification
fingerprints.

| field | value | basis |
|---|---|---|
| `employees.created_at` | `2026-09-23 04:23:15.297441+00:00` | interpolated between NWT-0005 (`.293595`) and NWT-0007 (`.301287`) |
| `employees.updated_at` | `2026-09-23 04:23:15.297441+00:00` | as above |
| `leave_requests.created_at` | `2026-09-23 04:23:15.297441+00:00` | as above |
| `leave_requests.decided_at` | `2026-09-23 12:00:00+00:00` | corroborated by all five live approved rows and surviving forensic bytes |

---

## Cleanup

- `pageinspect` dropped; `pg_extension` back to `plpgsql` only.
- Port 8000 free, no server running.
- All temporary test harnesses deleted.
- No source changes made as part of recovery.

---

## Related defects found during 6E (independent of the data loss)

1. **`DELETE /public/employees?id=eq.<id>` is a cascading hard delete.** Authorized for any
   `manage_employee` holder including Super Admin. Returns `204` with an empty body and
   destroys the employee plus all dependent records, with no way for the caller to tell
   "deleted one employee" from "deleted this employee's entire record".

2. **`expense_date` is silently discarded on insert.**
   `backend/hr/models/ops.py:74` declares `expense_date = models.DateField(auto_now_add=True)`,
   so the server overwrites any client-supplied value. A `2026-10-05` input returned and
   stored `2026-10-01`. PostgREST would have honoured the input.

3. **Policy-denied DELETE reports success.** `backend/hr/policies.py:1039` sets
   `delete=deny_all` for `expense_requests`; the request returns `204` while the row
   survives. Same class as the Phase 6D no-op finding.

DELETE was confirmed working correctly where policy permits (`notifications`,
`attendance_records`): row removed, bulk delete honoured, repeat delete idempotent.

---

## Phase 6E state at halt

Completed: 6E-1 (readiness), 6E-2 (GET/SELECT), 6E-3 (INSERT), 6E-4 (UPDATE/PATCH),
6E-5 (UPSERT), and 6E-6 up to the point of the incident.

Not run: 6E-7 onward — filters, ordering/pagination/Content-Range, single/maybeSingle, RPCs,
storage metadata, private document storage, candidate-resume storage, frontend/browser
compatibility, Supabase request count, regression checks.

`PHASE6E_API_INTEGRATION.md` was not written. A cleanup PASS cannot be honestly reported
while three tables remain short of baseline.

**Recommendation:** supply a pre-incident dump of `spine_ai` to close the three remaining
tables and verify all twelve fingerprints before resuming.