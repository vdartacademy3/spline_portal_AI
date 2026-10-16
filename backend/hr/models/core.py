import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class AppUser(AbstractUser):
    """UUID-pk user (replaces Supabase auth.users)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    username = None
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "auth_users"

    def __str__(self):  # pragma: no cover
        return self.email


class AppRole(models.TextChoices):
    SUPER_ADMIN = "super_admin"
    HR_ADMIN = "hr_admin"
    HR_STAFF = "hr_staff"
    MANAGER = "manager"
    EMPLOYEE = "employee"


class DataScope(models.TextChoices):
    SELF = "SELF"
    DIRECT_REPORTS = "DIRECT_REPORTS"
    DEPARTMENT = "DEPARTMENT"
    LOCATION = "LOCATION"
    LEGAL_ENTITY = "LEGAL_ENTITY"
    ORGANIZATION = "ORGANIZATION"
    GLOBAL = "GLOBAL"


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64, unique=True)
    industry = models.CharField(max_length=255, null=True, blank=True)
    timezone = models.CharField(max_length=64, default="UTC")
    currency = models.CharField(max_length=8, default="USD")
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "organizations"


class LegalEntity(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, db_column="organization_id"
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64)
    registration_number = models.CharField(max_length=255, null=True, blank=True)
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "legal_entities"


class Location(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, db_column="organization_id"
    )
    legal_entity = models.ForeignKey(
        LegalEntity,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="legal_entity_id",
    )
    name = models.CharField(max_length=255)
    address = models.TextField(null=True, blank=True)
    city = models.CharField(max_length=255, null=True, blank=True)
    country = models.CharField(max_length=255, null=True, blank=True)
    timezone = models.CharField(max_length=64, default="UTC")
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "locations"


class Department(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, db_column="organization_id"
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=32)
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)
    department_head = models.ForeignKey(
        "Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="department_head_id",
        related_name="headed_departments",
    )

    class Meta:
        db_table = "departments"


class Profile(models.Model):
    id = models.OneToOneField(AppUser, primary_key=True, on_delete=models.CASCADE, db_column="id")
    email = models.EmailField(null=True, blank=True)
    full_name = models.CharField(max_length=255, null=True, blank=True)
    avatar_url = models.TextField(null=True, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=32, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "profiles"


class UserRole(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="user_id")
    role = models.CharField(max_length=32, choices=AppRole.choices)
    scope = models.CharField(max_length=32, choices=DataScope.choices, default=DataScope.SELF)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_roles"
        constraints = [
            models.UniqueConstraint(fields=["user", "role"], name="user_roles_user_role_key")
        ]


class Employee(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee_code = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(
        AppUser, on_delete=models.SET_NULL, null=True, blank=True, db_column="user_id"
    )
    first_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=255)
    profile_photo = models.CharField(max_length=2048, null=True, blank=True)
    work_email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=64, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=32, null=True, blank=True)
    joining_date = models.DateField(null=True, blank=True)
    employment_type = models.CharField(max_length=32, default="full_time")
    employment_status = models.CharField(max_length=32, default="active")
    designation = models.CharField(max_length=255, null=True, blank=True)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="organization_id",
        related_name="employees",
    )
    legal_entity = models.ForeignKey(
        LegalEntity,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="legal_entity_id",
    )
    location = models.ForeignKey(
        Location,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="location_id",
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="department_id",
    )
    manager = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="manager_id",
        related_name="direct_reports",
    )
    probation_end_date = models.DateField(null=True, blank=True)
    emergency_contact = models.TextField(null=True, blank=True)
    # True only for rows created by the seed/fixture process (0002_seed_data).
    # Guards destructive endpoints against cascading loss of fixture data.
    # Defaults to False so ordinary records are never protected implicitly.
    is_fixture = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employees"


class Permission(models.Model):
    code = models.CharField(max_length=64, primary_key=True)
    label = models.CharField(max_length=255)
    category = models.CharField(max_length=64, default="general")
    sensitive = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "permissions"


class RolePermission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=32, choices=AppRole.choices)
    permission = models.ForeignKey(
        Permission, on_delete=models.CASCADE, db_column="permission_code"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["role", "permission"], name="role_permissions_role_perm_key"
            )
        ]