import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PublicPage } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getPublicJob, submitApplication } from "@/lib/careers.functions";

export const Route = createFileRoute("/careers/$slug/apply")({
  loader: async ({ params }) => {
    const job = await getPublicJob({ data: { slug: params.slug } });
    if (!job) throw notFound();
    return job;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Apply — ${loaderData?.title ?? "Open role"} | Spine AI Careers` },
      {
        name: "description",
        content: `Submit your application for ${loaderData?.title ?? "this role"} at Spine AI. No account required.`,
      },
      { property: "og:title", content: `Apply for ${loaderData?.title ?? "this role"} — Spine AI` },
      { property: "og:description", content: "Send your resume and details to our hiring team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  notFoundComponent: () => (
    <PublicPage>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">This position is not accepting applications</h1>
        <Button asChild className="mt-6">
          <Link to="/careers">View open positions</Link>
        </Button>
      </div>
    </PublicPage>
  ),
  component: ApplyPage,
});

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function ApplyPage() {
  const job = Route.useLoaderData();
  const navigate = useNavigate();
  const [consent, setConsent] = useState(false);
  const [resume, setResume] = useState<File | null>(null);

  const apply = useMutation({
    mutationFn: async (form: FormData) => {
      if (!consent) throw new Error("Please confirm the consent statement before submitting.");
      const experience = String(form.get("experienceYears") ?? "").trim();
      let resumeBase64: string | null = null;
      if (resume) {
        if (resume.size > 5 * 1024 * 1024) throw new Error("Your resume must be smaller than 5MB.");
        resumeBase64 = await readFileAsBase64(resume);
      }
      return submitApplication({
        data: {
          slug: job.slug,
          fullName: String(form.get("fullName") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          phone: String(form.get("phone") ?? "") || null,
          location: String(form.get("location") ?? "") || null,
          experienceYears: experience ? Number(experience) : null,
          education: String(form.get("education") ?? "") || null,
          skills: String(form.get("skills") ?? "") || null,
          noticePeriod: String(form.get("noticePeriod") ?? "") || null,
          expectedSalary: String(form.get("expectedSalary") ?? "") || null,
          coverLetter: String(form.get("coverLetter") ?? "") || null,
          consent: true,
          resumeFileName: resume?.name ?? null,
          resumeContentType: resume?.type ?? null,
          resumeBase64,
        },
      });
    },
    onSuccess: (result) => {
      if (result.duplicate) {
        toast.info("You have already applied for this role — we still have your application.");
      }
      void navigate({ to: "/application-success" });
    },
    onError: (error: Error) =>
      toast.error(error.message || "We could not submit your application."),
  });

  return (
    <PublicPage>
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <Link
          to="/careers/$slug"
          params={{ slug: job.slug }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to job
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Apply for {job.title}</h1>
        <p className="mt-2 text-muted-foreground">
          No account is needed. Fields marked with * are required.
        </p>

        <form
          className="mt-8 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            apply.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name *</Label>
              <Input id="fullName" name="fullName" required minLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Current location</Label>
              <Input id="location" name="location" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="experienceYears">Years of experience</Label>
              <Input
                id="experienceYears"
                name="experienceYears"
                type="number"
                min={0}
                max={60}
                step="0.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="education">Highest qualification</Label>
              <Input id="education" name="education" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noticePeriod">Notice period</Label>
              <Input id="noticePeriod" name="noticePeriod" placeholder="e.g. 30 days" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expectedSalary">Expected salary</Label>
              <Input id="expectedSalary" name="expectedSalary" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="skills">Key skills</Label>
            <Input
              id="skills"
              name="skills"
              placeholder="Comma separated, e.g. Python, SQL, Django"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resume">Resume (PDF or Word, up to 5MB)</Label>
            <Input
              id="resume"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coverLetter">Cover letter</Label>
            <Textarea id="coverLetter" name="coverLetter" rows={6} maxLength={5000} />
          </div>

          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              aria-label="Consent"
            />
            <span className="text-muted-foreground">
              I agree that Spine AI may store and process the information I provide for the purpose
              of this recruitment process. *
            </span>
          </label>

          <Button type="submit" size="lg" disabled={apply.isPending || !consent}>
            {apply.isPending ? "Submitting..." : "Submit application"}
          </Button>
        </form>
      </div>
    </PublicPage>
  );
}
