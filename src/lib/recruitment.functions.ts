import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */

const RESUME_BUCKET = "candidate-resumes";

async function assertPermission(context: { supabase: any; userId: string }, code: string) {
  const { data, error } = await context.supabase.rpc("has_permission", {
    _user_id: context.userId,
    _code: code,
  });
  if (error || !data) throw new Error("You are not authorized to perform this action.");
}

/** Short-lived signed URL for a candidate resume, only for authorized recruiters. */
export const getCandidateResumeUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string }) =>
    z.object({ candidateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "view_recruitment");
    // RLS scopes this read to the caller's organization.
    const { data: candidate, error } = await context.supabase
      .from("candidates")
      .select("id, resume_path")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (error || !candidate?.resume_path) return { url: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(candidate.resume_path, 300);
    return { url: signed?.signedUrl ?? null };
  });

/**
 * Converts a hired candidate with an accepted offer into an employee record.
 * Refuses when the offer is not accepted or the candidate is already converted.
 */
export const convertCandidateToEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { applicationId: string; employeeCode: string; joiningDate: string }) =>
    z
      .object({
        applicationId: z.string().uuid(),
        employeeCode: z.string().trim().min(2).max(24),
        joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "manage_employee");

    const { data: application, error: appError } = await context.supabase
      .from("applications")
      .select(
        "id, stage, organization_id, candidate_id, requisition_id, candidates(id, full_name, email, phone), job_requisitions(id, title, department_id, location_id, employment_type)",
      )
      .eq("id", data.applicationId)
      .maybeSingle();
    if (appError || !application) throw new Error("This application is not available to you.");

    const { data: offer } = await context.supabase
      .from("offers")
      .select("id, status, designation, department_id, location_id, employment_type, start_date")
      .eq("application_id", data.applicationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!offer || offer.status !== "accepted") {
      throw new Error("Convert to employee only after the candidate accepts an offer.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("employees")
      .select("id")
      .eq("employee_code", data.employeeCode)
      .maybeSingle();
    if (existing) throw new Error("That employee code is already in use.");

    const candidate = (application as any).candidates;
    const job = (application as any).job_requisitions;
    const parts = String(candidate?.full_name ?? "New Hire")
      .trim()
      .split(/\s+/);
    const firstName = parts[0] ?? "New";
    const lastName = parts.slice(1).join(" ") || "Hire";

    const { data: employee, error: empError } = await supabaseAdmin
      .from("employees")
      .insert({
        employee_code: data.employeeCode,
        first_name: firstName,
        last_name: lastName,
        work_email: candidate?.email ?? null,
        phone: candidate?.phone ?? null,
        organization_id: application.organization_id,
        department_id: offer.department_id ?? job?.department_id ?? null,
        location_id: offer.location_id ?? job?.location_id ?? null,
        designation: offer.designation ?? job?.title ?? null,
        employment_type: offer.employment_type ?? job?.employment_type ?? "full_time",
        employment_status: "active",
        joining_date: offer.start_date ?? data.joiningDate,
      })
      .select("id, first_name, last_name")
      .single();
    if (empError || !employee) throw new Error("The employee record could not be created.");

    await supabaseAdmin
      .from("applications")
      .update({ stage: "hired", status: "closed", updated_at: new Date().toISOString() })
      .eq("id", data.applicationId);
    await supabaseAdmin
      .from("candidates")
      .update({ stage: "hired" })
      .eq("id", application.candidate_id);

    const tasks = [
      "Collect signed offer and identity documents",
      "Create workplace accounts and access",
      "Assign reporting manager and buddy",
      "Schedule day-one orientation",
    ];
    await supabaseAdmin.from("onboarding_tasks").insert(
      tasks.map((title) => ({
        employee_id: employee.id,
        candidate_id: application.candidate_id,
        title,
        owner: "HR",
        status: "pending",
      })),
    );

    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "candidate.converted_to_employee",
      entity: "employees",
      entity_id: employee.id,
      new_value: { applicationId: data.applicationId, employeeCode: data.employeeCode } as never,
      status: "success",
    });

    return { employeeId: employee.id as string };
  });
