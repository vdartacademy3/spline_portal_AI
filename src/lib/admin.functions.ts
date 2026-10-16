import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];
type DataScope = Database["public"]["Enums"]["data_scope"];

const ROLES: AppRole[] = ["super_admin", "hr_admin", "hr_staff", "manager", "employee"];
const SCOPES: DataScope[] = [
  "SELF",
  "DIRECT_REPORTS",
  "DEPARTMENT",
  "LOCATION",
  "LEGAL_ENTITY",
  "ORGANIZATION",
  "GLOBAL",
];

/* eslint-disable @typescript-eslint/no-explicit-any */
async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "super_admin",
  });
  if (error || !data) throw new Error("Forbidden: Super Admin access is required.");
}

type AdminClient = any;

async function admin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function writeAudit(
  db: AdminClient,
  entry: {
    userId: string;
    action: string;
    entity: string;
    entityId?: string | null;
    previous?: unknown;
    next?: unknown;
    status?: string;
  },
) {
  await db.from("audit_logs").insert({
    user_id: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    previous_value: (entry.previous ?? null) as never,
    new_value: (entry.next ?? null) as never,
    status: entry.status ?? "success",
  });
}

export type UserAccessRow = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole | null;
  roles: AppRole[];
  scope: DataScope | null;
  employeeCode: string | null;
  employeeId: string | null;
  department: string | null;
  location: string | null;
  manager: string | null;
  status: string;
  lastLogin: string | null;
  createdAt: string | null;
};

export const listUserAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserAccessRow[]> => {
    await assertSuperAdmin(context);
    const db = await admin();

    const [
      { data: profiles },
      { data: roleRows },
      { data: employees },
      { data: departments },
      { data: locations },
    ] = await Promise.all([
      db.from("profiles").select("id, full_name, email, status, last_login, created_at"),
      db.from("user_roles").select("user_id, role, scope"),
      db
        .from("employees")
        .select(
          "id, user_id, employee_code, first_name, last_name, department_id, location_id, manager_id",
        ),
      db.from("departments").select("id, name"),
      db.from("locations").select("id, name"),
    ]);

    const { data: authList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const lastSignIn = new Map<string, string | null>(
      (authList?.users ?? []).map((u: { id: string; last_sign_in_at: string | null }) => [
        u.id,
        u.last_sign_in_at,
      ]),
    );

    const deptName = new Map<string, string>(
      (departments ?? []).map((d: { id: string; name: string }) => [d.id, d.name]),
    );
    const locName = new Map<string, string>(
      (locations ?? []).map((l: { id: string; name: string }) => [l.id, l.name]),
    );
    const empById = new Map<string, { first_name: string; last_name: string }>(
      (employees ?? []).map((e: { id: string; first_name: string; last_name: string }) => [
        e.id,
        e,
      ]),
    );

    return (profiles ?? []).map((p: Record<string, string | null>) => {
      const assigned = (roleRows ?? []).filter((r: { user_id: string }) => r.user_id === p["id"]);
      const emp = (employees ?? []).find((e: { user_id: string | null }) => e.user_id === p["id"]);
      const mgr = emp?.manager_id ? empById.get(emp.manager_id) : null;
      return {
        userId: p["id"] as string,
        fullName: p["full_name"] ?? p["email"] ?? "Unnamed user",
        email: p["email"] ?? "",
        role: (assigned[0]?.role as AppRole) ?? null,
        roles: assigned.map((r: { role: AppRole }) => r.role),
        scope: (assigned[0]?.scope as DataScope) ?? null,
        employeeCode: emp?.employee_code ?? null,
        employeeId: emp?.id ?? null,
        department: emp?.department_id ? (deptName.get(emp.department_id) ?? null) : null,
        location: emp?.location_id ? (locName.get(emp.location_id) ?? null) : null,
        manager: mgr ? `${mgr.first_name} ${mgr.last_name}` : null,
        status: p["status"] ?? "active",
        lastLogin: lastSignIn.get(p["id"] as string) ?? p["last_login"] ?? null,
        createdAt: p["created_at"] ?? null,
      } satisfies UserAccessRow;
    });
  });

export const createUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      email: string;
      fullName: string;
      password: string;
      role: AppRole;
      scope: DataScope;
    }) => {
      if (!input.email.includes("@")) throw new Error("A valid work email is required.");
      if (input.password.length < 10) throw new Error("Use a password of at least 10 characters.");
      if (!ROLES.includes(input.role)) throw new Error("Unknown role.");
      if (!SCOPES.includes(input.scope)) throw new Error("Unknown data scope.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const db = await admin();

    const { data: created, error } = await db.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created?.user)
      throw new Error(error?.message ?? "The account could not be created.");

    await db.from("profiles").upsert({
      id: created.user.id,
      email: data.email,
      full_name: data.fullName,
      status: "active",
    });
    await db.from("user_roles").delete().eq("user_id", created.user.id);
    await db
      .from("user_roles")
      .insert({ user_id: created.user.id, role: data.role, scope: data.scope });

    await writeAudit(db, {
      userId: context.userId,
      action: "user.created",
      entity: "auth.users",
      entityId: created.user.id,
      next: { email: data.email, role: data.role, scope: data.scope },
    });
    return { userId: created.user.id };
  });

export const changeUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; role: AppRole; scope: DataScope }) => {
    if (!ROLES.includes(input.role)) throw new Error("Unknown role.");
    if (!SCOPES.includes(input.scope)) throw new Error("Unknown data scope.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const db = await admin();

    const { data: previous } = await db
      .from("user_roles")
      .select("role, scope")
      .eq("user_id", data.userId);

    await db.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await db
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role, scope: data.scope });
    if (error) throw new Error(error.message);

    await writeAudit(db, {
      userId: context.userId,
      action: "user.access_changed",
      entity: "user_roles",
      entityId: data.userId,
      previous,
      next: { role: data.role, scope: data.scope },
    });
    return { ok: true };
  });

export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; active: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.userId === context.userId) throw new Error("You cannot disable your own account.");
    const db = await admin();

    const { data: targetRoles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (
      !data.active &&
      (targetRoles ?? []).some((r: { role: AppRole }) => r.role === "super_admin")
    ) {
      const { count } = await db
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if ((count ?? 0) <= 1) throw new Error("The last Super Admin cannot be disabled.");
    }

    await db.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "876000h",
    });
    await db
      .from("profiles")
      .update({ status: data.active ? "active" : "disabled" })
      .eq("id", data.userId);

    await writeAudit(db, {
      userId: context.userId,
      action: data.active ? "user.reactivated" : "user.disabled",
      entity: "profiles",
      entityId: data.userId,
      previous: { status: data.active ? "disabled" : "active" },
      next: { status: data.active ? "active" : "disabled" },
    });
    return { ok: true };
  });

export const setRolePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role: AppRole; code: string; enabled: boolean }) => {
    if (!ROLES.includes(input.role)) throw new Error("Unknown role.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.role === "super_admin") throw new Error("Super Admin permissions cannot be reduced.");
    const db = await admin();

    if (data.enabled) {
      await db.from("role_permissions").insert({ role: data.role, permission_code: data.code });
    } else {
      await db
        .from("role_permissions")
        .delete()
        .eq("role", data.role)
        .eq("permission_code", data.code);
    }

    await writeAudit(db, {
      userId: context.userId,
      action: "permission.changed",
      entity: "role_permissions",
      entityId: `${data.role}:${data.code}`,
      previous: { enabled: !data.enabled },
      next: { enabled: data.enabled },
    });
    return { ok: true };
  });
