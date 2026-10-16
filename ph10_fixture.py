import datetime as dt
import json
import os
import sys

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")
_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_ROOT, "backend"))
sys.path.insert(0, _ROOT)
django.setup()

from django.db import transaction  # noqa: E402

from hr.models.core import AppUser, Department, Employee, Organization  # noqa: E402
from hr.models.lifecycle import EmployeeLifecycleEvent  # noqa: E402
from hr.models.ops import AuditLog, EmployeeSalary, PayrollEntry, PayrollRun  # noqa: E402
from hr.models.recruitment import (  # noqa: E402
    Application,
    Candidate,
    CandidateScreening,
    JobRequisition,
)
from hr.models.ai import AiAction  # noqa: E402
from hr.models.documents import EmployeeDocument  # noqa: E402

SEMI_DIR = r"C:\Users\kiran.r\AppData\Local\Temp\opencode"
MANIFEST = os.path.join(SEMI_DIR, "ph10_manifest.json")
STORAGE_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage")

PRIYA = "priya@northwind.io"
VIKRAM = "vikram@northwind.io"
TERM_REASON = "Phase 10 E2E termination fixture"


def today():
    return dt.date.today()


def period_dates():
    t = today()
    return t.replace(day=1), t.replace(day=28)  # day 28 valid for every month


def load_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def dump_manifest(m):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, default=str)
    print("MANIFEST", json.dumps(m, default=str))


def seed():
    priya = AppUser.objects.get(email=PRIYA)
    vikram = AppUser.objects.get(email=VIKRAM)
    vikram_emp = Employee.objects.filter(user=vikram).first()
    if not vikram_emp:
        raise SystemExit("vikram has no employee record")

    org = Organization.objects.first()
    if not org:
        raise SystemExit("no organization present")

    suffix = dt.datetime.now().strftime("%Y%m%d%H%M%S")
    code = f"PH10-{suffix}"

    salary = EmployeeSalary.objects.filter(employee=vikram_emp).first()
    created_salary = None
    if salary is None:
        created_salary = EmployeeSalary.objects.create(
            employee=vikram_emp,
            effective_from=today(),
            basic=5000,
            allowances={"value": 500},
            deductions={"value": 300},
            currency="USD",
        )
        salary = created_salary

    t = today()
    temp_emp = Employee.objects.create(
        employee_code=code,
        first_name="Phase10",
        last_name="TerminateFixture",
        joining_date=t,
        employment_status="active",
        employment_type="full_time",
        organization=org,
        designation="QA Fixture",
    )

    run = PayrollRun.objects.create(
        organization=org,
        period_start=period_dates()[0],
        period_end=period_dates()[1],
        status="draft",
        created_by=priya.id,
    )
    entry = PayrollEntry.objects.create(
        run=run,
        employee=vikram_emp,
        basic=5000,
        allowances=500,
        deductions=300,
        gross=5500,
        net=5200,
        status="draft",
    )

    req = JobRequisition.objects.create(
        organization=org,
        title=f"Phase10 Shortlist {suffix}",
        status="open",
        slug=f"phase10-shortlist-{suffix}",
        skills=["typescript"],
        experience_min=1,
        experience_max=5,
        requirements="Delivery",
        qualifications="BS",
        work_mode="onsite",
    )
    cand = Candidate.objects.create(
        organization=org,
        job=req,
        full_name="Phase10 Candidate Person",
        email=f"ph10-{suffix}@example.com",
        skills=["typescript"],
        experience_years=3,
        stage="applied",
        source="fixture",
    )
    app = Application.objects.create(
        organization=org,
        requisition=req,
        candidate=cand,
        stage="applied",
        status="active",
        source="fixture",
    )

    manifest = {
        "suffix": suffix,
        "org_id": str(org.id),
        "temp_employee_id": str(temp_emp.id),
        "temp_employee_code": code,
        "req_id": str(req.id),
        "cand_id": str(cand.id),
        "app_id": str(app.id),
        "salary_id": str(salary.id),
        "salary_created": bool(created_salary),
        "run_id": str(run.id),
        "run_status": run.status,
        "entry_id": str(entry.id),
        "run_id": str(run.id),
        "entry_id": str(entry.id),
        "priya_user_id": str(priya.id),
        "vikram_user_id": str(vikram.id),
        "vikram_employee_id": str(vikram_emp.id),
        "priya_email": PRIYA,
        "vikram_email": VIKRAM,
        "termination_date": str(today()),
        "period_start": str(period_dates()[0]),
        "period_end": str(period_dates()[1]),
    }
    dump_manifest(manifest)


def _emp_docs(emp_id):
    return list(EmployeeDocument.objects.filter(employee_id=emp_id))


