import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Employees may submit (but never alter post-submission) their own self-review through this trusted path. */
export const submitSelfReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        reviewId: z.string().uuid(),
        selfRating: z.number().min(1).max(5),
        selfStrengths: z.string().max(2000),
        selfImprovements: z.string().max(2000),
        selfSummary: z.string().max(2000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: myEmployeeId, error: meError } = await context.supabase.rpc(
      "current_employee_id",
      {
        _user_id: context.userId,
      },
    );
    if (meError) throw meError;
    if (!myEmployeeId) throw new Error("No employee profile is linked to this account.");

    const { data: review, error: getError } = await context.supabase
      .from("performance_reviews")
      .select("id, employee_id, status, finalized_at, self_submitted_at")
      .eq("id", data.reviewId)
      .single();
    if (getError) throw getError;
    if (review.employee_id !== myEmployeeId) {
      throw new Error("You can only submit your own self-review.");
    }
    if (review.finalized_at) throw new Error("This review is already finalized.");
    if (review.self_submitted_at) throw new Error("Self-review already submitted.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("performance_reviews")
      .update({
        self_rating: data.selfRating,
        self_strengths: data.selfStrengths,
        self_improvements: data.selfImprovements,
        self_summary: data.selfSummary,
        self_submitted_at: new Date().toISOString(),
        status: review.status === "draft" ? "self_submitted" : review.status,
      } as never)
      .eq("id", data.reviewId);
    if (error) throw error;
    return { ok: true };
  });
