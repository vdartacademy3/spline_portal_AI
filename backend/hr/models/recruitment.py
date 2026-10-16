import uuid

from django.db import models

from hr.models.core import AppUser, Department, Employee, Location, Organization


class JobRequisition(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    title = models.CharField(max_length=255)
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="department_id",
    )
    location = models.ForeignKey(
        Location,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="location_id",
    )
    employment_type = models.CharField(max_length=32, default="full_time")
    experience_min = models.IntegerField(default=0)
    experience_max = models.IntegerField(null=True, blank=True)
    skills = models.JSONField(default=list)
    salary_min = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    salary_max = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    hiring_manager = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="hiring_manager_id",
        related_name="+",
    )
    openings = models.IntegerField(default=1)
    status = models.CharField(max_length=32, default="open")
    slug = models.CharField(max_length=255, null=True, blank=True, unique=True)
    description = models.TextField(null=True, blank=True)
    responsibilities = models.TextField(null=True, blank=True)
    requirements = models.TextField(null=True, blank=True)
    qualifications = models.TextField(null=True, blank=True)
    work_mode = models.CharField(max_length=32, null=True, blank=True)
    approved_by = models.UUIDField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "job_requisitions"


class Candidate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    job = models.ForeignKey(
        JobRequisition,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="job_id",
        related_name="candidates",
    )
    full_name = models.CharField(max_length=255)
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=64, null=True, blank=True)
    resume_url = models.TextField(null=True, blank=True)
    skills = models.JSONField(default=list)
    experience_years = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    education = models.TextField(null=True, blank=True)
    source = models.CharField(max_length=64, null=True, blank=True)
    stage = models.CharField(max_length=64, default="applied")
    match_score = models.IntegerField(null=True, blank=True)
    ai_analysis = models.JSONField(null=True, blank=True)
    location = models.CharField(max_length=255, null=True, blank=True)
    resume_path = models.TextField(null=True, blank=True)
    notice_period = models.CharField(max_length=128, null=True, blank=True)
    expected_salary = models.CharField(max_length=128, null=True, blank=True)
    parsed_resume = models.JSONField(null=True, blank=True)
    # See Employee.is_fixture. Seeded candidates own candidate-resumes objects.
    is_fixture = models.BooleanField(default=False)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "candidates"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "email"], name="candidate_email_org_key"
            )
        ]


class Application(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    requisition = models.ForeignKey(
        JobRequisition, on_delete=models.CASCADE, db_column="requisition_id"
    )
    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE, db_column="candidate_id"
    )
    stage = models.CharField(max_length=64, default="applied")
    status = models.CharField(max_length=32, default="active")
    cover_letter = models.TextField(null=True, blank=True)
    resume_path = models.TextField(null=True, blank=True)
    answers = models.JSONField(null=True, blank=True)
    source = models.CharField(max_length=64, default="careers_site")
    consent = models.BooleanField(default=False)
    ai_screening = models.JSONField(null=True, blank=True)
    match_score = models.IntegerField(null=True, blank=True)
    rejection_reason = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "applications"
        constraints = [
            models.UniqueConstraint(
                fields=["requisition", "candidate"], name="application_unique_key"
            )
        ]


class Interview(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, db_column="application_id"
    )
    round = models.CharField(max_length=64, default="screening")
    interview_type = models.CharField(max_length=32, default="video")
    scheduled_at = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.IntegerField(default=45)
    meeting_link = models.TextField(null=True, blank=True)
    location = models.CharField(max_length=255, null=True, blank=True)
    status = models.CharField(max_length=32, default="scheduled")
    outcome = models.CharField(max_length=255, null=True, blank=True)
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "interviews"


class InterviewPanel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    interview = models.ForeignKey(Interview, on_delete=models.CASCADE, db_column="interview_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    role = models.CharField(max_length=64, default="interviewer")

    class Meta:
        db_table = "interview_panel"
        constraints = [
            models.UniqueConstraint(
                fields=["interview", "employee"], name="panel_unique_key"
            )
        ]


class InterviewFeedback(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    interview = models.ForeignKey(Interview, on_delete=models.CASCADE, db_column="interview_id")
    reviewer = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="reviewer_id",
        related_name="+",
    )
    rating = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    recommendation = models.CharField(max_length=64, null=True, blank=True)
    strengths = models.TextField(null=True, blank=True)
    concerns = models.TextField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "interview_feedback"
        constraints = [
            models.UniqueConstraint(
                fields=["interview", "reviewer"], name="feedback_unique_key"
            )
        ]


class Offer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
    )
    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, db_column="application_id"
    )
    designation = models.CharField(max_length=255, null=True, blank=True)
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="department_id",
    )
    location = models.ForeignKey(
        Location,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="location_id",
    )
    employment_type = models.CharField(max_length=32, default="full_time")
    annual_ctc = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=8, default="INR")
    start_date = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, default="draft")
    approved_by = models.UUIDField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    response_note = models.TextField(null=True, blank=True)
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "offers"


class CandidateScreening(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, db_column="candidate_id")
    requisition = models.ForeignKey(
        JobRequisition,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        db_column="requisition_id",
    )
    score = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    rating = models.CharField(max_length=32, default="neutral")
    summary = models.TextField(null=True, blank=True)
    evidence = models.JSONField(null=True, blank=True)
    action_type = models.CharField(max_length=32, default="shortlist")
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "candidate_screenings"