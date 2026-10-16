import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */

const terminateSchema = z.object({
  employeeId: z.string().uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1).max(1000),
});

/**
 * Phase 10 — Employee termination. Marks the employee as `terminated`, records
 * a lifecycle event (previous/new status as JSON, submitted reason) and writes
 * an audit trail. The employee status update runs as the signed-in HR user so
 * RLS applies; the lifecycle event goes through the service role because the
 * user-scoped REST insert for that table has a pre-existing arity defect (the
 * insert policy calls the 3-arg check with it missing) which is out of scope.
 */
export const terminateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => terminateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permError } = await context.supabase.rpc("can_manage_employee", {
      _user_id: context.userId,
      _employee_id: data.employeeId,
    });
    if (permError) throw permError;
    if (!allowed) throw new Error("You are not authorized to manage this employee.");

    const { data: employee, error: loadError } = await context.supabase
      .from("employees")
      .select("id, employment_status, user_id")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!employee) throw new Error("This employee could not be found.");
    if (employee.employment_status === "terminated" || employee.employment_status === "exited") {
      throw new Error(`This employee is already ${employee.employment_status}.`);
    }
    if (employee.user_id === context.userId) {
      throw new Error("You cannot terminate your own employment record.");
    }

    const { error: updateError } = await context.supabase
      .from("employees")
      .update({ employment_status: "terminated", updated_at: new Date().toISOString() })
      .eq("id", data.employeeId);
    if (updateError) throw updateError;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Generated Supabase types are stale (declare `actor_id` whereas the live DB
    // and Django model use `actor`), so these service-role calls are cast.
    const { data: event, error: eventError } = await (
      supabaseAdmin.from("employee_lifecycle_events") as any
    )
      .insert({
        employee_id: data.employeeId,
        event_type: "terminated",
        previous_value: { employment_status: employee.employment_status },
        new_value: { employment_status: "terminated" },
        reason: data.reason,
        actor: context.userId,
      })
      .select("id")
      .single();
    if (eventError) throw eventError;

    // effective_date is auto_now_add on the model, so it is forced to today at
    // INSERT time; PATCH the requested date onto the created event.
    const { error: dateError } = await (supabaseAdmin.from("employee_lifecycle_events") as any)
      .update({ effective_date: data.effectiveDate })
      .eq("id", event.id);
    if (dateError) throw dateError;

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      action: "employee.terminated",
      entity: "employees",
      entity_id: data.employeeId,
      previous_value: { employment_status: employee.employment_status } as never,
      new_value: { employment_status: "terminated", effective_date: data.effectiveDate } as never,
      status: "success",
    });

    return { id: data.employeeId, lifecycleEventId: event.id as string };
  });
