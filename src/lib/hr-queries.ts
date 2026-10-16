import { supabase } from "@/integrations/supabase/client";

export type EmployeeRow = {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  designation: string | null;
  employment_status: string;
  employment_type: string;
  joining_date: string;
  work_email: string | null;
  phone: string | null;
  probation_end_date: string | null;
  department_id: string | null;
  location_id: string | null;
  manager_id: string | null;
  user_id: string | null;
  organization_id: string | null;
};

export const EMPLOYEE_FIELDS =
  "id, employee_code, first_name, last_name, designation, employment_status, employment_type, joining_date, work_email, phone, probation_end_date, department_id, location_id, manager_id, user_id, organization_id";

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from("employees")
    .select(EMPLOYEE_FIELDS)
    .order("first_name");
  if (error) throw error;
  return (data ?? []) as EmployeeRow[];
}

export async function fetchOrganization() {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, code, timezone, currency")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchDepartments() {
  const { data, error } = await supabase.from("departments").select("id, name, code").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchLocations() {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, city, country")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export function employeeName(e: { first_name: string; last_name: string } | null | undefined) {
  return e ? `${e.first_name} ${e.last_name}` : "—";
}

export function nameMap(employees: EmployeeRow[]) {
  return new Map(employees.map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
}

export function labelMap(rows: { id: string; name: string }[]) {
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function logAudit(params: {
  userId: string | undefined;
  action: string;
  entity?: string;
  entityId?: string;
  previous?: unknown;
  next?: unknown;
}) {
  if (!params.userId) return;
  await supabase.from("audit_logs").insert({
    user_id: params.userId,
    action: params.action,
    entity: params.entity ?? null,
    entity_id: params.entityId ?? null,
    previous_value: (params.previous ?? null) as never,
    new_value: (params.next ?? null) as never,
  });
}

export function daysUntil(date: string | null | undefined) {
  if (!date) return null;
  const target = new Date(date).getTime();
  // An unparseable date parses to NaN, which is neither a day count nor `null`.
  // Callers guard this result with `!== null` (or `?? 1`), and both let a NaN
  // through — it renders as "NaN" and compares false against every bound. Report
  // an unparseable date as "no date" so those guards hold as intended.
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}
