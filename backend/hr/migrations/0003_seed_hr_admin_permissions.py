"""Seed hr_admin role permissions.

0002 seeded role_permissions for hr_staff/manager/employee but omitted
`hr_admin`, which left that role with zero permissions and its
ORGANIZATION data scope never activating in the RBAC engine.

Idempotent: safe on fresh and already-migrated databases.
"""

from django.db import migrations

HR_ADMIN_PERMISSIONS = [
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
    "view_audit", "manage_organization", "manage_users",
]


def seed(apps, schema_editor):  # noqa: ANN001
    Permission = apps.get_model("hr", "Permission")
    RolePermission = apps.get_model("hr", "RolePermission")
    for code in HR_ADMIN_PERMISSIONS:
        try:
            perm = Permission.objects.get(code=code)
        except Permission.DoesNotExist:
            continue
        RolePermission.objects.get_or_create(role="hr_admin", permission=perm)


def unseed(apps, schema_editor):  # noqa: ANN001, ARG002
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("hr", "0002_seed_data"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]