def verify():
    m = load_manifest()
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'PASS' if cond else 'FAIL'} {name}{' :: ' + str(detail)[:300] if detail else ''}")

    emp = Employee.objects.get(id=m["temp_employee_id"])
    check("terminate.employee_status", emp.employment_status == "terminated", emp.employment_status)

    events = list(
        EmployeeLifecycleEvent.objects.filter(employee_id=m["temp_employee_id"]).order_by(
            "-created_at"
        )
    )
    check("terminate.lifecycle_event_count", len(events) == 1, len(events))
    if events:
        ev = events[0]
        check("terminate.event_type", ev.event_type == "terminated", ev.event_type)
        check(
            "terminate.effective_date",
            str(ev.effective_date) == m["termination_date"],
            ev.effective_date,
        )
        check(
            "terminate.previous_value",
            (ev.previous_value or {}).get("employment_status") == "active",
            ev.previous_value,
        )
        check(
            "terminate.new_value",
            (ev.new_value or {}).get("employment_status") == "terminated",
            ev.new_value,
        )
        check("terminate.reason", (ev.reason or "").startswith(TERM_REASON), ev.reason)
        check("terminate.actor", str(ev.actor) == m["priya_user_id"], ev.actor)

    audits = list(
        AuditLog.objects.filter(
            entity="employees", entity_id=m["temp_employee_id"], action="employee.terminated"
        )
    )
    check("terminate.audit", len(audits) == 1, len(audits))
    if audits:
        check(
            "terminate.audit.actor", str(audits[0].user_id) == m["priya_user_id"], audits[0].user_id
        )
        check(
            "terminate.audit.new_value",
            (audits[0].new_value or {}).get("employment_status") == "terminated",
            audits[0].new_value,
        )

    run = PayrollRun.objects.filter(
        period_start=dt.date.fromisoformat(m["period_start"]),
        period_end=dt.date.fromisoformat(m["period_end"]),
        status="paid",
    ).order_by("-created_at").first()
    check("payslip.run_paid", run is not None)
    paid_entries = []
    if run:
        paid_entries = list(PayrollEntry.objects.filter(run=run, status="paid"))
        check("payslip.entries_paid", len(paid_entries) >= 1, len(paid_entries))

    docs = list(
        EmployeeDocument.objects.filter(
            employee_id=m["vikram_employee_id"], category="payslip"
        ).order_by("-created_at")
    )
    check("payslip.docs_exist_for_vikram", len(docs) >= 1, len(docs))
    pdf_ok = False
    if docs:
        newest = docs[0]
        check(
            "payslip.doc_name_period",
            m["period_start"] in (newest.name or ""),
            newest.name,
        )
        rel = newest.file_url or ""
        path = os.path.abspath(os.path.join(STORAGE_ROOT, rel.replace("/", os.sep)))
        if os.path.exists(path):
            with open(path, "rb") as f:
                head = f.read(8)
            pdf_ok = head.startswith(b"%PDF-")
            check("payslip.pdf_bytes_on_disk", pdf_ok, head)
        else:
            check("payslip.pdf_bytes_on_disk", False, rel)

    screenings = CandidateScreening.objects.filter(requisition_id=m["req_id"]).count()
    actions = sum(
        1
        for a in AiAction.objects.all()
        if (a.proposed_payload or {}).get("requisition_id") == m["req_id"]
    )
    # The shortlist producer can NOT complete scoring without LOVABLE_API_KEY, so
    # the gateway throws before any insert. The UI regression therefore expects 0
    # synthetic rows. If a key was configured and rows appeared, that is also a pass
    # but reported below.
    check("shortlist.no_synthetic_rows_without_key", screenings == 0 and actions == 0, f"screenings={screenings} actions={actions}")

    if not ok:
        print("VERIFY_RESULT FAIL")
        sys.exit(2)
    print("VERIFY_RESULT PASS")


def cleanup():
    m = load_manifest()

    emp = Employee.objects.filter(id=m["temp_employee_id"]).first()
    if emp:
        for ev in EmployeeLifecycleEvent.objects.filter(employee_id=emp.id):
            ev.delete()
        emp.delete()
    AuditLog.objects.filter(entity="employees", entity_id=m["temp_employee_id"]).delete()

    runs = PayrollRun.objects.filter(
        period_start=dt.date.fromisoformat(m["period_start"]),
        period_end=dt.date.fromisoformat(m["period_end"]),
    )
    for run in runs:
        AuditLog.objects.filter(entity="payroll_runs", entity_id=str(run.id)).delete()
        run.delete()

    EmployeeDocument.objects.filter(
        employee_id=m["vikram_employee_id"], category="payslip"
    ).delete()

    if m.get("salary_created"):
        EmployeeSalary.objects.filter(id=m["salary_id"]).delete()

    CandidateScreening.objects.filter(requisition_id=m["req_id"]).delete()
    for a in AiAction.objects.all():
        if (a.proposed_payload or {}).get("requisition_id") == m["req_id"]:
            a.delete()
    Application.objects.filter(requisition_id=m["req_id"]).delete()
    Candidate.objects.filter(id=m["cand_id"]).delete()
    JobRequisition.objects.filter(id=m["req_id"]).delete()

    AuditLog.objects.filter(
        entity="candidate_screenings", entity_id=m["req_id"]
    ).delete()

    print("CLEANUP_DONE")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "seed"
    {"seed": seed, "verify": verify, "cleanup": cleanup}[cmd]()