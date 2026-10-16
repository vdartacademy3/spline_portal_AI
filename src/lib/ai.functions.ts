import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { retrieveKnowledge, type KnowledgeHit } from "@/lib/knowledge";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.8-flash";

export async function callGateway(messages: { role: string; content: string }[], json: boolean) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (res.status === 429) throw new Error("Spine AI is busy right now. Please try again shortly.");
  if (res.status === 402) throw new Error("AI usage limit reached for this workspace.");
  if (!res.ok) throw new Error("Spine AI could not complete this request.");

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Permission-aware workforce snapshot: every read runs as the signed-in user, so RLS scopes it. */
async function buildSnapshot(
  supabase: Awaited<ReturnType<typeof getClient>>,
  allowed: (code: string) => boolean,
  policyHits: KnowledgeHit[],
) {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [
    employees,
    departments,
    attendance,
    leaves,
    leaveTypes,
    jobs,
    candidates,
    docs,
    tickets,
    goals,
    reviews,
    onboarding,
  ] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, employee_code, first_name, last_name, designation, employment_status, joining_date, department_id, probation_end_date, manager_id",
      ),
    supabase.from("departments").select("id, name"),
    supabase
      .from("attendance_records")
      .select("employee_id, work_date, status, late_minutes")
      .gte("work_date", since),
    supabase
      .from("leave_requests")
      .select("employee_id, leave_type_id, start_date, end_date, days, status"),
    supabase.from("leave_types").select("id, name"),
    allowed("view_recruitment")
      ? supabase.from("job_requisitions").select("id, title, status, openings")
      : Promise.resolve({ data: [] as never[] }),
    allowed("view_recruitment")
      ? supabase.from("candidates").select("id, full_name, stage, match_score, job_id")
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("employee_documents")
      .select("employee_id, name, expiry_date, verification_status"),
    supabase.from("helpdesk_tickets").select("id, subject, status, priority, category"),
    supabase.from("goals").select("employee_id, title, progress, status, due_date"),
    allowed("view_performance")
      ? supabase
          .from("performance_reviews")
          .select("employee_id, period, rating, strengths, improvements")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("onboarding_tasks").select("employee_id, title, status, due_date"),
  ]);

  const policy = policyHits.map((h) => ({
    heading: h.documentTitle ? `${h.documentTitle} — ${h.heading}` : h.heading,
    content: h.content,
  }));

  const deptName = new Map((departments.data ?? []).map((d: any) => [d.id, d.name]));

  return {
    today,
    employees: (employees.data ?? []).map((e: any) => ({
      code: e.employee_code,
      name: `${e.first_name} ${e.last_name}`,
      designation: e.designation,
      department: deptName.get(e.department_id ?? "") ?? null,
      status: e.employment_status,
      joined: e.joining_date,
      probation_ends: e.probation_end_date,
    })),
    attendance_last_30_days: attendance.data ?? [],
    leave_requests: (leaves.data ?? []).map((l: any) => ({
      ...l,
      type: (leaveTypes.data ?? []).find((t: any) => t.id === l.leave_type_id)?.name ?? null,
    })),
    jobs: jobs.data ?? [],
    candidates: candidates.data ?? [],
    documents: docs.data ?? [],
    helpdesk_tickets: tickets.data ?? [],
    goals: goals.data ?? [],
    reviews: reviews.data ?? [],
    onboarding_tasks: onboarding.data ?? [],
    policy_excerpts: policy,
    sensitive_data_access: allowed("view_sensitive"),
  };
}

// Typing helper so buildSnapshot can accept the middleware client.
async function getClient() {
  return null as unknown as import("@/integrations/supabase/core").SpineClient<
    import("@/integrations/supabase/types").Database
  >;
}

const SYSTEM = `You are Spine AI, an enterprise HR intelligence copilot.
Rules you must never break:
- Answer ONLY from the workforce snapshot and policy excerpts provided. They already contain exactly the data this user is authorized to see.
- If the snapshot does not contain the information (for example salary or compensation data), reply that the user does not have access to it or that the information is not available. Never guess.
- Compensation, salary and other sensitive details may only be discussed when the snapshot field sensitive_data_access is true; otherwise state plainly that the user is not authorised to see that information.
- Never invent company policy. If the policy excerpts do not cover the question, say the knowledge base does not have enough information.
- Clearly separate facts, calculations, recommendations and proposed actions.
- Recommendations are decision support only; sensitive HR actions require human approval.
Respond with strict JSON of the form:
{"answer": string, "table": {"columns": string[], "rows": string[][]} | null, "recommendations": string[], "sources": string[]}
Keep the answer concise (max 120 words). Use the table only when listing records.`;

export const askSpineAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ question: z.string().min(2).max(500) }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    const superAdmin = roles.includes("super_admin");

    const { data: permRows } = await context.supabase
      .from("role_permissions")
      .select("permission_code")
      .in("role", roles.length ? (roles as never[]) : (["employee"] as never[]));
    const granted = new Set((permRows ?? []).map((p) => p.permission_code));
    const allowed = (code: string) => superAdmin || granted.has(code);

    if (!allowed("use_ai")) throw new Error("You do not have access to Spine AI.");

    // Semantic knowledge retrieval runs as the caller, so RLS filters matches; if the
    // embedding service or vector index is unavailable it falls back to stored-text search.
    const embedKey = process.env["LOVABLE_API_KEY"];
    const policyHits = await retrieveKnowledge(context.supabase, data.question, {
      ...(embedKey ? { apiKey: embedKey } : {}),
      limit: 4,
    });

    const snapshot = await buildSnapshot(context.supabase, allowed, policyHits);
    const rolesText = roles.join(", ") || "employee";

    const content = await callGateway(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Signed-in user roles: ${rolesText}.
Question: ${data.question}

Authorized workforce snapshot (JSON):
${JSON.stringify(snapshot).slice(0, 120_000)}`,
        },
      ],
      true,
    );

    let parsed: {
      answer: string;
      table?: { columns: string[]; rows: string[][] } | null;
      recommendations?: string[];
      sources?: string[];
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {
        answer: content || "Spine AI could not find enough information to answer this question.",
      };
    }

    return {
      answer: parsed.answer,
      table: parsed.table ?? null,
      recommendations: parsed.recommendations ?? [],
      sources: parsed.sources ?? snapshot.policy_excerpts.map((p) => p.heading),
    };
  });

export const generateHrDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ template: z.string().min(2), instructions: z.string().max(2000).default("") })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const body = await callGateway(
      [
        {
          role: "system",
          content:
            "You draft professional, neutral HR documents for an enterprise. Produce a complete draft with placeholders in square brackets where facts are missing. Never state company policy you were not given. The output is a draft for human review.",
        },
        {
          role: "user",
          content: `Template: ${data.template}\nContext: ${data.instructions || "No extra context provided."}`,
        },
      ],
      false,
    );
    return { body };
  });
