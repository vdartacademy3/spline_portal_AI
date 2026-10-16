import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RESUME_BUCKET = "candidate-resumes";

export type PublicJobSummary = {
  slug: string;
  title: string;
  department: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  employment_type: string;
  work_mode: string | null;
  experience_min: number | null;
  experience_max: number | null;
  skills: string[] | null;
  description: string | null;
  published_at: string | null;
};

export type PublicJobDetail = PublicJobSummary & {
  responsibilities: string | null;
  requirements: string | null;
  qualifications: string | null;
  openings: number;
};

const API_URL = (process.env["API_URL"] || "http://127.0.0.1:8000").replace(/\/+$/, "");

async function callRpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/rpc/${fn}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Unable to load job information (${res.status})`);
  return (await res.json()) as T;
}

/** Published jobs only — safe for anonymous visitors. */
export const listPublicJobs = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await callRpc<PublicJobSummary[]>("public_job_list", {});
  } catch {
    return [] as PublicJobSummary[];
  }
});

export const getPublicJob = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ slug: z.string().min(1).max(160) }).parse(data))
  .handler(async ({ data }) => {
    const rows = await callRpc<PublicJobDetail[]>("public_job_detail", { _slug: data.slug });
    return rows[0] ?? null;
  });

const applicationSchema = z.object({
  slug: z.string().min(1).max(160),
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(160),
  phone: z.string().max(40).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  experienceYears: z.number().min(0).max(60).optional().nullable(),
  education: z.string().max(200).optional().nullable(),
  skills: z.string().max(400).optional().nullable(),
  noticePeriod: z.string().max(60).optional().nullable(),
  expectedSalary: z.string().max(60).optional().nullable(),
  coverLetter: z.string().max(5000).optional().nullable(),
  consent: z.literal(true),
  resumeFileName: z.string().max(200).optional().nullable(),
  resumeContentType: z.string().max(120).optional().nullable(),
  resumeBase64: z.string().max(8_000_000).optional().nullable(),
});

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Public application intake. A candidate never gets an internal account:
 * this only creates/updates a candidate record and an application.
 */
export const submitApplication = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => applicationSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job, error: jobError } = await supabaseAdmin
      .from("job_requisitions")
      .select("id, title, organization_id, status")
      .eq("slug", data.slug)
      .maybeSingle();
    if (jobError) throw new Error("We could not process this application right now.");
    if (!job || job.status !== "published" || !job.organization_id) {
      throw new Error("This position is no longer accepting applications.");
    }
    const organizationId: string = job.organization_id;

    const email = data.email.trim().toLowerCase();

    const { data: existing } = await supabaseAdmin
      .from("candidates")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", email)
      .maybeSingle();

    // skills and experience_years are NOT NULL with model defaults ([] / 0).
    // Omit the key when blank so Django applies that default; an explicit null
    // bypasses the default and violates the column constraint.
    const skills = data.skills
      ? data.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 30)
      : undefined;

    let candidateId = existing?.id ?? null;
    const candidatePayload = {
      organization_id: organizationId,
      job_id: job.id,
      full_name: data.fullName.trim(),
      email,
      phone: data.phone ?? null,
      location: data.location ?? null,
      experience_years: data.experienceYears ?? undefined,
      education: data.education ?? null,
      skills,
      notice_period: data.noticePeriod ?? null,
      expected_salary: data.expectedSalary ?? null,
      source: "careers_site",
    };

    if (candidateId) {
      await supabaseAdmin.from("candidates").update(candidatePayload).eq("id", candidateId);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("candidates")
        .insert({ ...candidatePayload, stage: "applied" })
        .select("id")
        .single();
      if (error) throw new Error("We could not process this application right now.");
      candidateId = created.id;
    }

    const { data: already } = await supabaseAdmin
      .from("applications")
      .select("id")
      .eq("requisition_id", job.id)
      .eq("candidate_id", candidateId!)
      .maybeSingle();
    if (already) {
      return { ok: true, duplicate: true, jobTitle: job.title };
    }

    let resumePath: string | null = null;
    if (data.resumeBase64 && data.resumeFileName) {
      const bytes = decodeBase64(data.resumeBase64);
      if (bytes.byteLength > 5 * 1024 * 1024)
        throw new Error("Your resume must be smaller than 5MB.");
      const safe = data.resumeFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      resumePath = `${candidateId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(RESUME_BUCKET)
        .upload(resumePath, bytes, {
          contentType: data.resumeContentType ?? "application/octet-stream",
          upsert: false,
        });
      if (upErr) resumePath = null;
      if (resumePath) {
        await supabaseAdmin
          .from("candidates")
          .update({ resume_path: resumePath })
          .eq("id", candidateId!);
      }
    }

    const { error: appError } = await supabaseAdmin.from("applications").insert({
      organization_id: organizationId,
      requisition_id: job.id,
      candidate_id: candidateId!,
      stage: "applied",
      cover_letter: data.coverLetter ?? null,
      resume_path: resumePath,
      consent: data.consent,
      source: "careers_site",
    });
    if (appError) throw new Error("We could not process this application right now.");

    await supabaseAdmin.from("audit_logs").insert({
      action: "application.submitted",
      entity: "applications",
      entity_id: candidateId,
      new_value: { job: job.title, email } as never,
    });

    return { ok: true, duplicate: false, jobTitle: job.title };
  });

/** Signed resume link for authorised recruiters only. */
export const getResumeUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: candidate, error } = await context.supabase
      .from("candidates")
      .select("id, resume_path")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (error) throw error;
    if (!candidate?.resume_path) throw new Error("No resume is stored for this candidate.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(candidate.resume_path, 120);
    if (signError) throw signError;
    return { url: signed.signedUrl };
  });
