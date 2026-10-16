import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchDepartments, fetchLocations, labelMap, logAudit } from "@/lib/hr-queries";
import { convertCandidateToEmployee, getCandidateResumeUrl } from "@/lib/recruitment.functions";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/candidates/$candidateId")({
  head: () => ({
    meta: [
      { title: "Candidate 360 — Spine AI" },
      {
        name: "description",
        content: "Candidate profile, applications, interviews, feedback and offers in one view.",
      },
      { property: "og:title", content: "Candidate 360 — Spine AI" },
      { property: "og:description", content: "Applications, interviews, feedback and offers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CandidatePage,
});

function CandidatePage() {
  const { candidateId } = Route.useParams();
  const { roles, permissions, user, can } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const hr = isHr(roles);
  const [interviewFor, setInterviewFor] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [convertFor, setConvertFor] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);

  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  const candidateQuery = useQuery({
    queryKey: ["candidate", candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select(
          "id, full_name, email, phone, location, source, stage, skills, experience_years, education, notice_period, expected_salary, match_score, resume_path, applied_at, organization_id",
        )
        .eq("id", candidateId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const applicationsQuery = useQuery({
    queryKey: ["candidate-applications", candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          "id, requisition_id, stage, status, match_score, cover_letter, source, created_at, organization_id, job_requisitions(id, title)",
        )
        .eq("candidate_id", candidateId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const applicationIds = (applicationsQuery.data ?? []).map((a) => a.id);

  const interviewsQuery = useQuery({
    queryKey: ["candidate-interviews", candidateId, applicationIds.join(",")],
    enabled: applicationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interviews")
        .select(
          "id, application_id, round, interview_type, scheduled_at, duration_minutes, meeting_link, status, outcome, interview_feedback(id, rating, recommendation, strengths, concerns, notes)",
        )
        .in("application_id", applicationIds)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const offersQuery = useQuery({
    queryKey: ["candidate-offers", candidateId, applicationIds.join(",")],
    enabled: applicationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offers")
        .select(
          "id, application_id, designation, annual_ctc, currency, start_date, expires_on, status, sent_at, responded_at",
        )
        .in("application_id", applicationIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const scheduleInterview = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const app = (applicationsQuery.data ?? []).find((a) => a.id === interviewFor);
      const { error } = await supabase.from("interviews").insert({
        application_id: interviewFor!,
        organization_id: app?.organization_id ?? null,
        round: form["round"] || "round_1",
        interview_type: form["interview_type"] || "video",
        scheduled_at: form["scheduled_at"] ? new Date(form["scheduled_at"]).toISOString() : null,
        duration_minutes: form["duration_minutes"] ? Number(form["duration_minutes"]) : 45,
        meeting_link: form["meeting_link"] || null,
        status: "scheduled",
      });
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "interview.scheduled",
        entity: "interviews",
        entityId: interviewFor!,
        next: { round: form["round"] },
      });
    },
    onSuccess: () => {
      toast.success("Interview scheduled");
      setInterviewFor(null);
      void queryClient.invalidateQueries({ queryKey: ["candidate-interviews"] });
    },
    onError: () => toast.error("The interview could not be scheduled."),
  });

  const submitFeedback = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const { error } = await supabase.from("interview_feedback").insert({
        interview_id: feedbackFor!,
        rating: form["rating"] ? Number(form["rating"]) : null,
        recommendation: form["recommendation"] || null,
        strengths: form["strengths"] || null,
        concerns: form["concerns"] || null,
        notes: form["notes"] || null,
      });
      if (error) throw error;
      await supabase
        .from("interviews")
        .update({ status: "completed", outcome: form["recommendation"] || null })
        .eq("id", feedbackFor!);
    },
    onSuccess: () => {
      toast.success("Feedback recorded");
      setFeedbackFor(null);
      void queryClient.invalidateQueries({ queryKey: ["candidate-interviews"] });
    },
    onError: () => toast.error("You are not on this interview panel."),
  });

  const createOffer = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const app = (applicationsQuery.data ?? []).find((a) => a.id === offerFor);
      const { error } = await supabase.from("offers").insert({
        application_id: offerFor!,
        organization_id: app?.organization_id ?? null,
        designation: form["designation"] || null,
        annual_ctc: form["annual_ctc"] ? Number(form["annual_ctc"]) : null,
        department_id: form["department_id"] || null,
        location_id: form["location_id"] || null,
        employment_type: form["employment_type"] || "full_time",
        start_date: form["start_date"] || null,
        expires_on: form["expires_on"] || null,
        status: "draft",
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "offer.created",
        entity: "offers",
        entityId: offerFor!,
      });
    },
    onSuccess: () => {
      toast.success("Offer drafted");
      setOfferFor(null);
      void queryClient.invalidateQueries({ queryKey: ["candidate-offers"] });
    },
    onError: () => toast.error("The offer could not be created."),
  });

  const updateOffer = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const now = new Date().toISOString();
      const patch = {
        status,
        ...(status === "sent" ? { sent_at: now } : {}),
        ...(status === "accepted" || status === "declined" ? { responded_at: now } : {}),
      };
      const { data, error } = await supabase
        .from("offers")
        .update(patch)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("not-authorized");
      await logAudit({
        userId: user?.id,
        action: "offer.status_changed",
        entity: "offers",
        entityId: id,
        next: { status },
      });
    },
    onSuccess: () => {
      toast.success("Offer updated");
      void queryClient.invalidateQueries({ queryKey: ["candidate-offers"] });
    },
    onError: () => toast.error("You are not authorized to update this offer."),
  });

  const convert = useMutation({
    mutationFn: async (form: Record<string, string>) =>
      convertCandidateToEmployee({
        data: {
          applicationId: convertFor!,
          employeeCode: form["employee_code"]!,
          joiningDate: form["joining_date"]!,
        },
      }),
    onSuccess: (result) => {
      toast.success("Employee record created with onboarding tasks");
      setConvertFor(null);
      void queryClient.invalidateQueries();
      void navigate({ to: "/employees/$employeeId", params: { employeeId: result.employeeId } });
    },
    onError: (e: Error) => toast.error(e.message || "The candidate could not be converted."),
  });

  if (!canAccess("recruitment", roles, permissions))
    return <NoPermissionState what="candidate records" />;
  if (candidateQuery.isLoading) return <LoadingState rows={6} />;
  if (candidateQuery.isError) return <ErrorState message="Unable to load this candidate." />;
  const candidate = candidateQuery.data;
  if (!candidate) return <EmptyState title="This candidate is not available to you." />;

  const depts = labelMap(departmentsQuery.data ?? []);
  const applications = applicationsQuery.data ?? [];
  const interviews = interviewsQuery.data ?? [];
  const offers = offersQuery.data ?? [];

  return (
    <>
      <PageHeader
        title={candidate.full_name}
        description={`${candidate.email ?? "No email"} · ${candidate.experience_years ?? "—"} yrs experience · source ${candidate.source ?? "—"}`}
        actions={
          candidate.resume_path ? (
            <Button
              variant="outline"
              onClick={async () => {
                const res = await getCandidateResumeUrl({ data: { candidateId } });
                if (res.url) window.open(res.url, "_blank", "noopener");
                else toast.error("No resume is available for this candidate.");
              }}
            >
              View resume
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Profile" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <Row label="Stage" value={candidate.stage.replace(/_/g, " ")} />
            <Row label="Phone" value={candidate.phone ?? "—"} />
            <Row label="Location" value={candidate.location ?? "—"} />
            <Row label="Education" value={candidate.education ?? "—"} />
            <Row label="Notice period" value={candidate.notice_period ?? "—"} />
            <Row label="Expected salary" value={candidate.expected_salary ?? "—"} />
            <Row
              label="Match score"
              value={candidate.match_score != null ? String(candidate.match_score) : "—"}
            />
            <Row label="Skills" value={(candidate.skills ?? []).join(", ") || "—"} />
          </dl>
        </SectionCard>

        <div className="space-y-6 lg:col-span-2">
          <SectionCard title="Applications">
            {applications.length === 0 ? (
              <EmptyState title="No applications recorded." />
            ) : (
              <ul className="space-y-3">
                {applications.map((a) => {
                  const offer = offers.find((o) => o.application_id === a.id);
                  return (
                    <li key={a.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{a.job_requisitions?.title ?? "Role"}</p>
                          <p className="text-xs text-muted-foreground">
                            Applied {new Date(a.created_at).toLocaleDateString()} · via{" "}
                            {a.source ?? "—"}
                          </p>
                        </div>
                        <StatusBadge status={a.stage} />
                      </div>
                      {a.cover_letter ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                          {a.cover_letter}
                        </p>
                      ) : null}
                      {hr ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => setInterviewFor(a.id)}>
                            Schedule interview
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setOfferFor(a.id)}>
                            Draft offer
                          </Button>
                          {offer?.status === "accepted" && can("manage_employee") ? (
                            <Button size="sm" onClick={() => setConvertFor(a.id)}>
                              Convert to employee
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Interviews">
            {interviews.length === 0 ? (
              <EmptyState title="No interviews scheduled." />
            ) : (
              <ul className="space-y-3">
                {interviews.map((iv) => (
                  <li key={iv.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium capitalize">
                          {iv.round.replace(/_/g, " ")} · {iv.interview_type}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {iv.scheduled_at
                            ? new Date(iv.scheduled_at).toLocaleString()
                            : "Not scheduled"}{" "}
                          · {iv.duration_minutes ?? 45} min
                        </p>
                      </div>
                      <StatusBadge status={iv.status} />
                    </div>
                    {(iv.interview_feedback ?? []).map((f) => (
                      <div key={f.id} className="mt-2 rounded-md bg-muted/50 p-2 text-sm">
                        <p className="font-medium capitalize">
                          {f.recommendation ?? "Feedback"}{" "}
                          {f.rating != null ? `· ${f.rating}/5` : ""}
                        </p>
                        {f.strengths ? (
                          <p className="text-muted-foreground">Strengths: {f.strengths}</p>
                        ) : null}
                        {f.concerns ? (
                          <p className="text-muted-foreground">Concerns: {f.concerns}</p>
                        ) : null}
                        {f.notes ? <p className="text-muted-foreground">{f.notes}</p> : null}
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 h-8 px-2 text-xs"
                      onClick={() => setFeedbackFor(iv.id)}
                    >
                      Add feedback
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Offers">
            {offers.length === 0 ? (
              <EmptyState title="No offers created." />
            ) : (
              <ul className="space-y-3">
                {offers.map((o) => (
                  <li key={o.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{o.designation ?? "Offer"}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.annual_ctc
                            ? `${o.currency ?? "INR"} ${o.annual_ctc.toLocaleString()}`
                            : "CTC not set"}
                          {o.start_date ? ` · starts ${o.start_date}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={o.status} />
                    </div>
                    {hr ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {o.status === "draft" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateOffer.mutate({ id: o.id, status: "sent" })}
                          >
                            Mark as sent
                          </Button>
                        ) : null}
                        {o.status === "sent" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => updateOffer.mutate({ id: o.id, status: "accepted" })}
                            >
                              Candidate accepted
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateOffer.mutate({ id: o.id, status: "declined" })}
                            >
                              Candidate declined
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Schedule interview */}
      <FormDialog
        open={Boolean(interviewFor)}
        onOpenChange={(o) => !o && setInterviewFor(null)}
        title="Schedule interview"
        submitLabel={scheduleInterview.isPending ? "Scheduling..." : "Schedule"}
        onSubmit={(form) => scheduleInterview.mutate(form)}
      >
        <Field name="round" label="Round" placeholder="round_1" defaultValue="round_1" />
        <Field
          name="interview_type"
          label="Type"
          placeholder="video, onsite, phone"
          defaultValue="video"
        />
        <Field name="scheduled_at" label="Date and time" type="datetime-local" required />
        <Field name="duration_minutes" label="Duration (minutes)" type="number" defaultValue="45" />
        <Field name="meeting_link" label="Meeting link" />
      </FormDialog>

      {/* Feedback */}
      <FormDialog
        open={Boolean(feedbackFor)}
        onOpenChange={(o) => !o && setFeedbackFor(null)}
        title="Interview feedback"
        submitLabel={submitFeedback.isPending ? "Saving..." : "Save feedback"}
        onSubmit={(form) => submitFeedback.mutate(form)}
      >
        <Field name="rating" label="Rating (1-5)" type="number" />
        <Field name="recommendation" label="Recommendation" placeholder="proceed, hold, reject" />
        <AreaField name="strengths" label="Strengths" />
        <AreaField name="concerns" label="Concerns" />
        <AreaField name="notes" label="Notes" />
      </FormDialog>

      {/* Offer */}
      <FormDialog
        open={Boolean(offerFor)}
        onOpenChange={(o) => !o && setOfferFor(null)}
        title="Draft offer"
        submitLabel={createOffer.isPending ? "Saving..." : "Create draft"}
        onSubmit={(form) => createOffer.mutate(form)}
      >
        <Field name="designation" label="Designation" required />
        <Field name="annual_ctc" label="Annual CTC" type="number" />
        <Field name="employment_type" label="Employment type" defaultValue="full_time" />
        <Field name="start_date" label="Start date" type="date" />
        <Field name="expires_on" label="Offer expires on" type="date" />
        <SelectField
          name="department_id"
          label="Department"
          options={(departmentsQuery.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
        <SelectField
          name="location_id"
          label="Location"
          options={(locationsQuery.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
        />
        <p className="text-xs text-muted-foreground">Department options: {depts.size} available.</p>
      </FormDialog>

      {/* Conversion */}
      <FormDialog
        open={Boolean(convertFor)}
        onOpenChange={(o) => !o && setConvertFor(null)}
        title="Convert to employee"
        description="Creates the employee record and standard onboarding tasks. Only possible after an accepted offer."
        submitLabel={convert.isPending ? "Creating..." : "Create employee"}
        onSubmit={(form) => convert.mutate(form)}
      >
        <Field name="employee_code" label="Employee code" required />
        <Field name="joining_date" label="Joining date" type="date" required />
      </FormDialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium capitalize">{value}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder ?? ""}
        defaultValue={defaultValue ?? ""}
        required={required ?? false}
      />
    </div>
  );
}

function AreaField({ name, label }: { name: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} rows={3} />
    </div>
  );
}

function SelectField({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        defaultValue=""
      >
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  onSubmit: (form: Record<string, string>) => void;
  children: React.ReactNode;
}) {
  const formId = `form-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <span className="hidden" />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        <form
          id={formId}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>);
          }}
        >
          {children}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
