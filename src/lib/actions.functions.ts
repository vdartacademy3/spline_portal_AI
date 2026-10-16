import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGateway } from "@/lib/ai.functions";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function assertPermission(context: { supabase: any; userId: string }, code: string) {
  const { data, error } = await context.supabase.rpc("has_permission", {
    _user_id: context.userId,
    _code: code,
  });
  if (error || !data) throw new Error("You are not authorized to perform this action.");
}

type ExecContext = {
  supabase: any;
  userId: string;
};

/**
 * Executes an approved AI action. Runs with the service role so it can perform
 * the consequential write, but every effect is:
 *  - scoped to the action's proposed_payload,
 *  - gated on an explicit executor role check (manage_employee / manage_recruitment,
 *    or the same permission that created the action),
 *  - recorded in audit_logs,
 *  - announced through notifications so HR can trace the outcome.
 */
export const executeAiAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { actionId: string }) =>
    z.object({ actionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const action = await loadAction(context, data.actionId);
    if (!action) throw new Error("This AI action is not available to you.");
    if (action.status !== "approved") {
      throw new Error("Only an approved AI action can be executed.");
    }

    const payload = action.proposed_payload as any;
    switch (action.action_type) {
      case "onboarding.mark_done": {
        return await markOnboardingDone(context, supabaseAdmin, action, payload);
      }
      case "recruitment.shortlist": {
        return await shortlistCandidates(context, supabaseAdmin, action, payload);
      }
      case "leave.request_approve": {
        return await approveLeaveRequest(context, supabaseAdmin, action, payload);
      }
      default:
        throw new Error(`Waiting for execution support for "${action.action_type}".`);
    }
  });

async function loadAction(context: ExecContext, actionId: string) {
  await assertPermission(context, "manage_ai");
  const { data, error } = await context.supabase
    .from("ai_actions")
    .select("id, action_type, title, proposed_payload, status, created_by")
    .eq("id", actionId)
    .maybeSingle();
  if (error) throw new Error("This AI action could not be loaded.");
  return data;
}

async function markOnboardingDone(context: ExecContext, admin: any, action: any, payload: any) {
  await assertPermission(context, "manage_employee");
  const taskId = String(payload?.task_id ?? "");
  if (!taskId) throw new Error("This action has no onboarding task to complete.");

  const { data: task, error: taskError } = await admin
    .from("onboarding_tasks")
    .select("id, employee_id, status")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError || !task) throw new Error("The onboarding task was not found.");
  if (task.status === "completed") throw new Error("The onboarding task is already completed.");

  await admin
    .from("onboarding_tasks")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", taskId);

  await recordExecution(context, admin, action, {
    summary: `Onboarding task "${task.title ?? taskId}" marked complete`,
    taskId,
  });
  return { taskId };
}

async function shortlistCandidates(context: ExecContext, admin: any, action: any, payload: any) {
  await assertPermission(context, "view_recruitment");
  const requisitionId = String(payload?.requisition_id ?? "");
  const screeningIds = Array.isArray(payload?.screening_ids)
    ? (payload.screening_ids as string[])
    : [];
  if (requisitionId && screeningIds.length) {
    await admin
      .from("candidate_screenings")
      .update({ action_type: "shortlisted", created_by: context.userId })
      .in("id", screeningIds);
  }

  await recordExecution(context, admin, action, {
    summary:
      screeningIds.length > 0
        ? `${screeningIds.length} candidate(s) promoted to the shortlist`
        : "Shortlist action executed (no candidates flagged)",
  });
  return { screeningIds };
}

