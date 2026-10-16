"""Seed data migration — mirrors drizzle migrations 0001 + RBAC seed inserts.

Creates the default organization, demo employees, leave/performance/recruitment/
helpdesk/knowledge demo rows, the permission catalogue and default
role_permissions exactly as the Supabase migrations did.

Idempotent: safe to run once on a fresh DB.
"""

from datetime import date, datetime, timedelta, timezone

from django.contrib.auth.hashers import make_password
from django.db import migrations


def _dt(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def seed(apps, schema_editor):  # noqa: ANN001
    Organization = apps.get_model("hr", "Organization")
    LegalEntity = apps.get_model("hr", "LegalEntity")
    Location = apps.get_model("hr", "Location")
    Department = apps.get_model("hr", "Department")
    Employee = apps.get_model("hr", "Employee")
    LeaveType = apps.get_model("hr", "LeaveType")
    LeaveBalance = apps.get_model("hr", "LeaveBalance")
    LeaveRequest = apps.get_model("hr", "LeaveRequest")
    Goal = apps.get_model("hr", "Goal")
    PerformanceReview = apps.get_model("hr", "PerformanceReview")
    EmployeeDocument = apps.get_model("hr", "EmployeeDocument")
    JobRequisition = apps.get_model("hr", "JobRequisition")
    Candidate = apps.get_model("hr", "Candidate")
    OnboardingTask = apps.get_model("hr", "OnboardingTask")
    HelpdeskTicket = apps.get_model("hr", "HelpdeskTicket")
    KbDocument = apps.get_model("hr", "KbDocument")
    KbChunk = apps.get_model("hr", "KbChunk")
    AiInsight = apps.get_model("hr", "AiInsight")
    Permission = apps.get_model("hr", "Permission")
    RolePermission = apps.get_model("hr", "RolePermission")
    AppUser = apps.get_model("hr", "AppUser")
    UserRole = apps.get_model("hr", "UserRole")
    Profile = apps.get_model("hr", "Profile")

    # --------------------------------------------------------------- org/location
    org, _ = Organization.objects.get_or_create(
        pk="11111111-1111-1111-1111-111111111111",
        defaults={
            "name": "Northwind Technologies",
            "code": "NWT",
            "industry": "Technology",
            "timezone": "Asia/Kolkata",
            "currency": "USD",
        },
    )

    les = {}
    for pk, name, code, reg in [
        ("22222222-2222-2222-2222-222222222201", "Northwind Technologies Pvt Ltd", "NWT-IN",
         "U72900KA2015PTC080123"),
        ("22222222-2222-2222-2222-222222222202", "Northwind Technologies Inc", "NWT-US",
         "DE-7781204"),
    ]:
        les[pk], _ = LegalEntity.objects.get_or_create(
            pk=pk, defaults={"organization": org, "name": name, "code": code,
                             "registration_number": reg}
        )

    locs = {}
    for pk, le, name, city, country, tz in [
        ("33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "Bengaluru HQ", "Bengaluru", "India", "Asia/Kolkata"),
        ("33333333-3333-3333-3333-333333333302", "22222222-2222-2222-2222-222222222201",
         "Chennai Office", "Chennai", "India", "Asia/Kolkata"),
        ("33333333-3333-3333-3333-333333333303", "22222222-2222-2222-2222-222222222202",
         "Austin Office", "Austin", "United States", "America/Chicago"),
    ]:
        locs[pk], _ = Location.objects.get_or_create(
            pk=pk,
            defaults={
                "organization": org,
                "legal_entity": les[le],
                "name": name,
                "city": city,
                "country": country,
                "timezone": tz,
            },
        )

    depts = {}
    for pk, name, code in [
        ("44444444-4444-4444-4444-444444444401", "Engineering", "ENG"),
        ("44444444-4444-4444-4444-444444444402", "Human Resources", "HR"),
        ("44444444-4444-4444-4444-444444444403", "Sales", "SLS"),
        ("44444444-4444-4444-4444-444444444404", "Finance", "FIN"),
        ("44444444-4444-4444-4444-444444444405", "Customer Success", "CS"),
    ]:
        depts[pk], _ = Department.objects.get_or_create(
            pk=pk, defaults={"organization": org, "name": name, "code": code}
        )

    employees = {}
    emp_rows = [
        ("55555555-0000-0000-0000-000000000001", "NWT-0001", "Meera", "Raghavan",
         "meera.raghavan@northwind.io", "+91 98450 11001", "female", "2016-04-11",
         "Chief People Officer", "44444444-4444-4444-4444-444444444402",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         None),
        ("55555555-0000-0000-0000-000000000002", "NWT-0002", "Arjun", "Nair",
         "arjun.nair@northwind.io", "+91 98450 11002", "male", "2017-01-09",
         "VP Engineering", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         None),
        ("55555555-0000-0000-0000-000000000003", "NWT-0003", "Priya", "Deshpande",
         "priya.deshpande@northwind.io", "+91 98450 11003", "female", "2018-06-18",
         "HR Manager", "44444444-4444-4444-4444-444444444402",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000001"),
        ("55555555-0000-0000-0000-000000000004", "NWT-0004", "Daniel", "Okafor",
         "daniel.okafor@northwind.io", "+1 512 555 0104", "male", "2019-02-25",
         "Engineering Manager", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333303", "22222222-2222-2222-2222-222222222202",
         "55555555-0000-0000-0000-000000000002"),
        ("55555555-0000-0000-0000-000000000005", "NWT-0005", "Sneha", "Kulkarni",
         "sneha.kulkarni@northwind.io", "+91 98450 11005", "female", "2020-08-03",
         "Sales Director", "44444444-4444-4444-4444-444444444403",
         "33333333-3333-3333-3333-333333333302", "22222222-2222-2222-2222-222222222201",
         None),
        ("55555555-0000-0000-0000-000000000006", "NWT-0006", "Vikram", "Shetty",
         "vikram.shetty@northwind.io", "+91 98450 11006", "male", "2021-03-15",
         "Senior Software Engineer", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000004"),
        ("55555555-0000-0000-0000-000000000007", "NWT-0007", "Ananya", "Iyer",
         "ananya.iyer@northwind.io", "+91 98450 11007", "female", "2022-07-04",
         "Software Engineer", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000004"),
        ("55555555-0000-0000-0000-000000000008", "NWT-0008", "Rahul", "Menon",
         "rahul.menon@northwind.io", "+91 98450 11008", "male", "2026-07-20",
         "Software Engineer", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333302", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000004"),
        ("55555555-0000-0000-0000-000000000009", "NWT-0009", "Grace", "Lin",
         "grace.lin@northwind.io", "+1 512 555 0109", "female", "2023-09-11",
         "QA Engineer", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333303", "22222222-2222-2222-2222-222222222202",
         "55555555-0000-0000-0000-000000000004"),
        ("55555555-0000-0000-0000-000000000010", "NWT-0010", "Karthik", "Subramanian",
         "karthik.s@northwind.io", "+91 98450 11010", "male", "2024-01-08",
         "Account Executive", "44444444-4444-4444-4444-444444444403",
         "33333333-3333-3333-3333-333333333302", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000005"),
        ("55555555-0000-0000-0000-000000000011", "NWT-0011", "Fatima", "Sheikh",
         "fatima.sheikh@northwind.io", "+91 98450 11011", "female", "2024-05-02",
         "Customer Success Manager", "44444444-4444-4444-4444-444444444405",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000001"),
        ("55555555-0000-0000-0000-000000000012", "NWT-0012", "Joseph", "Mathew",
         "joseph.mathew@northwind.io", "+91 98450 11012", "male", "2022-11-14",
         "Financial Analyst", "44444444-4444-4444-4444-444444444404",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000001"),
        ("55555555-0000-0000-0000-000000000013", "NWT-0013", "Neha", "Gupta",
         "neha.gupta@northwind.io", "+91 98450 11013", "female", "2026-08-10",
         "HR Executive", "44444444-4444-4444-4444-444444444402",
         "33333333-3333-3333-3333-333333333301", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000003"),
        ("55555555-0000-0000-0000-000000000014", "NWT-0014", "Miguel", "Santos",
         "miguel.santos@northwind.io", "+1 512 555 0114", "male", "2025-02-17",
         "DevOps Engineer", "44444444-4444-4444-4444-444444444401",
         "33333333-3333-3333-3333-333333333303", "22222222-2222-2222-2222-222222222202",
         "55555555-0000-0000-0000-000000000004"),
        ("55555555-0000-0000-0000-000000000015", "NWT-0015", "Divya", "Pillai",
         "divya.pillai@northwind.io", "+91 98450 11015", "female", "2025-06-23",
         "Support Specialist", "44444444-4444-4444-4444-444444444405",
         "33333333-3333-3333-3333-333333333302", "22222222-2222-2222-2222-222222222201",
         "55555555-0000-0000-0000-000000000011"),
    ]
    for pk, code, fn, ln, email, phone, gender, joined, desig, dept, loc, le, mgr in emp_rows:
        status = "probation" if code in ("NWT-0008", "NWT-0013") else "active"
        Employee.objects.get_or_create(
            pk=pk,
            defaults={
                "employee_code": code,
                "first_name": fn,
                "last_name": ln,
                "work_email": email,
                "phone": phone,
                "gender": gender,
                "joining_date": date.fromisoformat(joined),
                "designation": desig,
                "employment_type": "full_time",
                "employment_status": status,
                "organization": org,
                "legal_entity": les[le],
                "location": locs[loc],
                "department": depts[dept],
                "manager": employees.get(mgr),
                "probation_end_date": (
                    date.fromisoformat(joined) + timedelta(days=92)
                )
                if status == "probation"
                else None,
            },
        )
        employees[pk] = Employee.objects.get(pk=pk)

    heads = {
        "44444444-4444-4444-4444-444444444401": "55555555-0000-0000-0000-000000000002",
        "44444444-4444-4444-4444-444444444402": "55555555-0000-0000-0000-000000000001",
        "44444444-4444-4444-4444-444444444403": "55555555-0000-0000-0000-000000000005",
        "44444444-4444-4444-4444-444444444404": "55555555-0000-0000-0000-000000000012",
        "44444444-4444-4444-4444-444444444405": "55555555-0000-0000-0000-000000000011",
    }
    for dept_pk, emp_pk in heads.items():
        Department.objects.filter(pk=dept_pk).update(department_head=employees[emp_pk])

    today = date.today()

    # --------------------------------------------------------------- leave
    leave_types = {}
    for pk, name, code, quota, paid in [
        ("66666666-0000-0000-0000-000000000001", "Annual Leave", "AL", 24, True),
        ("66666666-0000-0000-0000-000000000002", "Sick Leave", "SL", 12, True),
        ("66666666-0000-0000-0000-000000000003", "Maternity Leave", "ML", 182, True),
        ("66666666-0000-0000-0000-000000000004", "Unpaid Leave", "UL", 0, False),
    ]:
        leave_types[pk], _ = LeaveType.objects.get_or_create(
            pk=pk,
            defaults={
                "organization": org,
                "name": name,
                "code": code,
                "annual_quota": quota,
                "paid": paid,
            },
        )

    for idx, emp in enumerate(Employee.objects.all()):
        for idx2, lt_pk in enumerate(
            ("66666666-0000-0000-0000-000000000001", "66666666-0000-0000-0000-000000000002")
        ):
            lt = leave_types[lt_pk]
            used = (idx * 5 + idx2 * 3) % 9
            LeaveBalance.objects.get_or_create(
                employee=emp,
                leave_type=lt,
                year=today.year,
                defaults={"entitled": lt.annual_quota, "used": min(lt.annual_quota, used)},
            )

    approved_leaves = [
        ("55555555-0000-0000-0000-000000000007",
         "66666666-0000-0000-0000-000000000001", 0, 2, 3, "Family function",
         "approved", "55555555-0000-0000-0000-000000000004", "2026-09-15T10:00:00+00:00"),
        ("55555555-0000-0000-0000-000000000009",
         "66666666-0000-0000-0000-000000000002", 0, 0, 1, "Fever",
         "approved", "55555555-0000-0000-0000-000000000004", "2026-09-15T10:00:00+00:00"),
    ]
    pending_leaves = [
        ("55555555-0000-0000-0000-000000000006",
         "66666666-0000-0000-0000-000000000001", 6, 10, 5, "Vacation"),
        ("55555555-0000-0000-0000-000000000008",
         "66666666-0000-0000-0000-000000000002", 1, 1, 1, "Medical appointment"),
        ("55555555-0000-0000-0000-000000000010",
         "66666666-0000-0000-0000-000000000001", 12, 14, 3, "Personal"),
        ("55555555-0000-0000-0000-000000000014",
         "66666666-0000-0000-0000-000000000001", 3, 4, 2, "Travel"),
    ]
    for emp, lt, s, e, days, reason, status, approver, decided in approved_leaves:
        LeaveRequest.objects.get_or_create(
            employee=employees[emp],
            leave_type=leave_types[lt],
            reason=reason,
            defaults={
                "start_date": today + timedelta(days=s),
                "end_date": today + timedelta(days=e),
                "days": days,
                "status": status,
                "approver": employees[approver],
                "decided_at": _dt(decided),
            },
        )
    for emp, lt, s, e, days, reason in pending_leaves:
        LeaveRequest.objects.get_or_create(
            employee=employees[emp],
            leave_type=leave_types[lt],
            reason=reason,
            defaults={
                "start_date": today + timedelta(days=s),
                "end_date": today + timedelta(days=e),
                "days": days,
                "status": "pending",
            },
        )

    # --------------------------------------------------------------- performance
    goals = [
        ("55555555-0000-0000-0000-000000000006", "Ship billing service v2",
         "Deliver the new billing microservice to production", 20, 70, "in_progress"),
        ("55555555-0000-0000-0000-000000000006", "Mentor two juniors",
         "Structured mentoring plan for Q3", 40, 45, "in_progress"),
        ("55555555-0000-0000-0000-000000000007", "Reduce API latency 30%",
         "Optimise the reporting endpoints", 9, 60, "in_progress"),
        ("55555555-0000-0000-0000-000000000009", "Automate regression suite",
         "Cover critical flows with automation", 14, 85, "in_progress"),
        ("55555555-0000-0000-0000-000000000010", "Close $450K new ARR",
         "FY quota attainment", 60, 52, "in_progress"),
        ("55555555-0000-0000-0000-000000000015", "Cut first-response time",
         "Target under 2 hours", -3, 100, "completed"),
    ]
    for emp, title, desc, due, prog, status in goals:
        Goal.objects.get_or_create(
            employee=employees[emp],
            title=title,
            defaults={
                "description": desc,
                "due_date": today + timedelta(days=due),
                "progress": prog,
                "status": status,
            },
        )

    reviews = [
        ("55555555-0000-0000-0000-000000000006", "55555555-0000-0000-0000-000000000004",
         4.4, "Deep technical ownership, strong mentoring",
         "Delegation, written design docs",
         "Consistently high performer with growing leadership scope.", "published"),
        ("55555555-0000-0000-0000-000000000007", "55555555-0000-0000-0000-000000000004",
         3.9, "Fast learner, reliable delivery", "Estimation accuracy",
         "Solid contributor trending upward.", "published"),
        ("55555555-0000-0000-0000-000000000009", "55555555-0000-0000-0000-000000000004",
         4.1, "Quality mindset, thorough testing", "Cross-team communication",
         "Strong quality anchor for the platform team.", "published"),
        ("55555555-0000-0000-0000-000000000010", "55555555-0000-0000-0000-000000000005",
         3.4, "Pipeline generation", "Deal qualification, forecasting",
         "Meets expectations, needs forecast discipline.", "published"),
        ("55555555-0000-0000-0000-000000000015", "55555555-0000-0000-0000-000000000011",
         3.8, "Customer empathy", "Documentation of resolutions",
         "Dependable support specialist.", "draft"),
    ]
    for emp, rev, rating, strengths, impro, summary, status in reviews:
        PerformanceReview.objects.get_or_create(
            employee=employees[emp],
            period="H1 2026",
            defaults={
                "reviewer": employees[rev],
                "rating": rating,
                "strengths": strengths,
                "improvements": impro,
                "summary": summary,
                "status": status,
            },
        )

    # --------------------------------------------------------------- documents
    docs = [
        ("55555555-0000-0000-0000-000000000006", "Employment Contract", "contract", None,
         "verified"),
        ("55555555-0000-0000-0000-000000000006", "Passport", "identity", 25, "verified"),
        ("55555555-0000-0000-0000-000000000007", "Offer Letter", "offer_letter", None,
         "verified"),
        ("55555555-0000-0000-0000-000000000008", "Background Verification", "certificate", 12,
         "pending"),
        ("55555555-0000-0000-0000-000000000009", "Work Visa", "identity", 18, "verified"),
        ("55555555-0000-0000-0000-000000000014", "Work Permit", "identity", 55, "verified"),
        ("55555555-0000-0000-0000-000000000010", "Policy Acknowledgement", "policy", None,
         "pending"),
        ("55555555-0000-0000-0000-000000000013", "Education Certificate", "certificate", None,
         "pending"),
    ]
    for emp, name, cat, exp, vstatus in docs:
        EmployeeDocument.objects.get_or_create(
            employee=employees[emp],
            name=name,
            defaults={
                "category": cat,
                "expiry_date": today + timedelta(days=exp) if exp else None,
                "verification_status": vstatus,
            },
        )

    # --------------------------------------------------------------- recruitment
    jobs = {
        "77777777-0000-0000-0000-000000000001": dict(
            title="Senior Backend Engineer",
            department=depts["44444444-4444-4444-4444-444444444401"],
            location=locs["33333333-3333-3333-3333-333333333301"],
            employment_type="full_time",
            experience_min=5,
            experience_max=9,
            skills=["Go", "PostgreSQL", "Kubernetes", "AWS"],
            salary_min=45000,
            salary_max=70000,
            hiring_manager=employees["55555555-0000-0000-0000-000000000004"],
            openings=2,
            status="open",
            slug="senior-backend-engineer-777777",
        ),
        "77777777-0000-0000-0000-000000000002": dict(
            title="Product Designer",
            department=depts["44444444-4444-4444-4444-444444444401"],
            location=locs["33333333-3333-3333-3333-333333333302"],
            employment_type="full_time",
            experience_min=3,
            experience_max=6,
            skills=["Figma", "Design Systems", "User Research"],
            salary_min=30000,
            salary_max=45000,
            hiring_manager=employees["55555555-0000-0000-0000-000000000002"],
            openings=1,
            status="open",
            slug="product-designer-777777",
        ),
        "77777777-0000-0000-0000-000000000003": dict(
            title="Enterprise Account Executive",
            department=depts["44444444-4444-4444-4444-444444444403"],
            location=locs["33333333-3333-3333-3333-333333333303"],
            employment_type="full_time",
            experience_min=6,
            experience_max=12,
            skills=["SaaS", "Enterprise Sales", "Negotiation"],
            salary_min=60000,
            salary_max=95000,
            hiring_manager=employees["55555555-0000-0000-0000-000000000005"],
            openings=2,
            status="open",
            slug="enterprise-account-executive-777777",
        ),
        "77777777-0000-0000-0000-000000000004": dict(
            title="HR Operations Specialist",
            department=depts["44444444-4444-4444-4444-444444444402"],
            location=locs["33333333-3333-3333-3333-333333333301"],
            employment_type="full_time",
            experience_min=2,
            experience_max=5,
            skills=["HRIS", "Payroll", "Compliance"],
            salary_min=18000,
            salary_max=28000,
            hiring_manager=employees["55555555-0000-0000-0000-000000000003"],
            openings=1,
            status="on_hold",
            slug="hr-operations-specialist-777777",
        ),
    }
    for pk, fields in jobs.items():
        fields["organization"] = org
        JobRequisition.objects.get_or_create(pk=pk, defaults=fields)

    candidates = [
        ("77777777-0000-0000-0000-000000000001", "Rohit Verma", "rohit.verma@example.com",
         "+91 99000 20001", ["Go", "PostgreSQL", "Docker"], 7, "B.Tech Computer Science",
         "LinkedIn", "interview", 87),
        ("77777777-0000-0000-0000-000000000001", "Emily Chen", "emily.chen@example.com",
         "+1 415 555 2002", ["Go", "Kubernetes", "AWS", "Terraform"], 8,
         "MS Computer Science", "Referral", "evaluation", 92),
        ("77777777-0000-0000-0000-000000000001", "Sanjay Rao", "sanjay.rao@example.com",
         "+91 99000 20003", ["Java", "Spring", "MySQL"], 6, "B.E Information Science",
         "Job Board", "screening", 61),
        ("77777777-0000-0000-0000-000000000002", "Laura Mendes", "laura.mendes@example.com",
         "+351 910 200 004", ["Figma", "Design Systems"], 5, "BA Design", "Portfolio",
         "interview", 84),
        ("77777777-0000-0000-0000-000000000002", "Tanvi Shah", "tanvi.shah@example.com",
         "+91 99000 20005", ["Figma", "Prototyping"], 3, "B.Des", "LinkedIn", "applied", 72),
        ("77777777-0000-0000-0000-000000000003", "Marcus Hall", "marcus.hall@example.com",
         "+1 512 555 2006", ["SaaS", "Enterprise Sales"], 11, "MBA", "Referral", "offer", 89),
        ("77777777-0000-0000-0000-000000000003", "Aisha Bello", "aisha.bello@example.com",
         "+1 512 555 2007", ["SaaS", "Negotiation"], 7, "BSc Economics", "Job Board",
         "screening", 68),
        ("77777777-0000-0000-0000-000000000004", "Pooja Nambiar", "pooja.n@example.com",
         "+91 99000 20008", ["HRIS", "Payroll"], 4, "MBA HR", "LinkedIn", "applied", 75),
    ]
    for job_id, name, email, phone, skills, exp, edu, source, stage, score in candidates:
        Candidate.objects.get_or_create(
            job=JobRequisition.objects.get(pk=job_id),
            email=email,
            defaults={
                "organization": org,
                "full_name": name,
                "phone": phone,
                "skills": skills,
                "experience_years": exp,
                "education": edu,
                "source": source,
                "stage": stage,
                "match_score": score,
            },
        )

    # --------------------------------------------------------------- onboarding
    onboarding_tasks = [
        ("55555555-0000-0000-0000-000000000008", "Documents submitted", "HR", -20,
         "completed"),
        ("55555555-0000-0000-0000-000000000008", "Background verification", "HR", -5,
         "in_progress"),
        ("55555555-0000-0000-0000-000000000008", "IT account creation", "IT", -18,
         "completed"),
        ("55555555-0000-0000-0000-000000000008", "Laptop allocation", "IT", -18,
         "completed"),
        ("55555555-0000-0000-0000-000000000008", "Policy acknowledgement", "Employee", -2,
         "pending"),
        ("55555555-0000-0000-0000-000000000008", "Manager introduction", "Manager", -15,
         "completed"),
        ("55555555-0000-0000-0000-000000000008", "Probation setup", "HR", 4, "pending"),
        ("55555555-0000-0000-0000-000000000013", "Documents submitted", "HR", -10,
         "completed"),
        ("55555555-0000-0000-0000-000000000013", "Orientation", "HR", -8, "completed"),
        ("55555555-0000-0000-0000-000000000013", "Training plan", "Manager", -1,
         "in_progress"),
        ("55555555-0000-0000-0000-000000000013", "Policy acknowledgement", "Employee", 3,
         "pending"),
    ]
    for emp, title, owner, due, status in onboarding_tasks:
        OnboardingTask.objects.get_or_create(
            employee=employees[emp],
            title=title,
            defaults={"owner": owner, "due_date": today + timedelta(days=due), "status": status},
        )

    # --------------------------------------------------------------- helpdesk
    tickets = [
        ("55555555-0000-0000-0000-000000000007", "leave",
         "Leave balance looks incorrect",
         "My annual leave balance shows 3 days less than expected.", "medium",
         "in_progress", "55555555-0000-0000-0000-000000000003"),
        ("55555555-0000-0000-0000-000000000010", "payroll",
         "Reimbursement not credited",
         "Travel reimbursement from last month is still pending.", "high", "open",
         "55555555-0000-0000-0000-000000000003"),
        ("55555555-0000-0000-0000-000000000015", "policy",
         "Work from home policy clarification",
         "How many WFH days are allowed per month?", "low", "resolved",
         "55555555-0000-0000-0000-000000000013"),
        ("55555555-0000-0000-0000-000000000014", "it", "Need VPN access",
         "Requesting VPN access for the production network.", "medium",
         "waiting_employee", "55555555-0000-0000-0000-000000000013"),
        ("55555555-0000-0000-0000-000000000009", "benefits", "Insurance card missing",
         "I have not received my insurance card yet.", "medium", "open", None),
    ]
    for emp, cat, subj, desc, prio, status, assignee in tickets:
        HelpdeskTicket.objects.get_or_create(
            employee=employees[emp],
            subject=subj,
            defaults={
                "category": cat,
                "description": desc,
                "priority": prio,
                "status": status,
                "assigned_to": employees[assignee] if assignee else None,
                "created_by": None,
            },
        )

    # --------------------------------------------------------------- knowledge base
    kb_docs = {
        "88888888-0000-0000-0000-000000000001": (
            "Leave Policy",
            "policy",
            "Northwind employees receive 24 days of annual leave and 12 days of sick leave "
            "per calendar year. Annual leave must be requested at least 5 working days in "
            "advance and requires manager approval. Up to 6 unused annual leave days may be "
            "carried into the next year. Sick leave beyond 2 consecutive days requires a "
            "medical certificate. Maternity leave is 26 weeks of paid leave; paternity leave "
            "is 15 days.",
        ),
        "88888888-0000-0000-0000-000000000002": (
            "Attendance Policy",
            "policy",
            "Standard working hours are 09:00 to 18:00 local time with a one hour break. "
            "Arrival after 09:30 is recorded as late. Three or more late arrivals in a "
            "calendar month trigger an HR follow-up conversation. Overtime beyond 60 minutes "
            "must be approved by the reporting manager. Unreported absence for three "
            "consecutive days is treated as absconding.",
        ),
        "88888888-0000-0000-0000-000000000003": (
            "Employee Handbook",
            "handbook",
            "The handbook covers our values, working model, hybrid work expectations of "
            "three office days per week, expense guidelines, travel booking, internal "
            "mobility, referral bonuses, and the grievance redressal process. Employees may "
            "raise concerns anonymously through the HR helpdesk.",
        ),
        "88888888-0000-0000-0000-000000000004": (
            "Code of Conduct",
            "policy",
            "All employees must act with integrity, protect confidential workforce and "
            "customer data, avoid conflicts of interest, and report harassment or "
            "discrimination immediately. Violations are investigated by HR and may lead to "
            "disciplinary action up to termination.",
        ),
        "88888888-0000-0000-0000-000000000005": (
            "Benefits Policy",
            "benefits",
            "Full-time employees receive group medical insurance covering self, spouse and "
            "two children, an annual health check, a learning allowance of 1,000 USD per "
            "year, a home office stipend, and access to the employee assistance programme.",
        ),
    }
    for pk, (title, cat, content) in kb_docs.items():
        doc, _ = KbDocument.objects.get_or_create(
            pk=pk, defaults={"title": title, "category": cat, "content": content}
        )
        KbChunk.objects.get_or_create(
            document=doc, chunk_index=0, defaults={"heading": title, "content": content}
        )

    insights = [
        ("Repeated attendance anomalies detected",
         "Several employees recorded three or more late arrivals in the last 30 days, "
         "concentrated in Engineering.",
         "warning", "Review flagged employees and start an HR follow-up", "/attendance"),
        ("Probation reviews due this month",
         "2 employees have probation periods ending within 60 days and no scheduled review.",
         "warning", "Schedule probation reviews", "/performance"),
        ("Onboarding tasks overdue",
         "3 onboarding tasks passed their due date and remain incomplete.",
         "critical", "Reassign owners and close overdue tasks", "/onboarding"),
        ("Documents expiring soon",
         "4 employee documents expire within 30 days, including two work authorisations.",
         "warning", "Request renewed documents", "/documents"),
        ("Hiring pipeline slowing",
         "Engineering pipeline conversion from screening to interview dropped compared with "
         "last month.",
         "info", "Review sourcing channels with the hiring manager", "/recruitment"),
    ]
    for title, detail, severity, action, link in insights:
        AiInsight.objects.get_or_create(
            title=title, defaults={
                "detail": detail, "severity": severity,
                "recommended_action": action, "link": link,
            }
        )

    # --------------------------------------------------------------- permissions
    permissions = [
        ("view_employee", "View employees", "employees", True),
        ("manage_employee", "Manage employees", "employees", True),
        ("view_attendance", "View attendance", "attendance", False),
        ("manage_attendance", "Manage attendance", "attendance", True),
        ("manage_shifts", "Manage shifts", "attendance", False),
        ("view_leave", "View leave", "leave", False),
        ("manage_leave", "Manage leave", "leave", True),
        ("view_performance", "View performance", "performance", True),
        ("manage_performance", "Manage performance", "performance", True),
        ("view_documents", "View employee documents", "documents", True),
        ("manage_documents", "Manage employee documents", "documents", True),
        ("view_recruitment", "View recruitment", "recruitment", True),
        ("manage_recruitment", "Manage recruitment", "recruitment", True),
        ("view_onboarding", "View onboarding", "onboarding", False),
        ("manage_onboarding", "Manage onboarding", "onboarding", True),
        ("view_helpdesk", "View helpdesk", "helpdesk", False),
        ("manage_helpdesk", "Manage helpdesk", "helpdesk", True),
        ("view_analytics", "View analytics", "analytics", True),
        ("view_audit", "View audit logs", "admin", True),
        ("manage_organization", "Manage organization structure", "admin", True),
        ("manage_users", "Manage user access", "admin", True),
        ("view_knowledge", "View knowledge base", "admin", False),
        ("manage_knowledge", "Manage knowledge base", "admin", True),
        ("use_ai", "Use Spine AI", "ai", False),
        ("manage_ai", "Manage AI actions", "ai", True),
        ("view_offboarding", "View offboarding", "offboarding", True),
        ("manage_offboarding", "Manage offboarding", "offboarding", True),
        ("view_letters", "View employee letters", "letters", True),
        ("manage_letters", "Manage employee letters", "letters", True),
        ("view_assets", "View company assets", "assets", False),
        ("manage_assets", "Manage company assets", "assets", True),
        ("view_training", "View training", "training", False),
        ("manage_training", "Manage training", "training", True),
        ("view_compliance", "View compliance", "compliance", True),
        ("manage_compliance", "Manage compliance", "compliance", True),
        ("view_payroll", "View payroll", "payroll", True),
        ("manage_payroll", "Manage payroll", "payroll", True),
    ]
    for code, label, cat, sensitive in permissions:
        Permission.objects.get_or_create(
            code=code, defaults={"label": label, "category": cat, "sensitive": sensitive}
        )

    # --------------------------------------------------------------- roles seed
    role_perm_map = {
        "hr_staff": [
            "view_employee", "manage_employee", "view_attendance", "manage_attendance",
            "manage_shifts", "view_leave", "manage_leave", "view_performance",
            "manage_performance", "view_documents", "manage_documents",
            "view_recruitment", "manage_recruitment", "view_onboarding",
            "manage_onboarding", "view_helpdesk", "manage_helpdesk", "view_analytics",
            "view_knowledge", "manage_knowledge", "use_ai", "manage_ai",
            "view_offboarding", "manage_offboarding",
            "view_letters", "manage_letters", "view_assets", "manage_assets",
            "view_training", "manage_training", "view_compliance", "manage_compliance",
            "view_payroll", "manage_payroll",
        ],
        "manager": [
            "view_employee", "view_attendance", "view_leave", "manage_leave",
            "view_performance", "manage_performance", "view_documents", "view_helpdesk",
            "view_analytics", "use_ai", "view_offboarding",
            "view_letters", "view_assets", "view_training", "view_compliance",
        ],
        "employee": [
            "view_attendance", "view_leave", "view_performance", "view_documents",
            "view_helpdesk", "use_ai", "view_training",
        ],
    }
    for role, codes in role_perm_map.items():
        for code in codes:
            perm = Permission.objects.get(code=code)
            RolePermission.objects.get_or_create(role=role, permission=perm)

    # --------------------------------------------------------------- demo users
    demo_users = [
        ("admin@northwind.io", "admin12345", "Meera Raghavan",
         "55555555-0000-0000-0000-000000000001", "super_admin", "ORGANIZATION"),
        ("priya@northwind.io", "priya12345", "Priya Deshpande",
         "55555555-0000-0000-0000-000000000003", "hr_admin", "ORGANIZATION"),
        ("neha@northwind.io", "neha12345", "Neha Gupta",
         "55555555-0000-0000-0000-000000000013", "hr_staff", "ORGANIZATION"),
        ("daniel@northwind.io", "daniel12345", "Daniel Okafor",
         "55555555-0000-0000-0000-000000000004", "manager", "DIRECT_REPORTS"),
        ("vikram@northwind.io", "vikram12345", "Vikram Shetty",
         "55555555-0000-0000-0000-000000000006", "employee", "SELF"),
        ("ananya@northwind.io", "ananya12345", "Ananya Iyer",
         "55555555-0000-0000-0000-000000000007", "employee", "SELF"),
        ("grace@northwind.io", "grace12345", "Grace Lin",
         "55555555-0000-0000-0000-000000000009", "employee", "SELF"),
    ]
    for email, password, full_name, emp_pk, role, scope in demo_users:
        user, created = AppUser.objects.get_or_create(
            email=email,
            defaults={
                "is_staff": role == "super_admin",
                "is_superuser": role == "super_admin",
            },
        )
        if created:
            user.password = make_password(password)
            user.save()
        Profile.objects.get_or_create(
            id=user, defaults={"email": email, "full_name": full_name, "status": "active"}
        )
        UserRole.objects.get_or_create(user=user, role=role, defaults={"scope": scope})
        Employee.objects.filter(pk=emp_pk).update(user=user)


def unseed(apps, schema_editor):  # noqa: ANN001, ARG002
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("hr", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]