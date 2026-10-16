import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { screenCandidates } from "@/lib/actions.functions";
import {
  fetchDepartments,
  fetchLocations,
  fetchOrganization,
  labelMap,
  logAudit,
} from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/recruitment")({
  head: () => ({
    meta: [
      { title: "Recruitment — Spine AI" },
      {
        name: "description",
        content:
          "Job requisitions, publishing, candidate pipeline and applications from the careers site.",
      },
      { property: "og:title", content: "Recruitment — Spine AI" },
      { property: "og:description", content: "Requisitions, publishing and candidate pipeline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RecruitmentPage,
});

export const PIPELINE_STAGES = [
  "applied",
  "screening",
  "hr_review",
  "shortlisted",
  "assessment",
  "interview",
  "selected",
  "offer",
  "hired",
] as const;

const CLOSED_STAGES = ["rejected", "withdrawn", "on_hold"] as const;

const REQ_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "published",
  "on_hold",
  "closed",
] as const;

function slugify(title: string) {
  return `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
}

function RecruitmentPage() {
  const { roles, permissions, user } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [open, setOpen] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [jobFilter, setJobFilter] = useState("all");
  const [pendingStatus, setPendingStatus] = useState<{
    id: string;
    status: string;
    title: string;
  } | null>(null);

  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const orgQuery = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });

  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_requisitions")
        .select(
          "id, title, slug, department_id, location_id, status, openings, employment_type, work_mode, created_at, published_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const applicationsQuery = useQuery({
    queryKey: ["applications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          "id, requisition_id, candidate_id, stage, status, match_score, created_at, candidates(id, full_name, email, experience_years)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createJob = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const title = form["title"]!;
      const { data: created, error } = await supabase
        .from("job_requisitions")
        .insert({
          title,
          slug: slugify(title),
          organization_id: orgQuery.data?.id ?? null,
          department_id: form["department_id"] || null,
          location_id: form["location_id"] || null,
          openings: Number(form["openings"] || 1),
          employment_type: form["employment_type"] || "full_time",
          work_mode: form["work_mode"] || "onsite",
          // experience_min and skills are NOT NULL with model defaults (0 / []).
          // Omit the key when blank so Django applies that default; sending an
          // explicit null bypasses the default and violates the column constraint.
          experience_min: form["experience_min"] ? Number(form["experience_min"]) : undefined,
          experience_max: form["experience_max"] ? Number(form["experience_max"]) : null,
          skills: form["skills"]
            ? form["skills"]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          description: form["description"] || null,
          responsibilities: form["responsibilities"] || null,
          requirements: form["requirements"] || null,
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "job.created",
        entity: "job_requisitions",
        entityId: created.id,
        next: { title },
      });
    },
    onSuccess: () => {
      toast.success("Requisition created as a draft");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: () => toast.error("The requisition could not be created."),
  });

  const setJobStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const now = new Date().toISOString();
      const patch = {
        status,
        ...(status === "published" ? { published_at: now } : {}),
        ...(status === "approved" ? { approved_by: user?.id ?? null, approved_at: now } : {}),
        ...(status === "closed" ? { closed_at: now } : {}),
      };
      const { data, error } = await supabase
        .from("job_requisitions")
        .update(patch)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("not-authorized");
      await logAudit({
        userId: user?.id,
        action: "job.status_changed",
        entity: "job_requisitions",
        entityId: id,
        next: { status },
      });
    },
    onSuccess: () => {
      toast.success("Requisition updated");
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: () => toast.error("You are not authorized to change this requisition."),
  });

  const addCandidate = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      if (!form["job_id"]) {
        throw new Error("Select a requisition. Candidates are added to a requisition pipeline.");
      }
      const { data: candidate, error } = await supabase
        .from("candidates")
        .insert({
          organization_id: orgQuery.data?.id ?? null,
          full_name: form["full_name"]!,
          email: form["email"] ? form["email"].toLowerCase() : null,
          phone: form["phone"] || null,
          job_id: form["job_id"],
          source: form["source"] || "direct",
          // experience_years is NOT NULL with a model default of 0. Omit when blank
          // rather than sending an explicit null (see createJob above).
          experience_years: form["experience_years"] ? Number(form["experience_years"]) : undefined,
          stage: "applied",
        })
        .select("id")
        .single();
      if (error) throw error;
      if (form["job_id"]) {
        const { error: appError } = await supabase.from("applications").insert({
          organization_id: orgQuery.data?.id ?? null,
          requisition_id: form["job_id"],
          candidate_id: candidate.id,
          stage: "applied",
          source: "hr_added",
          consent: true,
        });
        if (appError) throw appError;
      }
      await logAudit({
        userId: user?.id,
        action: "candidate.created",
        entity: "candidates",
        entityId: candidate.id,
        next: { name: form["full_name"] },
      });
    },
    onSuccess: () => {
      toast.success("Candidate added to the pipeline");
      setCandidateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
    onError: (error: Error) => toast.error(error.message || "The candidate could not be added."),
  });

  const moveStage = useMutation({
    mutationFn: async ({
      id,
      stage,
      candidateId,
    }: {
      id: string;
      stage: string;
      candidateId: string;
    }) => {
      const { data, error } = await supabase
        .from("applications")
        .update({ stage, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("not-authorized");
      await supabase.from("candidates").update({ stage }).eq("id", candidateId);
      await logAudit({
        userId: user?.id,
        action: "application.stage_changed",
        entity: "applications",
        entityId: id,
        next: { stage },
      });
    },
    onSuccess: () => {
      toast.success("Stage updated");
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
    onError: () => toast.error("You do not have permission to move this candidate."),
  });

  const screen = useMutation({
    mutationFn: async (requisitionId: string) => screenCandidates({ data: { requisitionId } }),
    onSuccess: (result) => {
      toast.success(
        `${result.evaluated} candidate(s) scored — ${result.strong} strong match(es). A shortlist action is pending approval at AI Actions.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "AI screening could not be completed."),
  });

  if (!canAccess("recruitment", roles, permissions))
    return <NoPermissionState what="recruitment information" />;
  if (jobsQuery.isLoading) return <LoadingState rows={6} />;
  if (jobsQuery.isError) return <ErrorState message="Unable to load recruitment data." />;

  const jobs = jobsQuery.data ?? [];
  const allApplications = applicationsQuery.data ?? [];
  const applications = allApplications.filter(
    (a) => jobFilter === "all" || a.requisition_id === jobFilter,
  );
  const depts = labelMap(departmentsQuery.data ?? []);
  const jobTitles = new Map(jobs.map((j) => [j.id, j.title]));
  const published = jobs.filter((j) => j.status === "published");
  const totalOpenings = published.reduce((s, j) => s + (j.openings ?? 0), 0);
  const inInterview = allApplications.filter((a) => a.stage === "interview").length;
  const hired = allApplications.filter((a) => a.stage === "hired").length;

  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Requisitions, publishing and the candidate pipeline, from application to hire."
        actions={
          hr ? (
            <div className="flex gap-2">
              <Dialog open={candidateOpen} onOpenChange={setCandidateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">Add candidate</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add candidate</DialogTitle>
                  </DialogHeader>
                  <form
                    id="candidate-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      if (!String(fd.get("job_id") ?? "")) {
                        toast.error(
                          "Select a requisition. Candidates are added to a requisition pipeline.",
                        );
                        return;
                      }
                      addCandidate.mutate(Object.fromEntries(fd) as Record<string, string>);
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="full_name">Full name</Label>
                      <Input id="full_name" name="full_name" required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" type="email" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="phone">Phone</Label>
                        <Input id="phone" name="phone" />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="experience_years">Years of experience</Label>
                        <Input
                          id="experience_years"
                          name="experience_years"
                          type="number"
                          min={0}
                          step="0.5"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="source">Source</Label>
                        <Input
                          id="source"
                          name="source"
                          placeholder="referral, portal, agency..."
                        />
                      </div>
                    </div>
                    <NamedSelect
                      label="Requisition"
                      name="job_id"
                      options={jobs.map((j) => ({ value: j.id, label: j.title }))}
                    />
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="candidate-form" disabled={addCandidate.isPending}>
                      {addCandidate.isPending ? "Adding..." : "Add candidate"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button>New requisition</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>New job requisition</DialogTitle>
                  </DialogHeader>
                  <form
                    id="job-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      createJob.mutate(Object.fromEntries(fd) as Record<string, string>);
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="title">Job title</Label>
                      <Input id="title" name="title" required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NamedSelect
                        label="Department"
                        name="department_id"
                        options={(departmentsQuery.data ?? []).map((d) => ({
                          value: d.id,
                          label: d.name,
                        }))}
                      />
                      <NamedSelect
                        label="Location"
                        name="location_id"
                        options={(locationsQuery.data ?? []).map((l) => ({
                          value: l.id,
                          label: l.name,
                        }))}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NamedSelect
                        label="Employment type"
                        name="employment_type"
                        defaultValue="full_time"
                        options={["full_time", "part_time", "contract", "intern"].map((v) => ({
                          value: v,
                          label: v.replace("_", " "),
                        }))}
                      />
                      <NamedSelect
                        label="Work mode"
                        name="work_mode"
                        defaultValue="onsite"
                        options={["onsite", "hybrid", "remote"].map((v) => ({
                          value: v,
                          label: v,
                        }))}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="openings">Openings</Label>
                        <Input
                          id="openings"
                          name="openings"
                          type="number"
                          min={1}
                          defaultValue={1}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="experience_min">Min experience</Label>
                        <Input id="experience_min" name="experience_min" type="number" min={0} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="experience_max">Max experience</Label>
                        <Input id="experience_max" name="experience_max" type="number" min={0} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="skills">Skills (comma separated)</Label>
                      <Input id="skills" name="skills" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="description">Job description</Label>
                      <Textarea id="description" name="description" rows={4} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="responsibilities">Responsibilities</Label>
                      <Textarea id="responsibilities" name="responsibilities" rows={3} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="requirements">Requirements</Label>
                      <Textarea id="requirements" name="requirements" rows={3} />
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="job-form" disabled={createJob.isPending}>
                      {createJob.isPending ? "Creating..." : "Create draft"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published roles" value={published.length} />
        <StatCard label="Total openings" value={totalOpenings} />
        <StatCard label="In interview" value={inInterview} tone="warning" />
        <StatCard label="Hired" value={hired} tone="success" />
      </div>

      <SectionCard title="Requisitions" className="mt-6">
        {jobs.length === 0 ? (
          <EmptyState title="No requisitions yet." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{j.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {depts.get(j.department_id ?? "") ?? "—"} · {j.openings} opening(s) ·{" "}
                      {(j.work_mode ?? "onsite").replace(/_/g, " ")}
                    </p>
                  </div>
                  <StatusBadge status={j.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => setJobFilter(j.id)}
                  >
                    View {allApplications.filter((a) => a.requisition_id === j.id).length}{" "}
                    applications
                  </Button>
                  <div className="flex items-center gap-2">
                    {j.status === "published" && j.slug ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={async () => {
                          await navigator.clipboard.writeText(
                            `${window.location.origin}/careers/${j.slug}`,
                          );
                          toast.success("Public job link copied");
                        }}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Share link
                      </Button>
                    ) : null}
                    {hr ? (
                      <Select
                        value={j.status}
                        onValueChange={(v) =>
                          setPendingStatus({ id: j.id, status: v, title: j.title })
                        }
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REQ_STATUSES.map((s) => (
                            <SelectItem key={s} value={s} className="capitalize">
                              {s.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Candidate pipeline"
        description={
          jobFilter === "all" ? "All requisitions" : (jobTitles.get(jobFilter) ?? "Role")
        }
        className="mt-6"
        actions={
          jobFilter !== "all" ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={screen.isPending}
                onClick={() => screen.mutate(jobFilter)}
              >
                {screen.isPending ? "Scoring..." : "Run AI shortlist"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setJobFilter("all")}>
                Show all
              </Button>
            </div>
          ) : null
        }
      >
        {applicationsQuery.isError ? (
          <ErrorState message="Unable to load applications." />
        ) : applications.length === 0 ? (
          <EmptyState title="No applications in this pipeline yet." />
        ) : (
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className="rounded-lg bg-muted/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {stage.replace(/_/g, " ")} ({applications.filter((a) => a.stage === stage).length}
                  )
                </p>
                <ul className="space-y-2">
                  {applications
                    .filter((a) => a.stage === stage)
                    .map((a) => (
                      <li key={a.id} className="rounded-md border bg-card p-2.5">
                        <Link
                          to="/candidates/$candidateId"
                          params={{ candidateId: a.candidate_id }}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {a.candidates?.full_name ?? "Candidate"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {jobTitles.get(a.requisition_id) ?? "Role"} · Match {a.match_score ?? "—"}
                        </p>
                        {hr && stage !== "hired" ? (
                          <Select
                            onValueChange={(v) =>
                              moveStage.mutate({ id: a.id, stage: v, candidateId: a.candidate_id })
                            }
                          >
                            <SelectTrigger className="mt-2 h-8 text-xs">
                              <SelectValue placeholder="Move to..." />
                            </SelectTrigger>
                            <SelectContent>
                              {[...PIPELINE_STAGES, ...CLOSED_STAGES]
                                .filter((s) => s !== stage)
                                .map((s) => (
                                  <SelectItem key={s} value={s} className="capitalize">
                                    {s.replace(/_/g, " ")}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          AI match scores are decision support only — hiring decisions stay with your team.
        </p>
      </SectionCard>

      <AlertDialog open={Boolean(pendingStatus)} onOpenChange={(o) => !o && setPendingStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change &ldquo;{pendingStatus?.title}&rdquo; to{" "}
              {pendingStatus?.status.replace(/_/g, " ")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatus?.status === "published"
                ? "Publishing makes this role visible on the public careers site and open to applications."
                : pendingStatus?.status === "closed"
                  ? "Closing removes the role from the public careers site."
                  : "This updates the requisition lifecycle and is recorded in the audit log."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingStatus)
                  setJobStatus.mutate({ id: pendingStatus.id, status: pendingStatus.status });
                setPendingStatus(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NamedSelect({
  label,
  name,
  options,
  defaultValue = "",
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="capitalize">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