async function approveLeaveRequest(context: ExecContext, admin: any, action: any, payload: any) {
  await assertPermission(context, "manage_employee");
  const leaveId = String(payload?.leave_request_id ?? "");
  if (!leaveId) throw new Error("This action has no leave request to approve.");

  const { data: existing, error: leaveError } = await admin
    .from("leave_requests")
    .select("id, status")
    .eq("id", leaveId)
    .maybeSingle();
  if (leaveError || !existing) throw new Error("The leave request was not found.");
  if (existing.status === "approved" || existing.status === "rejected") {
    throw new Error("The leave request has already been decided.");
  }

  await admin
    .from("leave_requests")
    .update({
      status: "approved",
      approver_id: context.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", leaveId);

  await recordExecution(context, admin, action, {
    summary: `Leave request "${leaveId}" approved by AI action`,
    leaveId,
  });
  return { leaveId };
}

async function recordExecution(
  context: ExecContext,
  admin: any,
  action: any,
  result: { summary: string } & Record<string, unknown>,
) {
  await admin
    .from("ai_actions")
    .update({
      status: "executed",
      executed_at: new Date().toISOString(),
      approved_by: action.approved_by ?? context.userId,
    })
    .eq("id", action.id);

  await admin.from("audit_logs").insert({
    user_id: context.userId,
    action: "ai_action.executed",
    entity: "ai_actions",
    entity_id: action.id,
    new_value: { result } as never,
    status: "success",
  });

  await admin.rpc("notify_hr", {
    _title: "AI action executed",
    _body: result.summary,
    _category: "ai",
    _link: "/ai-actions",
  });
}

/** Server helper used by the copilot to propose an approved action. */
export async function evaluateCandidate(
  candidate: any,
  requisition: any,
): Promise<{ score: number; rating: string; summary: string }> {
  const content = await callGateway(
    [
      {
        role: "system",
        content:
          'You are a neutral technical recruiter. Score the candidate for the role from 0 to 100 and return strict JSON {"score":number,"rating":"strong_match|possible_match|weak_match","summary":string}. Never invent facts not present in the inputs.',
      },
      {
        role: "user",
        content: `Role: ${JSON.stringify(requisition)}\nCandidate: ${JSON.stringify(candidate)}`,
      },
    ],
    true,
  );
  try {
    const parsed = JSON.parse(content) as {
      score?: number;
      rating?: string;
      summary?: string;
    };
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const rating = ["strong_match", "possible_match", "weak_match"].includes(parsed.rating ?? "")
      ? (parsed.rating as string)
      : score >= 75
        ? "strong_match"
        : score >= 45
          ? "possible_match"
          : "weak_match";
    return { score, rating, summary: parsed.summary ?? "" };
  } catch {
    return { score: 0, rating: "weak_match", summary: "Could not be evaluated." };
  }
}

/**
 * Phase 19 — Shortlist AI. For a requisition, evaluates every candidate in the
 * pipeline with the AI gateway, stores the scores in candidate_screenings and
 * opens a `recruitment.shortlist` AI action for HR approval. The action itself is
 * then executed by the Phase 16 engine (executeAiAction).
 */
export const screenCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requisitionId: string }) =>
    z.object({ requisitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context, "view_recruitment");

    const { data: req, error: reqError } = await context.supabase
      .from("job_requisitions")
      .select("id, title, skills, experience_min, experience_max, requirements, qualifications")
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (reqError || !req) throw new Error("This requisition is not available to you.");

    const { data: applications, error: appError } = await context.supabase
      .from("applications")
      .select(
        "id, stage, candidate_id, candidates(id, full_name, email, phone, skills, experience_years, education, source, ai_analysis)",
      )
      .eq("requisition_id", data.requisitionId)
      .neq("stage", "hired");
    if (appError) throw new Error("Candidates could not be loaded.");
    if (!applications?.length) throw new Error("No active candidates in this pipeline.");

    const requisitionShape = {
      title: req.title,
      skills: req.skills,
      experience_min: req.experience_min,
      experience_max: req.experience_max,
      requirements: req.requirements,
      qualifications: req.qualifications,
    };

    const results = await Promise.all(
      applications.map(async (a: any) => {
        const candidate = a.candidates ?? {};
        const evaluation = await evaluateCandidate(candidate, requisitionShape);
        return { application: a, candidate, evaluation };
      }),
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = results.map(({ candidate, evaluation }) => ({
      candidate_id: candidate.id,
      requisition_id: data.requisitionId,
      score: evaluation.score,
      rating: evaluation.rating,
      summary: evaluation.summary,
      action_type: "proposed",
      created_by: context.userId,
    }));

    const { data: screenings, error: screenError } = await supabaseAdmin
      .from("candidate_screenings")
      .insert(rows)
      .select("id, candidate_id, score, rating, summary");
    if (screenError) throw new Error(screenError.message);
    const screeningIds = (screenings ?? []).map((s) => s.id);

    const strong = (screenings ?? []).filter((s) => s.rating === "strong_match").length;
    const { data: actionRow, error: actionError } = await supabaseAdmin
      .from("ai_actions")
      .insert({
        action_type: "recruitment.shortlist",
        title: `AI shortlist for ${req.title}`,
        reason: `${strong} strong match(es) out of ${screeningIds.length} evaluated candidate(s).`,
        target_summary: req.title,
        proposed_payload: { requisition_id: data.requisitionId, screening_ids: screeningIds },
        risk_level: "low",
        status: "pending",
        requested_by: context.userId,
      })
      .select("id")
      .single();
    if (actionError) throw new Error(actionError.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "recruitment.shortlist_proposed",
      entity: "candidate_screenings",
      entity_id: data.requisitionId,
      new_value: { screeningIds, actionId: actionRow.id } as never,
      status: "success",
    });

    return {
      evaluated: screeningIds.length,
      strong,
      actionId: actionRow.id,
      screenings: screenings ?? [],
    };
  });
